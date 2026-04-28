// src/routes/paymentLog.routes.ts
import { Router } from "express";
import { getPaymentLogs, getPaymentLogById } from "../controllers/paymentLog.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOrStaff } from "../middleware/staffPermission.middleware";
import { featureGate } from "../middleware/featureGate.middleware";

const router = Router();

// Admin & Super Admin only — no staff access
router.get(
  "/",
  authMiddleware,
  adminOrStaff("ORDER_VIEW"),
  featureGate("PAYMENT_LOGS"),
  getPaymentLogs,
);

router.get(
  "/:id",
  authMiddleware,
  adminOrStaff("ORDER_VIEW"),
  featureGate("PAYMENT_LOGS"),
  getPaymentLogById,
);

export default router;
