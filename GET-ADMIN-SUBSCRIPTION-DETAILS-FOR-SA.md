# API Documentation: Get Admin Subscription Details

## **Overview & Purpose**
This new API allows the Super Admin to view the exact billing state of any tenant. It returns both the active **Subscription** (showing purchased add-ons) and the master **Plan** metadata (showing base features and limits). 

**Key Feature for FE:** This is a "Smart API." The frontend does not need to figure out who the Primary Admin is. You can pass the `adminId` of *any* user in that tenant's organization (Primary Admin or Sub-Admin), and the backend will automatically resolve it and return the correct billing profile for that shop.

---

## **Endpoint Details**
* **Method:** `GET`
* **URL:** `/api/super-admin/admin-subscription/:adminId`
* **Auth Required:** `Bearer <Token>` (Requires `SUPER_ADMIN` role)

## **Path Parameters**
| Parameter | Type | Description |
| :--- | :--- | :--- |
| `adminId` | `string` | The user ID of the Admin (Primary or Sub-Admin) clicked in the Super Admin table. |

---

## **Integration UI Flow**
1. **Trigger:** The Super Admin clicks a "View Billing" or "Subscription Details" button next to a user's name in the Admin & Staff Management table.
2. **Fetch:** The FE calls this API using that user's `id`.
3. **Render:** Use the response to populate a modal or side-drawer showing:
   * The name of their current plan (`plan.name`).
   * The list of features included in their base plan (`plan.features`).
   * The specific premium features they have unlocked via separate payments (`subscription.purchasedAddons`).

---

## **Success Response (200 OK)**

```json
{
  "subscription": {
    "_id": "6a0d8b6b99af62aab1a023bf",
    "adminId": "6a0d8b55e2d83969d7b0b4f5",
    "planCode": "LIFETIME_BASIC",
    "status": "ACTIVE",
    "purchasedAddons": [
      "WAREHOUSE_SETTINGS",
      "REPORTS_ANALYTICS"
    ],
    "startDate": "2026-05-20T10:22:32.512Z",
    "expiresAt": null,
    "createdAt": "2026-05-20T10:22:32.513Z",
    "updatedAt": "2026-05-21T00:41:41.000Z",
    "__v": 0
  },
  "plan": {
    "_id": "6a0d9727df5d0e0dbd5fdec3",
    "code": "LIFETIME_BASIC",
    "name": "Basic (Lifetime)",
    "price": 15000,
    "billingCycle": "LIFETIME",
    "features": [
      {
        "feature": "USER_MANAGEMENT",
        "isEnabled": true,
        "_id": "6a0d9727df5d0e0dbd5fdec4"
      },
      {
        "feature": "WAREHOUSE_SETTINGS",
        "isEnabled": true,
        "_id": "6a0d9727df5d0e0dbd5fdeca"
      }
      // ... rest of plan features
    ],
    "limits": {
      "admins": 3,
      "staff": 3,
      "categories": 10,
      "productsPerCategory": 15
    },
    "createdAt": "2026-05-20T11:12:39.165Z",
    "updatedAt": "2026-05-21T00:41:41.000Z",
    "__v": 0
  }
}

---

## **Error Handling Guide for FE**

| Status Code | Reason | FE Action |
| :--- | :--- | :--- |
| **400 Bad Request** | `This account is not linked to a primary admin subscription.` | Show a toast notification indicating the user data is orphaned or invalid. |
| **403 Forbidden** | Missing Super Admin token/permissions. | Redirect to login or show access denied. |
| **404 Not Found** | `Admin user not found.` OR `No active subscription found for this tenant.` | Display empty state in the modal: "No active subscription data available." |
| **500 Server Error** | Unexpected backend failure. | Show standard generic error toast. |