import { Request, Response } from "express";
import { Cart, Product } from "../models/mongoose";
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
  items: Array<{ quantity: number; product: { price: number } }>,
) => items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

const CART_INCLUDE = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
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

    // Get or create cart
    let cart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId },
        include: CART_INCLUDE,
      });
    }

    // Upsert cart item
    const existingItem = cart.items.find((i: any) => String(i.productId) === String(productId));
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

    let cart = await prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });

    if (!cart) {
      return res
        .status(200)
        .json({
          message: "Cart is empty",
          cart: null,
          quantity: 0,
          totalAmount: 0,
        });
    }

    // Validate: remove items whose product or category was deleted / deactivated
    const invalidItems = cart.items.filter(
      (i: any) => !i.product || !i.product.isActive,
    );
    if (invalidItems.length > 0) {
      await prisma.cartItem.deleteMany({
        where: { id: { in: invalidItems.map((i: any) => i.id) } },
      });
      cart = await prisma.cart.findUnique({
        where: { userId },
        include: CART_INCLUDE,
      });
    }

    const totalAmount = computeCartTotal(cart!.items);
    const totalQuantity = cart!.items.reduce((sum: number, i: any) => sum + i.quantity, 0);

    res.status(200).json({
      message: "Cart fetched and validated successfully",
      cart,
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
