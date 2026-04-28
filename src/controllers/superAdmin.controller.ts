import { Request, Response } from "express";
import { FeatureFlag, User, Order, Feature } from "../models/mongoose";
import logger from "../utils/logger";
import { createAuditLog } from "../utils/auditLog";

// ─── Ordered list of all features for consistent display ─────────────────────
const ALL_FEATURES: Feature[] = [
  "USER_MANAGEMENT",
  "CATEGORY_MANAGEMENT",
  "PRODUCT_MANAGEMENT",
  "ORDER_MANAGEMENT",
  "COUPON_MANAGEMENT",
  "NOTIFICATION_MANAGEMENT",
  "REPORTS_ANALYTICS",
  "STAFF_MANAGEMENT",
  "STAFF_PERMISSION_MANAGEMENT",
  "WAREHOUSE_SETTINGS",
  "AUDIT_LOG",
  "CUSTOMER_ACTIVITY_TRACKER",
  "PAYMENT_LOGS",
  "PRODUCT_REVIEWS",
  "HOMEPAGE_MANAGEMENT",
  "ADMIN_ORDER",
];

// ─── Feature-flag labels for the UI ──────────────────────────────────────────
export const FEATURE_LABELS: Record<Feature, string> = {
  USER_MANAGEMENT: "User Management",
  CATEGORY_MANAGEMENT: "Category Management",
  PRODUCT_MANAGEMENT: "Product Management",
  ORDER_MANAGEMENT: "Order Management",
  COUPON_MANAGEMENT: "Coupon Management",
  NOTIFICATION_MANAGEMENT: "Notification Management",
  REPORTS_ANALYTICS: "Reports & Analytics",
  STAFF_MANAGEMENT: "Staff Management",
  STAFF_PERMISSION_MANAGEMENT: "Staff Permission Management",
  WAREHOUSE_SETTINGS: "Warehouse Settings",
  AUDIT_LOG: "Audit Log",
  CUSTOMER_ACTIVITY_TRACKER: "Customer Activity Tracker",
  PAYMENT_LOGS: "Payment Transaction Logs",
  PRODUCT_REVIEWS: "Product Reviews & Ratings",
  HOMEPAGE_MANAGEMENT: "Homepage Content Management",
  ADMIN_ORDER: "Admin: Place Order on Behalf of Customer",
};

// GET /api/super-admin/features  (ADMIN + SUPER_ADMIN)
// Returns all 7 feature flags with their current enabled status.
export const getFeatureFlags = async (_req: Request, res: Response) => {
  try {
    const flags = await prisma.featureFlag.findMany();
    const flagMap = Object.fromEntries(flags.map((f: any) => [f.feature, f.isEnabled]));

    // Always return all features even if some rows are missing in DB
    const result = ALL_FEATURES.map((feature: Feature) => ({
      feature,
      label: FEATURE_LABELS[feature],
      isEnabled: flagMap[feature] ?? true,
    }));

    return res.json(result);
  } catch (err: unknown) {
    logger.error("getFeatureFlags error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PATCH /api/super-admin/features/:feature  (SUPER_ADMIN only)
// Toggles a specific feature on or off.
export const updateFeatureFlag = async (req: Request, res: Response) => {
  try {
    const { feature } = req.params;
    const { isEnabled } = req.body;

    if (!ALL_FEATURES.includes(feature as Feature)) {
      return res.status(400).json({ message: "Invalid feature name.", feature });
    }

    if (typeof isEnabled !== "boolean") {
      return res.status(400).json({ message: "`isEnabled` must be a boolean." });
    }

    const flag = await prisma.featureFlag.upsert({
      where: { feature: feature as Feature },
      update: { isEnabled },
      create: { feature: feature as Feature, isEnabled },
    });

    await createAuditLog({ req, action: isEnabled ? "ENABLE_FEATURE" : "DISABLE_FEATURE", entity: "FeatureFlag", entityId: String(feature), details: { feature, isEnabled } });
    logger.info(`FeatureFlag '${feature}' set to ${isEnabled} by Super Admin`);
    return res.json({ message: "Feature flag updated.", flag });
  } catch (err: unknown) {
    logger.error("updateFeatureFlag error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/super-admin/summary  (SUPER_ADMIN only)
// Full dashboard — includes admin + customer counts, revenue, latest orders.
export const getSuperAdminSummary = async (_req: Request, res: Response) => {
  try {
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d;
    };

    const last30 = daysAgo(30);

    const [
      totalCustomers,
      newCustomers,
      totalOrders,
      newOrders,
      totalProducts,
      adminUser,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: last30 } } }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: last30 } } }),
      prisma.product.count(),
      prisma.user.findFirst({
        where: { role: "ADMIN" },
        select: { id: true, username: true, email: true, phone: true, createdAt: true, isVerified: true },
      }),
    ]);

    const revenue = await prisma.order.aggregate({
      where: { paymentStatus: "PAID" },
      _sum: { finalAmount: true },
    });

    const recentRevenue = await prisma.order.aggregate({
      where: { paymentStatus: "PAID", createdAt: { gte: last30 } },
      _sum: { finalAmount: true },
    });

    const latestOrders = await prisma.order.findMany({
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return res.json({
      adminUser,
      stats: {
        totalCustomers,
        newCustomers,
        totalOrders,
        newOrders,
        totalProducts,
        totalRevenue: revenue._sum.finalAmount ?? 0,
        recentRevenue: recentRevenue._sum.finalAmount ?? 0,
      },
      latestOrders,
    });
  } catch (err: unknown) {
    logger.error("getSuperAdminSummary error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/super-admin/admin-user  (SUPER_ADMIN only)
// Returns the shop's Admin user profile.
export const getAdminUser = async (_req: Request, res: Response) => {
  try {
    const adminUser = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { orders: true } },
      },
    });

    if (!adminUser) {
      return res.status(404).json({ message: "No Admin user found in this deployment." });
    }

    return res.json(adminUser);
  } catch (err: unknown) {
    logger.error("getAdminUser error", err);
    return res.status(500).json({ message: "Server error" });
  }
};
