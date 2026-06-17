// src/utils/planSeeder.ts
//
// Idempotent startup seeder for the Plan collection.
//
// On a fresh database the Plan collection will be empty, which would make
// every feature-gate check fail (Plan.findOne returns null → 403 for every
// request). This function checks for that condition at boot time and inserts
// the three canonical system tiers if needed.
//
// It is safe to call on every startup:
//   - If plans already exist  → exits immediately (one countDocuments query).
//   - If plans are missing    → inserts three documents, then exits.
//
// The unique index on `code` (defined in planSchema) also prevents any race
// between two simultaneously-starting processes from creating duplicates.

import { Plan } from '../models/mongoose';
import { SYSTEM_FEATURES } from '../config/plans';
import type { FeatureType } from '../config/plans';
import logger from './logger';

// ── Feature sets ──────────────────────────────────────────────────────────────

/** 11 core features included in every paid tier. */
const ALL_FEATURES: FeatureType[] = [
  'USER_MANAGEMENT',
  'CATEGORY_MANAGEMENT',
  'PRODUCT_MANAGEMENT',
  'ORDER_MANAGEMENT',
  'NOTIFICATION_MANAGEMENT',
  'STAFF_MANAGEMENT',
  'WAREHOUSE_SETTINGS',
  'CUSTOMER_ACTIVITY_TRACKER',
  'PAYMENT_LOGS',
  'PRODUCT_REVIEWS',
  'HOMEPAGE_MANAGEMENT',
  'ADMIN_ORDER',
  'AUDIT_LOG',
  'COUPON_MANAGEMENT',
  'REPORTS_ANALYTICS',
  'STAFF_PERMISSION_MANAGEMENT',
  'LIVE_BILLING',
  'RENTAL_MANAGEMENT'
];

/** All 17 features — includes the 3 purchasable add-ons and COMPANY_SETTINGS. */
const PRO_FEATURES: FeatureType[] = [...SYSTEM_FEATURES] as FeatureType[];

// ── Default plan documents ─────────────────────────────────────────────────────

const DEFAULT_PLANS = [
  {
    code:         'MONTHLY_BASIC',
    name:         'Basic (Monthly)',
    price:        1000,
    billingCycle: 'MONTHLY' as const,
    features:     ALL_FEATURES.map(f => ({ feature: f, isEnabled: true })),
    limits:       { admins: 3, staff: 3, categories: 10, productsPerCategory: 15 },
  },
  {
    code:         'LIFETIME_BASIC',
    name:         'Basic (Lifetime)',
    price:        15000,
    billingCycle: 'LIFETIME' as const,
    features:     ALL_FEATURES.map(f => ({ feature: f, isEnabled: true })),
    limits:       { admins: 3, staff: 3, categories: 10, productsPerCategory: 15 },
  },
  {
    code:         'LIFETIME_PRO',
    name:         'Pro (Lifetime)',
    price:        20000,
    billingCycle: 'LIFETIME' as const,
    features:     PRO_FEATURES.map(f => ({ feature: f, isEnabled: true })),
    limits:       { admins: 5, staff: 5, categories: 15, productsPerCategory: 20 },
  },
];

// ── Seeder ────────────────────────────────────────────────────────────────────

/**
 * Checks whether any Plan documents exist and, if not, inserts the three
 * default system tiers. Call this once, right after `connectDB()`.
 */
export async function seedDefaultPlans(): Promise<void> {
  const count = await Plan.countDocuments();

  if (count === 0) {
    await Plan.insertMany(DEFAULT_PLANS);
    logger.info(`planSeeder: seeded ${DEFAULT_PLANS.length} default plans (MONTHLY_BASIC, LIFETIME_BASIC, LIFETIME_PRO).`);
    return;
  }

  logger.info(`planSeeder: ${count} plan(s) already exist — verifying feature sync.`);

  // Self-healing migration block: Ensure all canonical plans have all system features synced.
  for (const defaultPlan of DEFAULT_PLANS) {
    const existingPlan = await Plan.findOne({ code: defaultPlan.code });
    if (existingPlan) {
      let modified = false;
      const existingFeatureKeys = new Set(existingPlan.features.map(f => f.feature));

      for (const defaultFeature of defaultPlan.features) {
        if (!existingFeatureKeys.has(defaultFeature.feature)) {
          existingPlan.features.push(defaultFeature);
          modified = true;
        }
      }

      if (modified) {
        await existingPlan.save();
        logger.info(`planSeeder: synchronized missing features for plan: ${defaultPlan.code}`);
      }
    }
  }
}
