# SaaS Billing — Frontend Integration Guide

> **Scope:** This document covers all breaking and additive backend changes made
> in the 3-Layer Feature-Gate refactor. Read every section before touching the
> corresponding UI component.

---

## What Changed on the Backend (Summary)

| Area | What Changed |
|---|---|
| `Plan.features` schema | Was `string[]`. Now `{ feature: string, isEnabled: boolean }[]` |
| Feature gate | Added **Layer 1 (Global Kill Switch)** — Super Admin can pause any feature platform-wide |
| Plan toggle | Plan features can now be **individually paused** without removing them |
| `GET /api/billing/my-subscription` | `availablePlans[].features` is still `string[]` on the response (filtered for you) |
| `PUT /api/super-admin/plans/:code` | Request body changed — see §4 |
| `POST /api/billing/verify` | Now writes a `SaaSOrder` ledger record on every successful payment |
| **NEW** `GET /api/super-admin/saas-payments` | New endpoint for the SaaS payment history tab |

---

## 1. Pricing Page / Subscription Card

### `GET /api/billing/my-subscription`

No authentication change. Secondary admins resolve automatically to the primary's subscription.

**Response Shape (unchanged for the FE — backend handles all filtering)**

```json
{
  "subscription": {
    "_id": "...",
    "adminId": "...",
    "planCode": "MONTHLY_BASIC",
    "status": "ACTIVE",
    "purchasedAddons": ["COUPON_MANAGEMENT"],
    "startDate": "2026-04-01T00:00:00.000Z",
    "expiresAt": "2026-05-01T00:00:00.000Z"
  },
  "availablePlans": [
    {
      "_id": "...",
      "code": "MONTHLY_BASIC",
      "name": "Monthly Basic",
      "price": 999,
      "billingCycle": "MONTHLY",
      "features": ["USER_MANAGEMENT", "CATEGORY_MANAGEMENT", "PRODUCT_MANAGEMENT"]
    },
    {
      "_id": "...",
      "code": "LIFETIME_PRO",
      "name": "Lifetime Pro",
      "price": 19999,
      "billingCycle": "LIFETIME",
      "features": ["USER_MANAGEMENT", "CATEGORY_MANAGEMENT", "PRODUCT_MANAGEMENT", "COUPON_MANAGEMENT", "REPORTS_ANALYTICS"]
    }
  ],
  "availableAddons": {
    "REPORTS_ANALYTICS": 1000,
    "STAFF_PERMISSION_MANAGEMENT": 1500
  }
}
```

**Key Points:**
- `availablePlans[].features` is already a **flat `string[]`** — no change needed in your plan card renderer.
- Features paused by the Super Admin (Layer 1 kill switch or Layer 2 plan toggle) are **silently removed** from the list. They will not appear as purchasable add-ons either.
- `availableAddons` only contains features **not already owned** and **not globally disabled**.

---

## 2. Sidebar Feature Flags

### `GET /api/super-admin/features`

**Accessible by:** ADMIN + SUPER_ADMIN (no change to auth)

**Response Shape (unchanged)**

```json
[
  { "feature": "USER_MANAGEMENT",    "label": "User Management",    "isEnabled": true  },
  { "feature": "COUPON_MANAGEMENT",  "label": "Coupon Management",  "isEnabled": false },
  { "feature": "REPORTS_ANALYTICS",  "label": "Reports & Analytics","isEnabled": true  }
]
```

**New behaviour:** `isEnabled: false` can now mean either:
1. The tenant's plan doesn't include it (same as before), OR
2. The Super Admin killed it globally (Layer 1), OR
3. The Super Admin paused it on the plan (Layer 2, `isEnabled: false` on the plan entry).

The FE sees the same shape in all three cases — no UI change required.

---

## 3. Feature-Gated Routes — New 403 Response

Any route protected by `featureGate(...)` middleware can now return a new 403 reason:

```json
{
  "message": "Feature temporarily disabled for maintenance.",
  "feature": "COUPON_MANAGEMENT"
}
```

**Action required:** In your global API error handler / toast system, check for this specific message (or the `feature` key) to display a maintenance notice instead of the generic "upgrade your plan" modal.

```ts
// Example React error handler
if (error.response?.status === 403) {
  const { message, feature } = error.response.data;
  if (message === 'Feature temporarily disabled for maintenance.') {
    toast.warning(`${feature} is temporarily unavailable. Please try again later.`);
  } else {
    openUpgradeModal(feature); // existing flow
  }
}
```

---

## 4. Super Admin — Plan Feature Editor

### `PUT /api/super-admin/plans/:code`

**Breaking change: request body shape has changed.**

**OLD body (no longer accepted):**
```json
{ "features": ["USER_MANAGEMENT", "COUPON_MANAGEMENT"] }
```

**NEW body (required):**
```json
{
  "features": [
    { "feature": "USER_MANAGEMENT",   "isEnabled": true  },
    { "feature": "COUPON_MANAGEMENT", "isEnabled": false },
    { "feature": "PRODUCT_MANAGEMENT","isEnabled": true  }
  ]
}
```

**Rules:**
- Every `feature` string must be a valid system feature key.
- `isEnabled: false` **pauses** the feature without removing it from the plan definition. Tenants on this plan lose access immediately; add-on holders are unaffected.
- Send the **full array** on every save (this is a full replace, not a patch).

**Response (200):** The updated `IPlan` document including the new `features` array of objects.

```json
{
  "_id": "...",
  "code": "MONTHLY_BASIC",
  "name": "Monthly Basic",
  "price": 999,
  "billingCycle": "MONTHLY",
  "features": [
    { "feature": "USER_MANAGEMENT",   "isEnabled": true  },
    { "feature": "COUPON_MANAGEMENT", "isEnabled": false }
  ]
}
```

**UI Recommendation:** Render a toggle switch next to each feature row. On save, map the toggle states to the `{ feature, isEnabled }` array format.

---

## 5. Super Admin — Plan List

### `GET /api/super-admin/plans`

**Response shape changed** — `features` is now an array of objects (not strings).

```json
[
  {
    "_id": "...",
    "code": "MONTHLY_BASIC",
    "name": "Monthly Basic",
    "price": 999,
    "billingCycle": "MONTHLY",
    "features": [
      { "feature": "USER_MANAGEMENT",   "isEnabled": true  },
      { "feature": "COUPON_MANAGEMENT", "isEnabled": false }
    ]
  }
]
```

**Action required:** Any UI component that iterates `plan.features` to render chips/badges must now access `f.feature` and can additionally read `f.isEnabled` to style paused features differently (e.g. greyed out with a "Paused" badge).

```tsx
// Before
plan.features.map((f: string) => <Chip label={f} />)

// After
plan.features.map((f) => (
  <Chip
    key={f.feature}
    label={f.feature}
    style={{ opacity: f.isEnabled ? 1 : 0.4 }}
  />
))
```

---

## 6. NEW — SaaS Payment History Tab

### `GET /api/super-admin/saas-payments`

**Access:** SUPER_ADMIN only  
**Auth:** Requires valid `jwt` HttpOnly cookie  

**Response (200):** Array of `SaaSOrder` documents, newest first.

```json
[
  {
    "_id": "6830a1...",
    "adminId": {
      "_id": "6820b2...",
      "username": "ShopOwner",
      "email": "owner@boutique.com",
      "phone": "9876543210"
    },
    "type": "UPGRADE",
    "planCode": "LIFETIME_PRO",
    "feature": null,
    "amount": 19999,
    "status": "SUCCESS",
    "razorpayOrderId": "order_ABC123",
    "razorpayPaymentId": "pay_XYZ789",
    "createdAt": "2026-05-19T08:30:00.000Z",
    "updatedAt": "2026-05-19T08:30:00.000Z"
  },
  {
    "_id": "6831c2...",
    "adminId": {
      "_id": "6820b2...",
      "username": "ShopOwner",
      "email": "owner@boutique.com",
      "phone": "9876543210"
    },
    "type": "ADDON",
    "planCode": null,
    "feature": "REPORTS_ANALYTICS",
    "amount": 1000,
    "status": "SUCCESS",
    "razorpayOrderId": "order_DEF456",
    "razorpayPaymentId": "pay_UVW012",
    "createdAt": "2026-05-15T14:00:00.000Z",
    "updatedAt": "2026-05-15T14:00:00.000Z"
  }
]
```

**Field Reference:**

| Field | Type | Description |
|---|---|---|
| `_id` | string | Unique ledger entry ID |
| `adminId` | object | Populated shop owner: `{ _id, username, email, phone }` |
| `type` | `"UPGRADE"` \| `"ADDON"` | Payment category |
| `planCode` | string \| null | Target plan code for UPGRADE; null for ADDON |
| `feature` | string \| null | Feature key for ADDON; null for UPGRADE |
| `amount` | number | Amount in **INR** (not paise) |
| `status` | `"SUCCESS"` \| `"FAILED"` | Payment outcome |
| `razorpayOrderId` | string | For reconciliation with Razorpay dashboard |
| `razorpayPaymentId` | string | For reconciliation with Razorpay dashboard |
| `createdAt` | ISO string | When the payment was recorded |

**Suggested UI — Data Table Columns:**

| Date | Shop Owner | Type | Plan / Feature | Amount | Status | Razorpay ID |
|---|---|---|---|---|---|---|
| 19 May 2026 | ShopOwner (owner@...) | Upgrade | LIFETIME_PRO | ₹19,999 | ✅ Success | pay_XYZ789 |
| 15 May 2026 | ShopOwner (owner@...) | Add-on | REPORTS_ANALYTICS | ₹1,000 | ✅ Success | pay_UVW012 |

---

## 7. Migration Note for Existing Plan Documents in MongoDB

The `Plan.features` field in MongoDB has changed shape from `["FEATURE_A"]` to
`[{ feature: "FEATURE_A", isEnabled: true }]`. **Existing documents in the
database will have the old string-array format** until a migration is run.

Run this one-time migration script from `mongosh` or your migration tool before
deploying:

```js
db.plans.find({}).forEach(plan => {
  if (plan.features.length > 0 && typeof plan.features[0] === 'string') {
    db.plans.updateOne(
      { _id: plan._id },
      {
        $set: {
          features: plan.features.map(f => ({ feature: f, isEnabled: true }))
        }
      }
    );
  }
});
```

Or use the Super Admin dashboard → **Plan Editor** (`PUT /api/super-admin/plans/:code`) to re-save each plan with the new format, which will rewrite the `features` array automatically.
