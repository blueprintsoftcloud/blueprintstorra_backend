# Frontend Billing Integration Guide

**Audience:** React Frontend Team  
**Backend Version:** SaaS Multi-Tenant Billing (Razorpay)  
**Authentication:** All endpoints require a valid session JWT delivered as an `HttpOnly` cookie (set automatically at login). No `Authorization` header is used.

---

## 1. Architectural Overview

### 1.1 Team Linkage — Primary vs. Sub-Admins

Every shop is owned by exactly one **Primary Admin**. The Primary Admin is the billing owner: their account holds the `Subscription` document and pays for the plan.

A shop may also have **Sub-Admins** (secondary admin users). Sub-Admins share their Primary Admin’s subscription. They inherit all the plan features and billing state of the primary account. **They do not hold separate subscriptions and cannot initiate payments independently.**

The distinction is transparent to the billing UI. When any Admin (primary or secondary) calls `GET /api/billing/my-subscription`, the backend automatically resolves the correct subscription. The frontend does not need to know which type of admin is logged in.

```
Primary Admin ──owns──► Subscription ──covers──► Plan features
     ▲
     └── Sub-Admin 1 (shares subscription, no separate billing)
     └── Sub-Admin 2 (shares subscription, no separate billing)
```

> **Important:** If a Sub-Admin’s account is somehow not linked to a Primary Admin, the server returns `403`. This is a data integrity error — surface it gracefully and direct the user to contact support.

### 1.2 Dual Razorpay Setup — Do Not Mix Them

The backend uses **two completely separate Razorpay accounts**:

| Account | Purpose | Used By |
|---|---|---|
| **Shop Owner Razorpay** (`RAZORPAY_KEY_ID`) | Customer-facing e-commerce checkout (product orders) | Existing checkout flow — **unchanged** |
| **Super Admin Razorpay** (`SUPER_ADMIN_RAZORPAY_KEY_ID`) | SaaS subscription billing (plan upgrades, add-on purchases) | The new billing UI described in this document |

The **public key** for the billing UI is `SUPER_ADMIN_RAZORPAY_KEY_ID`. This will be provided as an environment variable (e.g., `VITE_RAZORPAY_BILLING_KEY`). Never reuse the shop’s e-commerce Razorpay key for the billing modal.

---

## 2. Upgrade Pricing Rules

The backend enforces two distinct pricing models depending on the tenant’s current billing cycle. **The frontend must reflect these rules in the UI** by computing the expected charge before the user clicks “Upgrade”.

### Rule 1 — MONTHLY → LIFETIME: Full Price

When a tenant on a **MONTHLY** plan upgrades to any **LIFETIME** plan, they are charged the **full price of the target plan**. The monthly subscription fee is not treated as a credit.

| Current Plan | Target Plan | Charge |
|---|---|---|
| `MONTHLY_BASIC` (₹1,000/mo) | `LIFETIME_BASIC` (₹20,000) | **₹20,000** (full price) |
| `MONTHLY_BASIC` (₹1,000/mo) | `LIFETIME_PRO` (₹25,000) | **₹25,000** (full price) |

### Rule 2 — LIFETIME → LIFETIME: Price Delta Only

When a tenant on a **LIFETIME** plan upgrades to a **higher LIFETIME** plan, they are charged only the **price difference** between the two plans. Their current plan is treated as a partial payment toward the higher tier.

| Current Plan | Target Plan | Charge |
|---|---|---|
| `LIFETIME_BASIC` (₹20,000) | `LIFETIME_PRO` (₹25,000) | **₹5,000** (delta only) |

### Upgrade-Only Direction

Users can **only upgrade to higher-tier plans**. The backend blocks any request where the target plan’s price is equal to or less than the current plan’s price. The UI must **disable or hide the Upgrade button** for any plan that is cheaper than or equal to the tenant’s current tier. Use `availablePlans[].price` and `subscription.planCode` from `GET /api/billing/my-subscription` to compute this client-side before presenting options.

---

## 3. The Frontend User Journey (Step-by-Step Flow)

This is the exact sequence to implement for both plan upgrades and add-on purchases.

### Step 1 — Render the Pricing / Dashboard Page

Call `GET /api/billing/my-subscription` when the billing page mounts.

The response contains everything needed to render the page in one shot:
- The tenant’s current subscription state (`subscription`).
- All available plans sorted by price ascending (`availablePlans`), ready to map over.
- Only the add-ons the tenant does **not yet have access to** (`availableAddons`). The backend automatically excludes add-ons already covered by the base plan or previously purchased — the frontend must not perform this filtering itself.

If `subscription` is `null`, the tenant has no active subscription. Show the full plan list and prompt them to contact their administrator (self-serve initial provisioning is handled offline by the Super Admin via `POST /api/super-admin/assign-plan`).

### Step 2 — User Clicks “Upgrade” or “Buy Add-on”

POST to the appropriate intent endpoint:
- Plan upgrade → `POST /api/billing/upgrade`
- Add-on purchase → `POST /api/billing/addon`

The server creates a Razorpay order for the correct amount and returns the raw Razorpay `order` object. You only need `order.id`, `order.amount`, and `order.currency` from this object.

### Step 3 — Open the Razorpay Checkout Modal

Use the Razorpay JS SDK (`https://checkout.razorpay.com/v1/checkout.js`) to open the payment modal:

```js
const options = {
  key: import.meta.env.VITE_RAZORPAY_BILLING_KEY, // Super Admin public key ONLY
  amount: order.amount,           // already in paise (INR × 100)
  currency: order.currency,       // "INR"
  order_id: order.id,             // Razorpay order ID from Step 2
  handler: function (response) {
    // Step 4 — called by Razorpay on successful payment
    verifyPayment(response);
  },
};
const rzp = new window.Razorpay(options);
rzp.open();
```

> **Do not** pass `targetPlanCode`, `feature`, or any purchase metadata to the modal. The backend embeds all purchase metadata inside the Razorpay order at creation time and re-fetches it directly from Razorpay during verification. This prevents the frontend from spoofing what was purchased.

### Step 4 — Verify the Payment (Feature Unlock)

Razorpay calls the `handler` function with three values upon a successful payment. Immediately POST all three to `POST /api/billing/verify`.

```js
async function verifyPayment(razorpayResponse) {
  await fetch('/api/billing/verify', {
    method: 'POST',
    credentials: 'include', // sends the session cookie
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_order_id:   razorpayResponse.razorpay_order_id,
      razorpay_payment_id: razorpayResponse.razorpay_payment_id,
      razorpay_signature:  razorpayResponse.razorpay_signature,
    }),
  });
  // Re-fetch subscription to refresh UI state
  refetchSubscription();
}
```

On success the server returns `{ success: true }` and the subscription is updated in the database. Re-call `GET /api/billing/my-subscription` to reflect the newly unlocked plan or add-on.

> **Security note:** The server performs HMAC-SHA256 signature verification using `timingSafeEqual` before making any database changes. A tampered or replayed signature will be rejected with `400`.

---

## 4. API Reference

---

### Section A: Shop Owner UI (Admin APIs)

**Access level required:** Role `ADMIN` (primary or secondary). Authenticated via session cookie.

---

#### `GET /api/billing/my-subscription`

Returns the tenant’s active subscription, all available plans for the pricing table, and the add-ons still available to purchase — all in a single round-trip.

**Request payload:** None. Session cookie only.

**Response `200`:**

```json
{
  "subscription": {
    "_id": "664f1a...",
    "adminId": "664f0b...",
    "planCode": "MONTHLY_BASIC",
    "status": "ACTIVE",
    "purchasedAddons": ["COUPON_MANAGEMENT"],
    "startDate": "2026-05-01T00:00:00.000Z",
    "expiresAt": "2026-06-01T00:00:00.000Z",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "updatedAt": "2026-05-01T00:00:00.000Z"
  },
  "availablePlans": [
    {
      "_id": "663a2c...",
      "code": "MONTHLY_BASIC",
      "name": "Basic (Monthly)",
      "price": 1000,
      "billingCycle": "MONTHLY",
      "features": ["USER_MANAGEMENT", "PRODUCT_MANAGEMENT", "...13 total"]
    },
    {
      "_id": "663a2d...",
      "code": "LIFETIME_BASIC",
      "name": "Basic (Lifetime)",
      "price": 20000,
      "billingCycle": "LIFETIME",
      "features": ["USER_MANAGEMENT", "PRODUCT_MANAGEMENT", "...13 total"]
    },
    {
      "_id": "663a2e...",
      "code": "LIFETIME_PRO",
      "name": "Pro (Lifetime)",
      "price": 25000,
      "billingCycle": "LIFETIME",
      "features": ["USER_MANAGEMENT", "PRODUCT_MANAGEMENT", "...all 17"]
    }
  ],
  "availableAddons": {
    "REPORTS_ANALYTICS": 1000,
    "STAFF_PERMISSION_MANAGEMENT": 1500
  }
}
```

**Field notes:**

| Field | Type | Description |
|---|---|---|
| `subscription` | `object \| null` | `null` if the tenant has no active subscription. Render a “Contact administrator” state. |
| `subscription.planCode` | `string` | The `code` of the active plan. Cross-reference with `availablePlans` to get display name and features. |
| `subscription.status` | `"ACTIVE" \| "INACTIVE" \| "PENDING_OFFLINE_PAYMENT"` | Only `ACTIVE` subscriptions allow login; the others are blocked at the auth layer. |
| `subscription.expiresAt` | `string (ISO 8601) \| null` | `null` for LIFETIME plans — they never expire. Display “Lifetime” rather than formatting a null date. |
| `subscription.purchasedAddons` | `string[]` | Feature keys the tenant has individually purchased on top of their base plan. |
| `availablePlans` | `IPlan[]` | All plans sorted by `price` ascending. Use `code` as the key when calling the upgrade endpoint. |
| `availableAddons` | `{ [featureKey]: priceInINR }` | **Only features the tenant does not yet have access to.** The backend filters out add-ons already included in the base plan’s `features` array AND add-ons already in `purchasedAddons`. The frontend must not duplicate this filtering. An empty object means every available add-on is already unlocked on the current tier. |

> **Note on `availableAddons`:** `COMPANY_SETTINGS` never appears here — it is exclusive to the `LIFETIME_PRO` plan and is not sold as a standalone add-on on any tier.

---

#### `POST /api/billing/upgrade`

Creates a Razorpay payment order for a plan upgrade. See [Section 2](#2-upgrade-pricing-rules) for how the charge amount is calculated based on the current billing cycle.

**Request payload:**

```json
{
  "targetPlanCode": "LIFETIME_PRO"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `targetPlanCode` | `string` | ✅ | The `code` of the plan to upgrade to. Must exist in the database — use values from `availablePlans[].code`. |

**Response `201`:**

```json
{
  "order": {
    "id": "order_PxTz9...",
    "amount": 2000000,
    "currency": "INR",
    "receipt": null,
    "status": "created"
  }
}
```

Pass `order.id`, `order.amount`, and `order.currency` directly to the Razorpay modal (Step 3).

**Error cases:**

| Status | Condition |
|---|---|
| `400` | The target plan’s price is equal to or less than the current plan (only upgrades to higher-priced plans are permitted). |
| `404` | No active subscription found — tenant must be provisioned first by Super Admin. |
| `404` | `targetPlanCode` does not match any plan in the database. |

---

#### `POST /api/billing/addon`

Creates a Razorpay payment order for a single add-on feature purchase. The charge is the flat catalogue price for that add-on.

**Request payload:**

```json
{
  "feature": "STAFF_PERMISSION_MANAGEMENT"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `feature` | `string` | ✅ | The feature key to purchase. Must be one of the purchasable add-on keys. Use keys from `availableAddons` in the `GET /my-subscription` response to guarantee only valid, unpurchased features are sent. |

**Currently purchasable add-ons and their prices:**

| `feature` key | Price (INR) |
|---|---|
| `COUPON_MANAGEMENT` | ₹500 |
| `REPORTS_ANALYTICS` | ₹1,000 |
| `STAFF_PERMISSION_MANAGEMENT` | ₹1,500 |

**Response `201`:**

```json
{
  "order": {
    "id": "order_AbCd1...",
    "amount": 150000,
    "currency": "INR",
    "status": "created"
  }
}
```

**Error cases:**

| Status | Condition |
|---|---|
| `400` | `feature` is not a purchasable add-on (e.g., `COMPANY_SETTINGS` is PRO-exclusive and cannot be purchased à la carte). |

---

#### `POST /api/billing/verify`

Verifies the Razorpay payment signature server-side and, on success, activates the purchased plan or add-on in the database. This is the **final and critical step** — features are not unlocked until this call succeeds.

**Request payload:** All three values are provided directly by Razorpay’s `handler` callback — do not construct or modify them.

```json
{
  "razorpay_order_id":   "order_PxTz9...",
  "razorpay_payment_id": "pay_QyUu0...",
  "razorpay_signature":  "3d4e5f..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `razorpay_order_id` | `string` | ✅ | Passed through from `options.order_id` in the modal. |
| `razorpay_payment_id` | `string` | ✅ | Provided by Razorpay in the `handler` response. |
| `razorpay_signature` | `string` | ✅ | HMAC signature provided by Razorpay. Do not construct this yourself. |

**Response `200`:**

```json
{
  "success": true
}
```

After receiving this response, re-call `GET /api/billing/my-subscription` to refresh the UI state.

**Error cases:**

| Status | Condition |
|---|---|
| `400` | Any of the three required fields is missing. |
| `400` | Signature verification failed — the payment may be tampered or replayed. If the user reports funds were deducted, direct them to contact support. |
| `500` | Order metadata is missing on the Razorpay side — indicates a data integrity issue; direct the user to support. |

---

### Section B: Platform Management UI (Super Admin APIs)

**Access level required:** Role `SUPER_ADMIN`. Authenticated via session cookie. These endpoints are not accessible to shop-owner Admins.

---

#### `POST /api/super-admin/assign-plan`

Manually provisions or replaces a tenant’s SaaS subscription. Used for offline payment flows where the Super Admin activates a plan on the tenant’s behalf after receiving payment outside Razorpay. Clears `purchasedAddons` and resets `startDate`/`expiresAt` on every call. Only Primary Admins may hold subscriptions.

**Request payload:**

```json
{
  "adminId": "664f0b...",
  "planCode": "LIFETIME_PRO"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `adminId` | `string` | ✅ | MongoDB `_id` of the Primary Admin user to provision. |
| `planCode` | `string` | ✅ | The `code` of the plan to assign. Must exist in the database (validate using `GET /api/super-admin/plans`). |

**Response `200`:**

```json
{
  "message": "Plan 'LIFETIME_PRO' assigned successfully to admin 664f0b..."
}
```

**Error cases:**

| Status | Condition |
|---|---|
| `400` | `adminId` or `planCode` is missing. |
| `400` | `planCode` does not match any plan in the database. |
| `400` | Target user is not a Primary Admin. |
| `404` | No user found for the given `adminId`. |

---

#### `GET /api/super-admin/plans`

Returns all Plan documents sorted by price ascending. Used by the Super Admin dashboard to view and manage plan definitions.

**Request payload:** None.

**Response `200`:**

```json
[
  {
    "_id": "663a2c...",
    "code": "MONTHLY_BASIC",
    "name": "Basic (Monthly)",
    "price": 1000,
    "billingCycle": "MONTHLY",
    "features": ["USER_MANAGEMENT", "CATEGORY_MANAGEMENT", "...13 total"],
    "createdAt": "2026-05-01T00:00:00.000Z",
    "updatedAt": "2026-05-01T00:00:00.000Z"
  },
  {
    "_id": "663a2d...",
    "code": "LIFETIME_BASIC",
    "name": "Basic (Lifetime)",
    "price": 20000,
    "billingCycle": "LIFETIME",
    "features": ["USER_MANAGEMENT", "CATEGORY_MANAGEMENT", "...13 total"],
    "createdAt": "2026-05-01T00:00:00.000Z",
    "updatedAt": "2026-05-01T00:00:00.000Z"
  },
  {
    "_id": "663a2e...",
    "code": "LIFETIME_PRO",
    "name": "Pro (Lifetime)",
    "price": 25000,
    "billingCycle": "LIFETIME",
    "features": ["USER_MANAGEMENT", "CATEGORY_MANAGEMENT", "...all 17"],
    "createdAt": "2026-05-01T00:00:00.000Z",
    "updatedAt": "2026-05-01T00:00:00.000Z"
  }
]
```

---

#### `PUT /api/super-admin/plans/:code`

Replaces the `features` array of a specific plan. All submitted feature strings are validated against the canonical feature registry on the server before writing. Changes take effect immediately — the feature gate reads from the database on every authenticated request.

**Route parameter:** `:code` — the `code` of the plan to update (e.g., `LIFETIME_PRO`).

**Request payload:**

```json
{
  "features": [
    "USER_MANAGEMENT",
    "PRODUCT_MANAGEMENT",
    "ORDER_MANAGEMENT",
    "COUPON_MANAGEMENT"
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `features` | `string[]` | ✅ | The complete new features list for this plan. Must be an array of valid feature key strings. |

**Response `200`:** The full updated Plan document.

```json
{
  "_id": "663a2c...",
  "code": "MONTHLY_BASIC",
  "name": "Basic (Monthly)",
  "price": 1000,
  "billingCycle": "MONTHLY",
  "features": ["USER_MANAGEMENT", "PRODUCT_MANAGEMENT", "ORDER_MANAGEMENT", "COUPON_MANAGEMENT"],
  "createdAt": "2026-05-01T00:00:00.000Z",
  "updatedAt": "2026-05-19T10:00:00.000Z"
}
```

**Error cases:**

| Status | Condition |
|---|---|
| `400` | `features` is not an array. |
| `400` | One or more strings in `features` are not valid feature keys. The error response lists the invalid values. |
| `404` | No plan found for the given `:code`. |

---

## 5. Error Handling & Edge Cases

### 5.1 The Login Barrier (Pre-Login 403)

This check fires during the **OTP verification step at login** — before a JWT is ever issued.

When an Admin (primary or secondary) completes OTP verification, the backend looks up the subscription for their tenant. If no `ACTIVE` subscription is found, the login is **rejected with a `403`** and the following message:

```
"There is no active subscription found. Please connect with the administrator to proceed with login."
```

**What this means for the FE:**
- Your login flow must handle `403` responses from the OTP-verify endpoint separately from `401` (invalid OTP).
- A `403` at login means the tenant’s SaaS subscription has lapsed or was never provisioned. The user cannot log in at all. They must contact their Super Admin.
- Sub-Admins will be blocked if the **Primary Admin’s** subscription is inactive, even if the Sub-Admin’s own credentials are valid.

**This is by design.** Do not attempt to redirect to a billing page — the user has no valid session to access it.

### 5.2 The Feature Gate (Post-Login 403)

After login, individual routes may be protected by the feature gate middleware. If an authenticated Admin or Staff user attempts to access a feature their current plan does not include, the server returns `403`:

```json
{
  "message": "Your current subscription tier does not include access to this feature. Please upgrade your plan to unlock.",
  "feature": "REPORTS_ANALYTICS"
}
```

**What this means for the FE:**
- Intercept `403` responses globally (e.g., in an Axios interceptor or React Query error handler).
- Check for the presence of the `feature` key in the response body. If it exists, this is a feature gate error — redirect the user to the billing/upgrade page and surface the specific feature name.
- A `403` **without** a `feature` key is a standard authorization error (wrong role) and should be handled separately.

### 5.3 Upgrade Direction Enforcement

The upgrade endpoint rejects requests where the target plan’s price is equal to or less than the current plan’s price. The server returns `400` with:

```
"Downgrades or same-plan changes are not permitted via self-serve. Please contact support."
```

The UI must **disable or hide the Upgrade button** for any plan that is not strictly more expensive than the tenant’s current plan. Use `availablePlans[].price` alongside `subscription.planCode` from `GET /api/billing/my-subscription` to determine which plans are valid upgrade targets before rendering.

### 5.4 LIFETIME Plan Expiry Display

`subscription.expiresAt` is `null` for all `LIFETIME_*` plans. These plans have no expiry date and can only be revoked by the Super Admin. Display **“Lifetime”** or **“Never expires”** rather than attempting to format a `null` date.

### 5.5 Idempotent Verification

`POST /api/billing/verify` is safe to call multiple times with the same `razorpay_order_id`. Add-on activations use `$addToSet` under the hood, so a retry will not double-apply a purchase. You may safely retry this call if a network error occurs before the `200` response is received.

---

## 1. Architectural Overview

### 1.1 Team Linkage — Primary vs. Sub-Admins

Every shop is owned by exactly one **Primary Admin**. The Primary Admin is the billing owner: their account holds the `Subscription` document and pays for the plan.

A shop may also have **Sub-Admins** (secondary admin users). Sub-Admins are invited users who share their Primary Admin's subscription. They inherit all the plan features and billing state of the primary account. **They do not hold separate subscriptions and cannot initiate payments independently.**

The distinction is transparent to the billing UI. When any Admin (primary or secondary) calls `GET /api/billing/my-subscription`, the backend automatically resolves the correct subscription. The frontend does not need to know which type of admin is logged in.

```
Primary Admin ──owns──► Subscription ──covers──► Plan features
     ▲
     └── Sub-Admin 1 (shares subscription, no separate billing)
     └── Sub-Admin 2 (shares subscription, no separate billing)
```

> **Important:** If a Sub-Admin's account is somehow not linked to a Primary Admin, the server returns `403`. This is a data integrity error — surface it gracefully and direct the user to contact support.

### 1.2 Dual Razorpay Setup — Do Not Mix Them

The backend uses **two completely separate Razorpay accounts**:

| Account | Purpose | Used By |
|---|---|---|
| **Shop Owner Razorpay** (`RAZORPAY_KEY_ID`) | Customer-facing e-commerce checkout (product orders) | Existing checkout flow — **unchanged** |
| **Super Admin Razorpay** (`SUPER_ADMIN_RAZORPAY_KEY_ID`) | SaaS subscription billing (plan upgrades, add-on purchases) | The new billing UI described in this document |

The **public key** for the billing UI is `SUPER_ADMIN_RAZORPAY_KEY_ID`. This will be provided as an environment variable (e.g., `VITE_RAZORPAY_BILLING_KEY`). Never reuse the shop's e-commerce Razorpay key for the billing modal.

---

## 2. The Frontend User Journey (Step-by-Step Flow)

This is the exact sequence to implement for both plan upgrades and add-on purchases.

### Step 1 — Render the Pricing / Dashboard Page

Call `GET /api/billing/my-subscription` when the billing page mounts.

The response contains everything you need to render the page in one shot:
- The tenant's current subscription state (`subscription`).
- All available plans sorted by price (`availablePlans`), ready to map over.
- Only the add-ons the tenant has **not** yet purchased (`availableAddons`), so you never show a "Buy" button for something they already own.

If `subscription` is `null`, the tenant has no active subscription. Show the full plan list and prompt them to contact their administrator (self-serve initial provisioning is handled offline by the Super Admin via `POST /api/super-admin/assign-plan`).

### Step 2 — User Clicks "Upgrade" or "Buy Add-on"

POST to the appropriate intent endpoint:
- Plan upgrade → `POST /api/billing/upgrade`
- Add-on purchase → `POST /api/billing/addon`

The server creates a Razorpay order for the correct amount (delta pricing for upgrades, flat price for add-ons) and returns the raw Razorpay `order` object. You only need `order.id`, `order.amount`, and `order.currency` from this object.

### Step 3 — Open the Razorpay Checkout Modal

Use the Razorpay JS SDK (`https://checkout.razorpay.com/v1/checkout.js`) to open the payment modal. Pass the values from Step 2:

```js
const options = {
  key: import.meta.env.VITE_RAZORPAY_BILLING_KEY, // Super Admin public key ONLY
  amount: order.amount,           // already in paise (INR × 100)
  currency: order.currency,       // "INR"
  order_id: order.id,             // Razorpay order ID from Step 2
  handler: function (response) {
    // Step 4 — called by Razorpay on successful payment
    verifyPayment(response);
  },
};
const rzp = new window.Razorpay(options);
rzp.open();
```

> **Do not** pass `name`, `targetPlanCode`, or any purchase metadata to the modal. The backend embeds all purchase metadata inside the Razorpay order at creation time and re-fetches it directly from Razorpay during verification. This prevents any possibility of the frontend spoofing what was bought.

### Step 4 — Verify the Payment (Feature Unlock)

Razorpay calls the `handler` function with three values upon a successful payment. Immediately POST all three to `POST /api/billing/verify`. Do not delay this call.

```js
async function verifyPayment(razorpayResponse) {
  await fetch('/api/billing/verify', {
    method: 'POST',
    credentials: 'include', // sends the session cookie
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_order_id:   razorpayResponse.razorpay_order_id,
      razorpay_payment_id: razorpayResponse.razorpay_payment_id,
      razorpay_signature:  razorpayResponse.razorpay_signature,
    }),
  });
  // Re-fetch subscription to refresh UI state
  refetchSubscription();
}
```

On success the server returns `{ success: true }` and the subscription document in the database is updated. Re-call `GET /api/billing/my-subscription` to refresh the UI — the newly unlocked plan or add-on will be reflected immediately.

> **Security note:** The server performs HMAC-SHA256 signature verification using `timingSafeEqual` before making any database changes. A tampered or replayed `razorpay_signature` will be rejected with `400`.

---

## 3. API Reference

All routes require a valid session cookie (set at login). They are accessible to users with role `ADMIN` only. `SUPER_ADMIN` users can call the Super Admin endpoints described separately.

---

### `GET /api/billing/my-subscription`

Returns the current tenant's subscription state plus all data needed to render the billing dashboard in a single round-trip.

**Request:** No body. Cookies only.

**Response `200`:**

```json
{
  "subscription": {
    "_id": "664f1a...",
    "adminId": "664f0b...",
    "planCode": "MONTHLY_BASIC",
    "status": "ACTIVE",
    "purchasedAddons": ["COUPON_MANAGEMENT"],
    "startDate": "2026-05-01T00:00:00.000Z",
    "expiresAt": "2026-06-01T00:00:00.000Z",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "updatedAt": "2026-05-01T00:00:00.000Z"
  },
  "availablePlans": [
    {
      "_id": "663a2c...",
      "code": "MONTHLY_BASIC",
      "name": "Basic (Monthly)",
      "price": 1000,
      "billingCycle": "MONTHLY",
      "features": ["USER_MANAGEMENT", "PRODUCT_MANAGEMENT", "...13 total"]
    },
    {
      "_id": "663a2d...",
      "code": "LIFETIME_BASIC",
      "name": "Basic (Lifetime)",
      "price": 20000,
      "billingCycle": "LIFETIME",
      "features": ["USER_MANAGEMENT", "PRODUCT_MANAGEMENT", "...13 total"]
    },
    {
      "_id": "663a2e...",
      "code": "LIFETIME_PRO",
      "name": "Pro (Lifetime)",
      "price": 25000,
      "billingCycle": "LIFETIME",
      "features": ["USER_MANAGEMENT", "PRODUCT_MANAGEMENT", "...all 17"]
    }
  ],
  "availableAddons": {
    "REPORTS_ANALYTICS": 1000,
    "STAFF_PERMISSION_MANAGEMENT": 1500
  }
}
```

**Field notes:**

| Field | Type | Description |
|---|---|---|
| `subscription` | `object \| null` | `null` if the tenant has no active subscription. Render a "Contact administrator" state. |
| `subscription.planCode` | `string` | The `code` of the active plan. Cross-reference with `availablePlans` to get display name and features. |
| `subscription.status` | `"ACTIVE" \| "INACTIVE" \| "PENDING_OFFLINE_PAYMENT"` | Only `ACTIVE` subscriptions allow login; the others are blocked at the auth layer. |
| `subscription.expiresAt` | `string (ISO 8601) \| null` | `null` for LIFETIME plans — they never expire. Show "Lifetime" instead of an expiry date. |
| `subscription.purchasedAddons` | `string[]` | Feature keys already purchased. These are pre-filtered out of `availableAddons`. |
| `availablePlans` | `IPlan[]` | Sorted by `price` ascending. Use `code` as the key for the upgrade intent call. |
| `availableAddons` | `{ [featureKey]: priceInINR }` | Only features the tenant has **not** yet purchased. An empty object means nothing more is available to buy on their current tier. |

> **Note on `availableAddons`:** `COMPANY_SETTINGS` never appears here — it is exclusive to the `LIFETIME_PRO` plan and cannot be purchased as a standalone add-on on any tier.

---

### `POST /api/billing/upgrade`

Creates a Razorpay order for a plan upgrade. The charge is the **price delta** between the current plan and the target plan (e.g., upgrading from `MONTHLY_BASIC` at ₹1,000 to `LIFETIME_BASIC` at ₹20,000 charges ₹19,000).

**Request body:**

```json
{
  "targetPlanCode": "LIFETIME_PRO"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `targetPlanCode` | `string` | ✅ | The `code` of the plan to upgrade to. Must be a code that exists in the database (use values from `availablePlans[].code`). |

**Response `201`:**

```json
{
  "order": {
    "id": "order_PxTz9...",
    "amount": 500000,
    "currency": "INR",
    "receipt": null,
    "status": "created"
  }
}
```

Pass `order.id`, `order.amount`, and `order.currency` directly to the Razorpay modal (Step 3 above).

**Error cases:**

| Status | Condition |
|---|---|
| `400` | `targetPlanCode` is equal to or cheaper than the current plan (downgrades not allowed). |
| `404` | No active subscription found — tenant must be provisioned first by Super Admin. |
| `404` | `targetPlanCode` does not match any plan in the database. |

---

### `POST /api/billing/addon`

Creates a Razorpay order for a single add-on feature purchase. The charge is the flat catalogue price for that add-on.

**Request body:**

```json
{
  "feature": "STAFF_PERMISSION_MANAGEMENT"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `feature` | `string` | ✅ | The feature key to purchase. Must be one of the purchasable add-on keys (use keys from `availableAddons`). |

**Currently purchasable add-ons and their prices:**

| `feature` key | Price (INR) |
|---|---|
| `COUPON_MANAGEMENT` | ₹500 |
| `REPORTS_ANALYTICS` | ₹1,000 |
| `STAFF_PERMISSION_MANAGEMENT` | ₹1,500 |

**Response `201`:**

```json
{
  "order": {
    "id": "order_AbCd1...",
    "amount": 150000,
    "currency": "INR",
    "status": "created"
  }
}
```

**Error cases:**

| Status | Condition |
|---|---|
| `400` | `feature` is not a purchasable add-on (e.g., `COMPANY_SETTINGS` is PRO-exclusive). |

---

### `POST /api/billing/verify`

Verifies the Razorpay payment signature server-side and, on success, activates the purchased plan or add-on in the database. This is the **final and critical step** — features are not unlocked until this call succeeds.

**Request body:** (All three values are provided directly by Razorpay's `handler` callback — do not compute or modify them.)

```json
{
  "razorpay_order_id":   "order_PxTz9...",
  "razorpay_payment_id": "pay_QyUu0...",
  "razorpay_signature":  "3d4e5f..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `razorpay_order_id` | `string` | ✅ | Passed through from `options.order_id` in the modal. |
| `razorpay_payment_id` | `string` | ✅ | Provided by Razorpay in the `handler` response. |
| `razorpay_signature` | `string` | ✅ | HMAC signature provided by Razorpay. Do not construct this yourself. |

**Response `200`:**

```json
{
  "success": true
}
```

After receiving this response, re-call `GET /api/billing/my-subscription` to refresh the UI state.

**Error cases:**

| Status | Condition |
|---|---|
| `400` | Any of the three required fields is missing. |
| `400` | Signature verification failed — the payment may be tampered or replayed. If the user reports funds were deducted, direct them to contact support. |
| `500` | Order metadata is missing on the Razorpay side (extremely unlikely; indicates a data integrity issue). |

---

## 4. Error Handling & Edge Cases

### 4.1 The Login Barrier (Pre-Login 403)

This check fires during the **OTP verification step at login** — before a JWT is ever issued.

When an Admin (primary or secondary) completes OTP verification, the backend looks up the subscription for their tenant. If no `ACTIVE` subscription is found, the login is **rejected with a `403`** and the following message:

```
"There is no active subscription found. Please connect with the administrator to proceed with login."
```

**What this means for the FE:**  
- Your login flow must handle `403` responses from the OTP-verify endpoint separately from `401` (invalid OTP).  
- A `403` at login means the tenant's SaaS subscription has lapsed or was never provisioned. The user cannot log in at all. They must contact their Super Admin.  
- Sub-Admins will be blocked if the **Primary Admin's** subscription is inactive, even if the Sub-Admin's own credentials are valid.

**This is by design.** Do not attempt to redirect to a billing page — the user has no valid session to access it.

### 4.2 The Feature Gate (Post-Login 403)

After login, individual routes may be protected by the feature gate middleware. If an authenticated Admin or Staff user attempts to access a feature their current plan does not include, the server returns `403`:

```json
{
  "message": "Your current subscription tier does not include access to this feature. Please upgrade your plan to unlock.",
  "feature": "REPORTS_ANALYTICS"
}
```

**What this means for the FE:**  
- Intercept `403` responses globally (e.g., in an Axios interceptor or React Query error handler).  
- Check for the presence of the `feature` key in the response body. If it exists, this is a feature gate error — redirect the user to the billing/upgrade page and surface the specific feature name so they understand what requires an upgrade.
- A `403` **without** a `feature` key is a regular authorization error (wrong role) and should be handled separately.

### 4.3 Downgrade / Same-Plan Re-Purchase

The upgrade endpoint rejects requests where `targetPlanCode` resolves to a plan whose price is equal to or lower than the current plan. The server returns `400` with:

```
"Downgrade or same-plan changes are not permitted via self-serve. Please contact support."
```

Disable the upgrade button in the UI for any plan that is not strictly more expensive than the current plan. Use the `availablePlans` array and `subscription.planCode` from `GET /api/billing/my-subscription` to compute this client-side before the user ever clicks.

### 4.4 LIFETIME Plan Expiry Display

`subscription.expiresAt` is `null` for all `LIFETIME_*` plans. These plans have no expiry date and can only be revoked by the Super Admin. Your billing UI should display **"Lifetime"** or **"Never expires"** rather than attempting to format a `null` date.

### 4.5 Idempotent Verification

The `POST /api/billing/verify` endpoint is safe to call multiple times with the same `razorpay_order_id`. Add-on activations use `$addToSet` under the hood, so a retry will not double-apply a purchase. You may safely retry this call if a network error occurs before the `200` response is received.
