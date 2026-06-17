// src/controllers/billing.controller.ts
//
// HTTP layer for the SaaS billing flows:
//   POST /api/billing/upgrade        — create a Razorpay upgrade order intent
//   POST /api/billing/addon          — create a Razorpay add-on order intent
//   POST /api/billing/verify         — synchronous payment verification + DB update
//   GET  /api/billing/my-subscription — return current plan + available upgrades/add-ons

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { BillingService, superAdminRazorpay } from '../services/billing.service';
import { Subscription, Plan, FeatureFlag, SaaSOrder } from '../models/mongoose';
import { env } from '../config/env';
import { ADDON_PRICES } from '../config/plans';
import logger from '../utils/logger';
import type { FeatureType } from '../config/plans';
import { AppError } from '../utils/AppError';

/**
 * Creates a Razorpay payment order for a plan upgrade.
 * Charges the full target price when upgrading from a MONTHLY plan, or the
 * price delta when upgrading between LIFETIME plans.
 *
 * @access ADMIN (primary or secondary — resolved via JWT)
 * @route  POST /api/billing/upgrade
 * @body   { targetPlanCode: string }
 * @returns 201 { order: { id: string, amount: number, currency: "INR", status: string } }
 */
export const createUpgradeIntent = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { targetPlanCode } = req.body as { targetPlanCode: string };
    const order = await BillingService.createUpgradeOrder(req.user!.id, targetPlanCode);
    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
};

/**
 * Creates a Razorpay payment order for a single add-on feature purchase.
 * The charge is the flat catalogue price for that add-on.
 * Returns 400 if the feature is already included in the tenant's base plan
 * or is not a purchasable add-on (e.g. COMPANY_SETTINGS is PRO-exclusive).
 *
 * @access ADMIN (primary or secondary — resolved via JWT)
 * @route  POST /api/billing/addon
 * @body   { feature: FeatureType }
 * @returns 201 { order: { id: string, amount: number, currency: "INR", status: string } }
 */
export const createAddonIntent = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { feature } = req.body as { feature: FeatureType };
    const order = await BillingService.createAddonOrder(req.user!.id, feature);
    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/billing/verify ──────────────────────────────────────────────────
//
// Called synchronously by the frontend Razorpay checkout callback.
// Verifies the payment signature, then fetches the order from Razorpay to read
// the authoritative `notes` (prevents the frontend from spoofing what was bought).

export const verifyPayment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body as {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      };

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new AppError(400, 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required.');
    }

    // ── 1. Verify HMAC signature ─────────────────────────────────────────────
    // Razorpay signs payment confirmation as:
    //   HMAC-SHA256(order_id + "|" + payment_id, key_secret)
    const expectedSignature = crypto
      .createHmac('sha256', env.SUPER_ADMIN_RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    let isValid = false;
    try {
      const expectedBuf = Buffer.from(expectedSignature, 'hex');
      const incomingBuf = Buffer.from(razorpay_signature, 'hex');
      isValid =
        expectedBuf.length === incomingBuf.length &&
        crypto.timingSafeEqual(expectedBuf, incomingBuf);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      logger.warn('verifyPayment: signature mismatch', { ip: req.ip, razorpay_order_id });
      throw new AppError(400, 'Payment signature verification failed. Contact support if funds were deducted.');
    }

    // ── 2. Fetch authoritative order from Razorpay ───────────────────────────
    // We NEVER trust the frontend to tell us what was purchased — we re-fetch
    // the order from the Razorpay API to read the notes we embedded at creation.
    const order = await superAdminRazorpay.orders.fetch(razorpay_order_id);
    const notes = order.notes as {
      type?: string;
      adminId?: string;
      targetPlanCode?: string;
      currentPlanCode?: string;
      feature?: string;
    };

    if (!notes?.adminId) {
      logger.error('verifyPayment: order has no adminId in notes', { razorpay_order_id });
      throw new AppError(500, 'Order metadata is missing. Please contact support.');
    }

    // ── 3. Update the subscription ───────────────────────────────────────────
    if (notes.type === 'UPGRADE' && notes.targetPlanCode) {
      await Subscription.findOneAndUpdate(
        { adminId: notes.adminId },
        { $set: { planCode: notes.targetPlanCode } },
      );
      await SaaSOrder.create({
        adminId: notes.adminId,
        type: 'UPGRADE',
        planCode: notes.targetPlanCode,
        amount: Math.round(Number(order.amount) / 100),
        status: 'SUCCESS',
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
      });
      logger.info('Billing: plan upgraded', {
        adminId: notes.adminId,
        from: notes.currentPlanCode,
        to: notes.targetPlanCode,
      });
    } else if (notes.type === 'ADDON' && notes.feature) {
      // $addToSet is idempotent — safe if the frontend retries the verify call.
      const sub = await Subscription.findOneAndUpdate(
        { adminId: notes.adminId },
        { $addToSet: { purchasedAddons: notes.feature } },
        { new: true }
      );

      // Auto-update the Plan toggles for the Super Admin!
      if (sub && sub.planCode) {
        await Plan.findOneAndUpdate(
          { code: sub.planCode, "features.feature": notes.feature },
          { $set: { "features.$.isEnabled": true } }
        );
        logger.info(`Plan ${sub.planCode} auto-updated to enable ${notes.feature}`);
      } else {
        logger.warn(`Could not auto-update plan: Subscription not found for admin ${notes.adminId}`);
      }

      await SaaSOrder.create({
        adminId: notes.adminId,
        type: 'ADDON',
        feature: notes.feature,
        amount: Math.round(Number(order.amount) / 100),
        status: 'SUCCESS',
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
      });
      logger.info('Billing: add-on activated', {
        adminId: notes.adminId,
        feature: notes.feature,
      });
    } else {
      logger.warn('verifyPayment: unrecognised notes.type — no subscription change made', { notes });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

/**
 * Returns the tenant's active subscription, all available plans for the
 * pricing table, and only the add-ons not already covered by the base plan
 * or previously purchased. Secondary admins automatically resolve to the
 * Primary Admin's subscription.
 *
 * @access ADMIN (primary or secondary — resolved via JWT)
 * @route  GET /api/billing/my-subscription
 * @body   none
 * @returns 200 {
 *   subscription: ISubscription | null,
 *   availablePlans: IPlan[],
 *   availableAddons: { [featureKey: string]: number }
 * }
 */
export const getMySubscription = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Determine the primary admin whose subscription we should look up.
    // Secondary admins share the primary admin's subscription.
    let lookupId: string;

    if (req.user!.isPrimaryAdmin) {
      lookupId = req.user!.id;
    } else if (req.user!.primaryAdminId) {
      lookupId = req.user!.primaryAdminId;
    } else {
      throw new AppError(403, 'Admin account is not linked to a primary admin. Please contact support.');
    }

    const subscription = await Subscription.findOne({
      adminId: lookupId,
      status: 'ACTIVE',
    }).lean();

    // ── Edge Case Guard 2: Global kill switch — Pricing Trap prevention ────────
    // Features disabled at platform level must be stripped from all plan/add-on
    // lists so the frontend never renders a "Buy" button for a dead feature.
    const globallyDisabledDocs = await FeatureFlag.find({ isEnabled: false }).select('feature').lean();
    const globallyDisabledSet = new Set<string>(globallyDisabledDocs.map((f) => f.feature));

    // Extract the active, non-disabled feature strings from a raw plan document.
    const getActiveFeatures = (planDoc: { features: { feature: string; isEnabled: boolean }[] }): string[] =>
      planDoc.features
        .filter((f) => f.isEnabled && !globallyDisabledSet.has(f.feature))
        .map((f) => f.feature);

    // Fetch all plan documents for the pricing table; map each plan's features to
    // a flat string array so the frontend sees the same shape it always has.
    const rawPlans = await Plan.find({}).sort({ price: 1 }).lean();
    const availablePlans = rawPlans.map((plan) => ({
      ...plan,
      features: getActiveFeatures(plan),
    }));

    // Build the complete set of features the tenant already has access to
    // (base plan active features + purchased add-ons), minus any globally disabled.
    let ownedFeatures = new Set<string>(
      (subscription?.purchasedAddons ?? []).filter((f) => !globallyDisabledSet.has(f)),
    );
    if (subscription) {
      const currentRawPlan = rawPlans.find((p) => p.code === subscription.planCode);
      if (currentRawPlan) {
        ownedFeatures = new Set<string>([
          ...getActiveFeatures(currentRawPlan),
          ...subscription.purchasedAddons.filter((f) => !globallyDisabledSet.has(f)),
        ]);
      }
    }
    const availableAddons = Object.fromEntries(
      (Object.entries(ADDON_PRICES) as [FeatureType, number][]).filter(
        ([feature]) => !ownedFeatures.has(feature) && !globallyDisabledSet.has(feature),
      ),
    );

    res.status(200).json({
      subscription,
      availablePlans,
      availableAddons,
    });
  } catch (err) {
    next(err);
  }
};
