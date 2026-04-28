import { Router } from "express";
import {
  getWarehouseSettings,
  updateWarehouseSettings,
  getShippingConfig,
  updateShippingConfig,
} from "../controllers/settings.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOrSuperAdmin } from "../middleware/admin.middleware";
import { featureGate } from "../middleware/featureGate.middleware";

const router = Router();

// Warehouse location
router.get("/warehouse", authMiddleware, adminOrSuperAdmin, getWarehouseSettings);
router.put("/warehouse", authMiddleware, adminOrSuperAdmin, featureGate("WAREHOUSE_SETTINGS"), updateWarehouseSettings);

// Shipping rate configuration
router.get("/shipping-config", authMiddleware, adminOrSuperAdmin, getShippingConfig);
router.put("/shipping-config", authMiddleware, adminOrSuperAdmin, featureGate("WAREHOUSE_SETTINGS"), updateShippingConfig);

export default router;
