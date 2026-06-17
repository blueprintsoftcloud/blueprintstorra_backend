// src/services/billing.service.ts
//
// Isolates all billing mathematics and Razorpay order-intent creation from the
// controllers. Every method is static so callers never need to instantiate the
// class — import and call directly.
//
// This service is intentionally write-free with respect to the Subscription
// model. It only reads subscription state and creates Razorpay payment intents.
// The subsequent webhook handler (future step) is responsible for mutating the
// Subscription document after a payment is confirmed.

import Razorpay from 'razorpay';
import { env } from '../config/env';
import { Subscription, Plan } from '../models/mongoose';
import { ADDON_PRICES } from '../config/plans';
import type { FeatureType } from '../config/plans';
import { AppError } from '../utils/AppError';


/**
 * Razorpay client scoped exclusively to the Super Admin's SaaS billing account.
 * Exported so the billing controller can reuse it for synchronous order fetching
 * during payment verification (avoids re-instantiating per request).
 *
 * The shop owner's e-commerce Razorpay instance lives in src/config/razorpay.ts
 * and is completely separate — do not merge them.
 */
export const superAdminRazorpay = new Razorpay({
  key_id: env.SUPER_ADMIN_RAZORPAY_KEY_ID,
  key_secret: env.SUPER_ADMIN_RAZORPAY_KEY_SECRET,
});

export class BillingService {
  // ── 1. UPGRADE MATH ────────────────────────────────────────────────────────

  /**
   * Returns the INR top-up amount a tenant must pay to move from their current
   * plan to the target plan.
   *
   * Throws 400 if the delta is ≤ 0 (same-plan re-purchases and downgrades are
   * not allowed via self-serve — they require Super Admin intervention).
   */
  static async calculateUpgradeAmount(
    currentPlanCode: string,
    targetPlanCode: string,
  ): Promise<number> {
    // Fetch both plan documents in parallel — each hits the unique index on
    // `code` for an O(1) point lookup.
    const [currentPlan, targetPlan] = await Promise.all([
      Plan.findOne({ code: currentPlanCode }).lean(),
      Plan.findOne({ code: targetPlanCode }).lean(),
    ]);

    if (!currentPlan) {
      throw new AppError(404, `Current plan '${currentPlanCode}' not found. Please contact support.`);
    }
    if (!targetPlan) {
      throw new AppError(404, `Target plan '${targetPlanCode}' does not exist.`);
    }

    // Pro-rata logic:
    //   MONTHLY → LIFETIME  : charge the FULL target price. The monthly fee is
    //             not treated as a credit — it covered access already consumed.
    //   LIFETIME → LIFETIME : charge the price delta only. The current lifetime
    //             plan is treated as a partial payment toward the higher tier.
    const amount =
      currentPlan.billingCycle === 'MONTHLY'
        ? targetPlan.price
        : targetPlan.price - currentPlan.price;

    if (amount <= 0) {
      throw new AppError(
        400,
        'Downgrades or same-plan changes are not permitted via self-serve. Please contact support.',
      );
    }

    return amount;
  }

  // ── 2. PLAN UPGRADE ORDER ──────────────────────────────────────────────────

  /**
   * Finds the admin's active subscription, calculates the pro-rata upgrade
   * amount, and creates a Razorpay order intent.
   *
   * Returns the raw Razorpay order object — the controller should pass the
   * `id`, `amount`, and `currency` fields to the client for checkout.
   *
   * Throws:
   *   404 — no active subscription found for this adminId.
   *   400 — target plan would be a downgrade or same-plan re-purchase.
   *   Propagates Razorpay SDK errors to the controller for centralised handling.
   */
  static async createUpgradeOrder(adminId: string, targetPlanCode: string) {
    const sub = await Subscription.findOne({
      adminId,
      status: 'ACTIVE',
    }).lean();

    if (!sub) {
      throw new AppError(
        404,
        'No active subscription found for this account. Cannot initiate an upgrade.',
      );
    }

    const amount = await BillingService.calculateUpgradeAmount(
      sub.planCode,
      targetPlanCode,
    );

    const order = await superAdminRazorpay.orders.create({
      amount: amount * 100, // Razorpay expects paise (INR × 100)
      currency: 'INR',
      notes: {
        type: 'UPGRADE',
        adminId,
        currentPlanCode: sub.planCode,
        targetPlanCode,
      },
    });

    return order;
  }

  // ── 3. ADD-ON PURCHASE ORDER ───────────────────────────────────────────────

  /**
   * Looks up the catalogue price for a given feature add-on and creates a
   * Razorpay order intent for that exact amount.
   *
   * Returns the raw Razorpay order object.
   *
   * Throws:
   *   400 — the feature has no entry in ADDON_PRICES (it is either included in
   *          all plans or is a PRO-exclusive feature not sold à la carte).
   *   Propagates Razorpay SDK errors to the controller for centralised handling.
   */
  static async createAddonOrder(adminId: string, feature: FeatureType) {
    const price = ADDON_PRICES[feature];

    if (price === undefined) {
      throw new AppError(
        400,
        `The feature '${feature}' is not available as a purchasable add-on. ` +
          'It is either included in your base plan or is exclusive to the LIFETIME_PRO plan.',
      );
    }

    const order = await superAdminRazorpay.orders.create({
      amount: price * 100, // Razorpay expects paise (INR × 100)
      currency: 'INR',
      notes: {
        type: 'ADDON',
        adminId,
        feature,
      },
    });

    return order;
  }
}
