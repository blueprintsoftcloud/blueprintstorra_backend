// src/controllers/customerTracker.controller.ts
// Admin endpoint: list all customers who have a wishlist or cart,
// with item counts and full details on demand.
// Uses Mongoose (NOT Prisma) — this project is fully on Mongoose.

import { Request, Response } from "express";
import { User, Cart, CartItem, Wishlist } from "../models/mongoose";
import logger from "../utils/logger";

// ── Product fields to project in populate ────────────────────────────────────
const PRODUCT_PROJECT = "id name price image stock discount sizes code categoryId";

// GET /api/admin/tracker/customers
// Returns unique customers that have wishlist items OR cart items, with counts.
export const getTrackedCustomers = async (_req: Request, res: Response) => {
  try {
    // Aggregate wishlist counts per user
    const wishlistAgg = await Wishlist.aggregate([
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]);

    // Aggregate cart item counts per user via Cart → CartItem
    const carts = await Cart.find({}).select("_id userId").lean();
    const cartIdToUserId: Record<string, string> = {};
    carts.forEach((c: any) => {
      cartIdToUserId[c._id.toString()] = c.userId.toString();
    });

    const cartItemAgg = await CartItem.aggregate([
      { $group: { _id: "$cartId", count: { $sum: 1 } } },
    ]);

    const wishlistCountByUser: Record<string, number> = {};
    wishlistAgg.forEach((r: any) => {
      wishlistCountByUser[r._id.toString()] = r.count;
    });

    const cartCountByUser: Record<string, number> = {};
    cartItemAgg.forEach((r: any) => {
      const uid = cartIdToUserId[r._id.toString()];
      if (uid) cartCountByUser[uid] = r.count;
    });

    const allUserIds = Array.from(
      new Set([
        ...Object.keys(wishlistCountByUser),
        ...Object.keys(cartCountByUser),
      ])
    );

    if (allUserIds.length === 0) return res.json({ customers: [] });

    const users = await User.find({
      _id: { $in: allUserIds },
      role: "CUSTOMER",
    })
      .select("_id username email phone avatar createdAt")
      .lean();

    const customers = users.map((u: any) => ({
      id: u._id.toString(),
      username: u.username,
      email: u.email ?? null,
      phone: u.phone ?? null,
      avatar: u.avatar ?? null,
      createdAt: u.createdAt,
      wishlistCount: wishlistCountByUser[u._id.toString()] ?? 0,
      cartCount: cartCountByUser[u._id.toString()] ?? 0,
    }));

    return res.json({ customers });
  } catch (err: any) {
    logger.error("getTrackedCustomers error", err);
    return res.status(500).json({ message: "Server error fetching tracked customers" });
  }
};

// GET /api/admin/tracker/customers/:userId/wishlist
export const getCustomerWishlist = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;

    const [wishlistItems, user] = await Promise.all([
      Wishlist.find({ userId })
        .populate({
          path: "productId",
          select: PRODUCT_PROJECT,
          populate: { path: "categoryId", select: "name" },
        })
        .sort({ createdAt: -1 })
        .lean(),
      User.findById(userId).select("_id username email avatar").lean(),
    ]);

    const items = wishlistItems.map((i: any) => {
      const p = i.productId ?? {};
      return {
        id: p._id?.toString() ?? i._id?.toString(),
        name: p.name ?? "",
        price: p.price ?? 0,
        image: p.image ?? null,
        stock: p.stock ?? 0,
        discount: p.discount ?? 0,
        sizes: p.sizes ?? [],
        code: p.code ?? "",
        category: p.categoryId ? { name: p.categoryId.name } : null,
        addedAt: i.createdAt,
      };
    });

    return res.json({ user, items });
  } catch (err: any) {
    logger.error("getCustomerWishlist error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/tracker/customers/:userId/cart
export const getCustomerCart = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;

    const [cart, user] = await Promise.all([
      Cart.findOne({ userId }).lean(),
      User.findById(userId).select("_id username email avatar").lean(),
    ]);

    let items: any[] = [];

    if (cart) {
      const cartItems = await CartItem.find({ cartId: (cart as any)._id })
        .populate({
          path: "productId",
          select: PRODUCT_PROJECT,
          populate: { path: "categoryId", select: "name" },
        })
        .lean();

      items = cartItems.map((ci: any) => {
        const p = ci.productId ?? {};
        return {
          id: p._id?.toString() ?? ci._id?.toString(),
          name: p.name ?? "",
          price: p.price ?? 0,
          image: p.image ?? null,
          stock: p.stock ?? 0,
          discount: p.discount ?? 0,
          sizes: p.sizes ?? [],
          code: p.code ?? "",
          category: p.categoryId ? { name: p.categoryId.name } : null,
          quantity: ci.quantity ?? 1,
          cartItemId: ci._id?.toString(),
        };
      });
    }

    const total = items.reduce(
      (sum: number, item: any) => sum + (item.price ?? 0) * (item.quantity ?? 1),
      0
    );

    return res.json({ user, items, total: total.toFixed(2) });
  } catch (err: any) {
    logger.error("getCustomerCart error", err);
    return res.status(500).json({ message: "Server error" });
  }
};
