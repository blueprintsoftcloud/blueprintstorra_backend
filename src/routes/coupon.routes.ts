import { Router } from "express";
import {
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCoupon,
  validateCoupon,
} from "../controllers/coupon.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { featureGate } from "../middleware/featureGate.middleware";

const router = Router();

// ── Admin-only coupon management (requires COUPON_MANAGEMENT feature) ──────
router.get(
  "/admin",
  authMiddleware,
  adminMiddleware,
  featureGate("COUPON_MANAGEMENT"),
  listCoupons,
);
router.post(
  "/admin",
  authMiddleware,
  adminMiddleware,
  featureGate("COUPON_MANAGEMENT"),
  createCoupon,
);
router.patch(
  "/admin/:id",
  authMiddleware,
  adminMiddleware,
  featureGate("COUPON_MANAGEMENT"),
  updateCoupon,
);
router.delete(
  "/admin/:id",
  authMiddleware,
  adminMiddleware,
  featureGate("COUPON_MANAGEMENT"),
  deleteCoupon,
);
router.patch(
  "/admin/:id/toggle",
  authMiddleware,
  adminMiddleware,
  featureGate("COUPON_MANAGEMENT"),
  toggleCoupon,
);

// ── Customer coupon validation at checkout (authenticated user) ────────────
router.post("/validate", authMiddleware, validateCoupon);

export default router;
