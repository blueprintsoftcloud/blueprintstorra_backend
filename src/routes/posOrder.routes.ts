import { Router } from "express";
import { createPOSOrder, getKOTByTicketId, completeKOTBilling, getPOSBillingHistory, getNextSequence } from "../controllers/posOrder.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { featureGate } from "../middleware/featureGate.middleware";
import { adminOrStaff } from "../middleware/staffPermission.middleware";

const router = Router();

// POS & KOT APIs gated by auth, order permissions, and the premium LIVE_BILLING feature flag
router.post("/create", authMiddleware, adminOrStaff("ORDER_UPDATE"), featureGate("LIVE_BILLING"), createPOSOrder);
router.get("/billing-history", authMiddleware, adminOrStaff("ORDER_VIEW"), featureGate("LIVE_BILLING"), getPOSBillingHistory);
router.get("/next-sequence", authMiddleware, adminOrStaff("ORDER_VIEW"), featureGate("LIVE_BILLING"), getNextSequence);
router.get("/kot/:ticketId", authMiddleware, adminOrStaff("ORDER_VIEW"), featureGate("LIVE_BILLING"), getKOTByTicketId);
router.put("/billing-complete/:ticketId", authMiddleware, adminOrStaff("ORDER_UPDATE"), featureGate("LIVE_BILLING"), completeKOTBilling);

export default router;
