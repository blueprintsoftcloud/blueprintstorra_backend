/**
 * SINGLE SOURCE OF TRUTH for all SaaS plan definitions.
 *
 * All 17 tenant features are declared here as a const tuple so
 * `FeatureType` is derived from the values, not duplicated as a
 * hand-maintained enum. Any middleware or service that needs to
 * reference a feature key must import from this file.
 *
 * DO NOT import from src/models/mongoose.ts for feature names —
 * that file's FeatureEnum is legacy and will be replaced when the
 * featureGate middleware is migrated to the Subscription model.
 */

// ─── 1. CANONICAL FEATURE REGISTRY ──────────────────────────────────────────

export const SYSTEM_FEATURES = [
  // Core store operations (included in all plans)
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
  // Premium add-ons (purchasable separately on Basic tier)
  'COUPON_MANAGEMENT',
  'REPORTS_ANALYTICS',
  'STAFF_PERMISSION_MANAGEMENT',
  'LIVE_BILLING',
  'RENTAL_MANAGEMENT'
] as const;

export type FeatureType = typeof SYSTEM_FEATURES[number];

// ─── 2. PLAN CODE TYPE ───────────────────────────────────────────────────────

/**
 * PlanCode is a plain string — plan definitions are stored in the `Plan`
 * MongoDB collection and managed dynamically via Super Admin APIs.
 * See src/utils/planSeeder.ts for the initial seed data.
 */
export type PlanCode = string;

// ─── 3. ADD-ON PRICING ───────────────────────────────────────────────────────

/**
 * Features that Basic-tier tenants can purchase individually.
 * COMPANY_SETTINGS is intentionally absent — it is PRO-exclusive
 * and cannot be unlocked as a standalone add-on.
 */
export const ADDON_PRICES: Partial<Record<FeatureType, number>> = {
  COUPON_MANAGEMENT: 500,
  REPORTS_ANALYTICS: 1000,
  STAFF_PERMISSION_MANAGEMENT: 1500,
  LIVE_BILLING: 1000,
  RENTAL_MANAGEMENT: 1500,
  USER_MANAGEMENT: 500,
  CATEGORY_MANAGEMENT: 500,
  PRODUCT_MANAGEMENT: 500,
  ORDER_MANAGEMENT: 500,
  NOTIFICATION_MANAGEMENT: 500,
  STAFF_MANAGEMENT: 500,
  WAREHOUSE_SETTINGS: 500,
  CUSTOMER_ACTIVITY_TRACKER: 500,
  PAYMENT_LOGS: 500,
  PRODUCT_REVIEWS: 500,
  HOMEPAGE_MANAGEMENT: 500,
  ADMIN_ORDER: 500,
  AUDIT_LOG: 500,
};