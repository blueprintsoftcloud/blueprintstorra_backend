# API Documentation: Clear Cart

## **Overview & Purpose**
This API allows a customer to instantly remove all items from their cart in a single action. 

**Key Feature for FE:** This endpoint returns the exact same payload structure as the `Add to Cart` and `Remove from Cart` endpoints (but with an empty `items` array and `totalAmount: 0`). This means you can reuse your existing Redux/Zustand state update logic without writing a separate handler for this API!

---

## **Endpoint Details**
* **Method:** `DELETE`
* **URL:** `/api/cart/clear`
* **Auth Required:** `Yes` (Requires Customer JWT Cookie)

---

## **Request payload**
No body parameters are required. The backend automatically identifies the user's cart via their JWT token.

```json
// No request body needed
{}
Success Response (200 OK)JSON{
  "message": "Cart cleared successfully",
  "totalAmount": 0,
  "cart": {
    "id": "6a0d8b6b99af62aab1a023bf",
    "userId": "6a0d8b55e2d83969d7b0b4f5",
    "items": [],
    "createdAt": "2026-05-18T10:22:32.513Z",
    "updatedAt": "2026-05-21T02:58:00.000Z"
  }
}

(Note: If the cart was already empty when the customer clicked the button, the API will still return a 200 OK with the message "Cart is already empty" to gracefully handle edge cases).Error Handling Guide for FEStatus CodeReasonFE Action401 UnauthorizedMissing or expired token.Redirect the user to the login screen.500 Server ErrorUnexpected backend failure.Show a generic error toast: "Failed to clear cart. Please try again."Integration UI FlowTrigger: The customer clicks a "Clear Cart" or "Empty Cart" button on the Cart page.Optimistic UI (Optional): You can immediately set the local cart items state to [] and total to 0 while the request is pending to make the UI feel instant.Fetch: Call DELETE /api/cart/clear.Render: Dispatch the response cart object to your global state store to overwrite the old cart data.