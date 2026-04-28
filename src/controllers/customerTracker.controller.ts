// src/controllers/customerTracker.controller.ts
// Admin endpoint: list all customers who have a wishlist or cart,
// with item counts and full details on demand.

import { Request, Response } from "express";
import { User, Cart, Wishlist, Order } from "../models/mongoose";
import logger from "../utils/logger";

// ── Shared include shapes (as const for Prisma type inference) ───────────────
const PRODUCT_SELECT = {
  id: true,
  name: true,
  price: true,
  image: true,
  stock: true,
  discount: true,
  sizes: true,
  code: true,
  category: { select: { name: true } },
} as const;

const TRACKER_WISHLIST_INCLUDE = {
  product: { select: PRODUCT_SELECT },
} as const;

const TRACKER_CART_INCLUDE = {
  items: {
    include: { product: { select: PRODUCT_SELECT } },
  },
} as const;

// GET /api/admin/tracker/customers
// Returns unique customers that have wishlist items OR cart items, with counts.
export const getTrackedCustomers = async (_req: Request, res: Response) => {
  try {
    const [wishlistRows, cartRows] = await Promise.all([
      prisma.wishlist.groupBy({ by: ["userId"], _count: { id: true } }),
      prisma.cartItem.groupBy({ by: ["cartId"], _count: { id: true } }),
    ]);

    // Map cartId → userId
    const cartIdToUserId: Record<string, string> = {};
    if (cartRows.length > 0) {
      const carts = await prisma.cart.findMany({
        where: { id: { in: cartRows.map((r: any) => r.cartId) } },
        select: { id: true, userId: true },
      });
      carts.forEach((c: any) => { cartIdToUserId[c.id] = c.userId; });
    }

    const wishlistCountByUser: Record<string, number> = {};
    wishlistRows.forEach((r: any) => { wishlistCountByUser[r.userId] = r._count.id; });

    const cartCountByUser: Record<string, number> = {};
    cartRows.forEach((r: any) => {
      const uid = cartIdToUserId[r.cartId];
      if (uid) cartCountByUser[uid] = r._count.id;
    });

    const allUserIds = Array.from(
      new Set([...Object.keys(wishlistCountByUser), ...Object.keys(cartCountByUser)]),
    );

    if (allUserIds.length === 0) return res.json({ customers: [] });

    const users = await prisma.user.findMany({
      where: { id: { in: allUserIds }, role: "CUSTOMER" },
      select: { id: true, username: true, email: true, phone: true, avatar: true, createdAt: true },
    });

    const customers = users.map((u: any) => ({
      ...u,
      wishlistCount: wishlistCountByUser[u.id] ?? 0,
      cartCount: cartCountByUser[u.id] ?? 0,
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
      prisma.wishlist.findMany({
        where: { userId },
        include: TRACKER_WISHLIST_INCLUDE,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, email: true, avatar: true },
      }),
    ]);

    const items = wishlistItems.map((i: any) => ({ ...i.product, addedAt: i.createdAt }));

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
      prisma.cart.findUnique({ where: { userId }, include: TRACKER_CART_INCLUDE }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, email: true, avatar: true },
      }),
    ]);

    const items = (cart?.items ?? []).map((ci: any) => ({
      ...ci.product,
      quantity: ci.quantity,
      cartItemId: ci.id,
    }));

    const total = items.reduce(
      (sum: number, item: any) => sum + (item.price ?? 0) * item.quantity,
      0,
    );

    return res.json({ user, items, total: total.toFixed(2) });
  } catch (err: any) {
    logger.error("getCustomerCart error", err);
    return res.status(500).json({ message: "Server error" });
  }
};
