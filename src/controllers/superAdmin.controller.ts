import { Request, Response, NextFunction } from "express";
import { FeatureFlag, User, Order, Feature, Subscription, Plan, SaaSOrder } from "../models/mongoose";
import { SYSTEM_FEATURES } from "../config/plans";
import type { PlanCode, FeatureType } from "../config/plans";
import logger from "../utils/logger";
import { createAuditLog } from "../utils/auditLog";
import { AppError } from "../utils/AppError";

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
  "LIVE_BILLING",
  "RENTAL_MANAGEMENT",
];

// ─── Feature-flag labels for the UI ──────────────────────────────────────────
export const FEATURE_LABELS: Record<FeatureType, string> = {
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
  LIVE_BILLING: "POS Live Billing & Kitchen Orders",
  RENTAL_MANAGEMENT: "Rental Management Module",
};

/**
 * Returns all system features with `isEnabled` computed dynamically from the
 * logged-in tenant's active Subscription (plan features + purchased add-ons).
 *
 * Resolution rules:
 *   - Primary admin            → lookup Subscription by req.user.id.
 *   - Secondary admin / STAFF  → lookup Subscription by req.user.primaryAdminId.
 *   - No active subscription   → all features disabled.
 *
 * @access ADMIN | SUPER_ADMIN
 * @route  GET /api/super-admin/features
 * @body   none
 * @returns 200 { feature: string, label: string, isEnabled: boolean }[]
 */
export const getFeatureFlags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const globalFlags = await FeatureFlag.find({}).lean();
    const globalFlagMap = new Map(globalFlags.map(f => [f.feature, f.isEnabled]));
    // ── SUPER_ADMIN: bypass all subscription checks ───────────────────────────
    if (req.user!.role === "SUPER_ADMIN") {
      const result = SYSTEM_FEATURES.map((feature: FeatureType) => {
        const isGloballyEnabled = globalFlagMap.get(feature) !== false;
        return {
          feature,
          label: FEATURE_LABELS[feature],
          isEnabled: isGloballyEnabled,
          isOwned: true,
          isGloballyEnabled,
        };
      });
      return res.json(result);
    }

    // ── Resolve tenant owner ID ───────────────────────────────────────────────
    // Primary admins own the subscription; secondary admins and staff share the
    // primary admin's subscription via the primaryAdminId pointer.
    const lookupId = req.user!.isPrimaryAdmin
      ? req.user!.id
      : req.user!.primaryAdminId;

    let isManagerSuperAdmin = false;
    if (req.user!.role === "STAFF" && req.user!.primaryAdminId) {
      const manager = await User.findById(req.user!.primaryAdminId).select("role").lean();
      if (manager && manager.role === "SUPER_ADMIN") {
        isManagerSuperAdmin = true;
      }
    }

    if (isManagerSuperAdmin) {
      const result = SYSTEM_FEATURES.map((feature: FeatureType) => {
        const isGloballyEnabled = globalFlagMap.get(feature) !== false;
        return {
          feature,
          label: FEATURE_LABELS[feature],
          isEnabled: isGloballyEnabled,
          isOwned: true,
          isGloballyEnabled,
        };
      });
      return res.json(result);
    }

    const allowedFeatures = new Set<string>();

    if (lookupId) {
      const sub = await Subscription.findOne({ adminId: lookupId, status: "ACTIVE" }).lean();

      if (sub) {
        const planMeta = await Plan.findOne({ code: sub.planCode }).lean();

        if (planMeta) {
          planMeta.features.forEach((f) => {
            if (f.isEnabled) allowedFeatures.add(f.feature);
          });
        }

        sub.purchasedAddons.forEach((f: FeatureType) => allowedFeatures.add(f));
      }
    }

    const result = SYSTEM_FEATURES.map((feature: FeatureType) => {
      const isOwned = allowedFeatures.has(feature);
      const isGloballyEnabled = globalFlagMap.get(feature) !== false;

      return {
        feature,
        label: FEATURE_LABELS[feature],
        isEnabled: isOwned && isGloballyEnabled, 
        isOwned,                                
        isGloballyEnabled,                       
      };
    });

    return res.json(result);
  } catch (err: unknown) {
    next(err); 
  }
};

/**
 * Toggles a specific feature flag on or off platform-wide.
 *
 * @access SUPER_ADMIN
 * @route  PATCH /api/super-admin/features/:feature
 * @body   { isEnabled: boolean }
 * @returns 200 { message: string, flag: { feature: string, isEnabled: boolean } }
 */
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

    // If Staff Management is turned OFF, automatically turn OFF Staff Permission Management
    if (feature === 'STAFF_MANAGEMENT' && isEnabled === false) {
      await prisma.featureFlag.upsert({
        where: { feature: 'STAFF_PERMISSION_MANAGEMENT' },
        update: { isEnabled: false },
        create: { feature: 'STAFF_PERMISSION_MANAGEMENT', isEnabled: false },
      });

      // Log the automated cascade action
      await createAuditLog({ 
        req, 
        action: "DISABLE_FEATURE", 
        entity: "FeatureFlag", 
        entityId: "STAFF_PERMISSION_MANAGEMENT", 
        details: { 
          feature: "STAFF_PERMISSION_MANAGEMENT", 
          isEnabled: false, 
          reason: "Automated cascade: Parent STAFF_MANAGEMENT disabled" 
        } 
      });
      logger.info(`FeatureFlag 'STAFF_PERMISSION_MANAGEMENT' automatically set to false due to parent cascade.`);
    }

    return res.json({ message: "Feature flag updated.", flag });
  } catch (err: unknown) {
    logger.error("updateFeatureFlag error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Returns a full platform dashboard summary: user counts, order statistics,
 * all-time and 30-day revenue figures, and the 5 most recent orders.
 *
 * @access SUPER_ADMIN
 * @route  GET /api/super-admin/summary
 * @body   none
 * @returns 200 { adminUser, stats: { totalCustomers, newCustomers, totalOrders,
 *   newOrders, totalProducts, totalRevenue, recentRevenue }, latestOrders }
 */
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

/**
 * Returns the primary Admin user's profile for the Super Admin dashboard.
 *
 * @access SUPER_ADMIN
 * @route  GET /api/super-admin/admin-user
 * @body   none
 * @returns 200 { id, username, email, phone, isVerified, createdAt, updatedAt, _count: { orders } }
 */
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
        isPrimaryAdmin: true,
        primaryAdminId: true,
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

/**
 * Manually provisions or replaces a tenant's SaaS subscription.
 * Intended for offline payment flows. Clears purchasedAddons and resets
 * startDate/expiresAt on every call. Only Primary Admins may hold subscriptions.
 *
 * @access SUPER_ADMIN
 * @route  POST /api/super-admin/assign-plan
 * @body   { adminId: string, planCode: string }
 * @returns 200 { message: string }
 */
export const assignPlan = async (req: Request, res: Response) => {
  try {
    const { adminId, planCode } = req.body as { adminId: string; planCode: PlanCode };

    if (!adminId || !planCode) {
      return res.status(400).json({ message: '`adminId` and `planCode` are required.' });
    }

    // Validate planCode against the live Plan collection.
    const plan = await Plan.findOne({ code: planCode }).lean();
    if (!plan) {
      return res.status(400).json({ message: `Invalid planCode '${planCode}'. No matching plan found in the database.` });
    }

    // Security: only a Primary Admin may hold a subscription.
    const targetUser = await User.findById(adminId).select('role isPrimaryAdmin').lean();
    if (!targetUser) {
      return res.status(404).json({ message: 'Admin user not found.' });
    }
    if (targetUser.role !== 'ADMIN' || !targetUser.isPrimaryAdmin) {
      return res.status(400).json({ message: 'Subscriptions can only be assigned to a primary admin.' });
    }

    const now = new Date();
    const expiresAt = plan.billingCycle === 'MONTHLY'
      ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : null; // LIFETIME plans never expire

    await Subscription.findOneAndUpdate(
      { adminId },
      {
        $set: {
          planCode,
          status: 'ACTIVE',
          purchasedAddons: [],
          startDate: now,
          expiresAt,
        },
      },
      { upsert: true, new: true },
    );

    await createAuditLog({
      req,
      action: 'ASSIGN_PLAN',
      entity: 'Subscription',
      entityId: adminId,
      details: { planCode, expiresAt },
    });

    logger.info('Super Admin assigned plan', { adminId, planCode });
    return res.status(200).json({ message: `Plan '${planCode}' assigned successfully to admin ${adminId}.` });
  } catch (err: unknown) {
    logger.error('assignPlan error', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Returns all Plan documents sorted by price ascending.
 * Used by the Super Admin dashboard to display and edit plan definitions.
 *
 * @access SUPER_ADMIN
 * @route  GET /api/super-admin/plans
 * @body   none
 * @returns 200 IPlan[]
 */
export const getAllPlans = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const plans = await Plan.find({}).sort({ price: 1 }).lean();
    res.status(200).json(plans);
  } catch (err) {
    next(err);
  }
};

/**
 * Replaces the `features` array of a specific plan document.
 * All submitted strings are validated against the canonical SYSTEM_FEATURES
 * registry before writing. Changes take effect immediately — the feature gate
 * reads from the database on every request.
 *
 * @access SUPER_ADMIN
 * @route  PUT /api/super-admin/plans/:code
 * @body   { features: FeatureType[] }
 * @returns 200 IPlan (the updated plan document)
 */
export const updatePlanFeatures = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { code } = req.params;
    const { features } = req.body as { features: { feature: FeatureType; isEnabled: boolean }[] };

    if (!Array.isArray(features)) {
      throw new AppError(400, '`features` must be an array of objects with shape { feature: string, isEnabled: boolean }.');
    }

    // Validate every submitted feature code against the canonical registry.
    const validSet = new Set<string>(SYSTEM_FEATURES);
    const invalid = features.filter((f) => !validSet.has(f.feature));
    if (invalid.length > 0) {
      throw new AppError(
        400,
        `Invalid feature code(s): ${invalid.map((f) => f.feature).join(', ')}. Valid values are: ${[...SYSTEM_FEATURES].join(', ')}.`,
      );
    }

    // Unique index on `code` means findOneAndUpdate hits a single document in O(1).
    const updated = await Plan.findOneAndUpdate(
      { code },
      { $set: { features } },
      { new: true },
    ).lean();

    if (!updated) {
      throw new AppError(404, `Plan with code '${code}' not found.`);
    }

    await createAuditLog({
      req,
      action: 'UPDATE_PLAN_FEATURES',
      entity: 'Plan',
      entityId: code as string,
      details: { featureCount: features.length, features },
    });

    logger.info('Super Admin updated plan features', { code, featureCount: features.length });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};
/**
 * Returns the full SaaS payment ledger — every upgrade and add-on transaction
 * processed through the platform, newest first.
 * Populates the owning Admin's `username`, `email`, and `phone` for context.
 *
 * @access SUPER_ADMIN
 * @route  GET /api/super-admin/saas-payments
 * @body   none
 * @returns 200 ISaaSOrder[] — each entry includes populated `adminId` object:
 *   { _id, type, planCode?, feature?, amount, status,
 *     razorpayOrderId, razorpayPaymentId, createdAt,
 *     adminId: { username, email, phone } }
 */
export const getSaaSPaymentHistory = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const payments = await SaaSOrder.find({})
      .populate('adminId', 'username email phone')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json(payments);
  } catch (err) {
    next(err);
  }
};

/**
 * Returns the subscription details and purchased add-ons for a specific Primary Admin.
 * If a sub-admin ID is provided, it automatically resolves to their parent Primary Admin.
 *
 * @access SUPER_ADMIN
 * @route  GET /api/super-admin/admin-subscription/:adminId
 * @body   none
 * @returns 200 { subscription, plan }
 */
export const getAdminSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { adminId } = req.params;

    // 1. Verify user and resolve the correct Primary Admin ID
    const targetUser = await User.findById(adminId).select('isPrimaryAdmin primaryAdminId').lean();
    
    if (!targetUser) {
      res.status(404).json({ message: "Admin user not found." });
      return;
    }

    const lookupId = targetUser.isPrimaryAdmin ? adminId : targetUser.primaryAdminId;

    if (!lookupId) {
      res.status(400).json({ message: "This account is not linked to a primary admin subscription." });
      return;
    }

    // 2. Fetch the active subscription
    const subscription = await Subscription.findOne({ 
      adminId: lookupId, 
      status: "ACTIVE" 
    }).lean();

    if (!subscription) {
      res.status(404).json({ message: "No active subscription found for this tenant." });
      return;
    }

    // 3. Fetch the full Plan metadata so the frontend can display the plan name and limits
    const plan = await Plan.findOne({ code: subscription.planCode }).lean();

    res.status(200).json({
      subscription,
      plan
    });
  } catch (err) {
    next(err);
  }
};