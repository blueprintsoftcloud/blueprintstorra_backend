import { Router } from "express";
import {
  placeOrder,
  verifyPayment,
  placeOrderPOD,
  cancelOrder,
  preCheckout,
  getOrders,
  getOrderById,
  getOrdersForAdmin,
  updateStatus,
  getMyTransactions,
  getCustomerTransactions,
  searchCustomersForOrder,
  getProductsForAdminOrder,
  placeAdminOrder,
} from "../controllers/order.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { featureGate } from "../middleware/featureGate.middleware";
import { adminOrStaff } from "../middleware/staffPermission.middleware";
import { adminOrSuperAdmin } from "../middleware/admin.middleware";
import { validate } from "../middleware/validate.middleware";
import { verifyPaymentSchema, updateOrderStatusSchema } from "../schemas/order.schema";

const router = Router();

// Customer routes — never gated
router.post("/place", authMiddleware, placeOrder);
router.post("/verifyPayment", authMiddleware, validate(verifyPaymentSchema), verifyPayment);
router.post("/placeOrderPOD", authMiddleware, placeOrderPOD);
router.post("/cancel/:id", authMiddleware, cancelOrder);
router.post("/pre-checkout", authMiddleware, preCheckout);
router.get("/myOrders", authMiddleware, getOrders);
router.get("/my-transactions", authMiddleware, getMyTransactions);

// Admin/Staff routes — must be declared before /:id to avoid wildcard conflict
router.get("/all", authMiddleware, adminOrStaff("ORDER_VIEW"), featureGate("ORDER_MANAGEMENT"), getOrdersForAdmin);
router.get("/customer-transactions", authMiddleware, adminOrStaff("ORDER_VIEW"), getCustomerTransactions);
router.put("/update/:id", authMiddleware, adminOrStaff("ORDER_UPDATE"), featureGate("ORDER_MANAGEMENT"), validate(updateOrderStatusSchema), updateStatus);

// Admin Order (place on behalf of customer)
router.get("/admin-order/search-customers", authMiddleware, adminOrSuperAdmin, featureGate("ADMIN_ORDER"), searchCustomersForOrder);
router.get("/admin-order/products", authMiddleware, adminOrSuperAdmin, featureGate("ADMIN_ORDER"), getProductsForAdminOrder);
router.post("/admin-order/place", authMiddleware, adminOrSuperAdmin, featureGate("ADMIN_ORDER"), placeAdminOrder);

router.get("/:id", authMiddleware, getOrderById); // single order — customer (own) or admin/staff

export default router;
