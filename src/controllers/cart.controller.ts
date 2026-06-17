import { Request, Response } from "express";
import { Cart, CartItem, Product } from "../models/mongoose";
import logger from "../utils/logger";

// Helper: emit customer-cart-update to admin room
const emitCartUpdate = (req: Request, userId: string, cartCount: number) => {
  try {
    const io = req.app.get("socketio");
    if (io) {
      io.to("admin-room").emit("customer-cart-update", { userId, cartCount });
    }
  } catch { /* non-critical */ }
};

// Helper: compute cart total from CartItems with live product prices
const computeCartTotal = (
  items: Array<{ quantity: number; product: { price: number; discount?: number } | null }>,
) => items.reduce((sum, item) => {
  const price = item.product?.discount && item.product.discount > 0
    ? item.product.price * (1 - item.product.discount / 100)
    : (item.product?.price ?? 0);
  return sum + price * item.quantity;
}, 0);

const CART_INCLUDE = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          discount: true,
          image: true,
          stock: true,
          isActive: true,
          categoryId: true,
        },
      },
    },
  },
} as const;

// POST /api/cart/add  (authenticated)
export const cartAdd = async (req: Request, res: Response) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const userId = req.user!.id;

    if (!productId)
      return res.status(400).json({ message: "productId is required" });

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || !product.isActive) {
      return res
        .status(404)
        .json({ message: "Product not found or unavailable" });
    }

    // Get or create cart (atomic upsert via Mongoose to avoid race conditions and
    // the Prisma bridge's create() not honouring the include argument)
    let cart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    if (!cart) {
      // findOneAndUpdate with upsert is atomic — safe for concurrent requests
      await Cart.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { upsert: true, new: true },
      );
      cart = await prisma.cart.findUnique({
        where: { userId },
        include: CART_INCLUDE,
      });
    }
    if (!cart) return res.status(500).json({ message: "Failed to initialize cart" });
    // Safety: bridge may omit items array on a brand-new cart
    if (!Array.isArray(cart.items)) cart = { ...cart, items: [] };

    // Upsert cart item
    const existingItem = (cart.items as any[]).find((i: any) => String(i.productId) === String(productId));
    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + Number(quantity) },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, productId, quantity: Number(quantity) },
      });
    }

    // Return fresh cart
    const updatedCart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    const totalAmount = computeCartTotal(updatedCart!.items);

    res
      .status(200)
      .json({
        message: "Cart updated successfully",
        cart: updatedCart,
        totalAmount,
      });
    emitCartUpdate(req, userId, updatedCart?.items.length ?? 0);
  } catch (err: any) {
    logger.error("cartAdd error", err);
    res.status(500).json({ message: "Error in cart adding" });
  }
};

// GET /api/cart/list  (authenticated)
export const cartList = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Use native Mongoose instead of the Prisma bridge to guarantee product data
    // is always attached. The bridge's nested attachRelations can intermittently
    // fail to populate the product relation, causing the cart to appear empty.
    const cart = await Cart.findOne({ userId }).lean();
    if (!cart) {
      return res.status(200).json({
        message: "Cart is empty",
        cart: null,
        quantity: 0,
        totalAmount: 0,
      });
    }

    // Fetch cart items and populate product via Mongoose (reliable, no bridge layer)
    const rawItems = await CartItem
      .find({ cartId: cart._id })
      .populate<{ productId: any }>('productId', 'name price discount image stock isActive categoryId')
      .lean();

    // Validate: remove items whose product no longer exists or is inactive
    const invalidIds = rawItems
      .filter((i) => !i.productId || !(i.productId as any).isActive)
      .map((i) => i._id);
    if (invalidIds.length > 0) {
      await CartItem.deleteMany({ _id: { $in: invalidIds } });
    }

    // Build items in the shape the frontend expects: { ..., product: { _id, name, ... } }
    const validItems = rawItems
      .filter((i) => i.productId && (i.productId as any).isActive)
      .map((i) => {
        const prod = i.productId as any;
        return {
          _id: String(i._id),
          id: String(i._id),
          cartId: String(i.cartId),
          productId: String(prod._id),
          quantity: i.quantity,
          selectedSize: (i as any).selectedSize ?? null,
          product: {
            _id: String(prod._id),
            id: String(prod._id),
            name: prod.name,
            price: prod.price,
            discount: prod.discount,
            image: prod.image,
            stock: prod.stock,
            isActive: prod.isActive,
            categoryId: prod.categoryId ? String(prod.categoryId) : null,
          },
        };
      });

    const totalAmount = validItems.reduce((sum, i) => {
      const price = i.product.discount && i.product.discount > 0
        ? i.product.price * (1 - i.product.discount / 100)
        : i.product.price;
      return sum + price * i.quantity;
    }, 0);
    const totalQuantity = validItems.reduce((sum, i) => sum + i.quantity, 0);

    res.status(200).json({
      message: "Cart fetched and validated successfully",
      cart: {
        _id: String(cart._id),
        id: String(cart._id),
        userId: String(cart.userId),
        items: validItems,
      },
      quantity: totalQuantity,
      totalAmount,
    });
  } catch (err: any) {
    logger.error("cartList error", err);
    res.status(500).json({ message: "Error in fetching cart" });
  }
};

// DELETE /api/cart/remove/:productId  (authenticated)
export const cartRemove = async (req: Request, res: Response) => {
  try {
    const productId = req.params.productId as string;
    const userId = req.user!.id;

    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) return res.status(400).json({ message: "Cart not found" });

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });

    const updatedCart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    const totalAmount = computeCartTotal(updatedCart!.items);

    res
      .status(200)
      .json({
        message: "Product removed from cart successfully",
        cart: updatedCart,
        totalAmount,
      });
    emitCartUpdate(req, userId, updatedCart?.items.length ?? 0);
  } catch (err: any) {
    logger.error("cartRemove error", err);
    res.status(500).json({ message: "Error in removing cart" });
  }
};

// DELETE /api/cart/clear 
export const cartClear = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // 1. Find the user's cart
    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      return res.status(200).json({ 
        message: "Cart is already empty", 
        cart: null, 
        totalAmount: 0 
      });
    }

    // 2. Delete all items associated with this cartId
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    // 3. Fetch the fresh (now empty) cart to return the expected schema to the frontend
    const updatedCart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });

    res.status(200).json({
      message: "Cart cleared successfully",
      cart: updatedCart,
      totalAmount: 0, 
    });

    // 4. Emit socket event to instantly update the admin dashboard
    emitCartUpdate(req, userId, 0);
  } catch (err: any) {
    logger.error("cartClear error", err);
    res.status(500).json({ message: "Error in clearing cart" });
  }
};

// PUT /api/cart/update/:productId  (authenticated)
export const updateProductQuantity = async (req: Request, res: Response) => {
  try {
    const productId = req.params.productId as string;
    const { quantity } = req.body;
    const userId = req.user!.id;

    if (!quantity || Number(quantity) < 1) {
      return res.status(400).json({ message: "quantity must be at least 1" });
    }

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    if (!cart) return res.status(400).json({ message: "Cart not found" });

    const item = cart.items.find((i: any) => String(i.productId) === String(productId));
    if (!item) return res.status(400).json({ message: "Product not in cart" });

    await prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: Number(quantity) },
    });

    const updatedCart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    const totalAmount = computeCartTotal(updatedCart!.items);

    res
      .status(200)
      .json({
        message: "Cart quantity updated successfully",
        cart: updatedCart,
        totalAmount,
      });
  } catch (err: any) {
    logger.error("updateProductQuantity error", err);
    res.status(500).json({ message: "Error in updating quantity in cart" });
  }
};
