// src/routes/superAdmin.routes.ts
// Routes exclusive to SUPER_ADMIN, except GET /features which Admin can also read
// (so the frontend knows which sidebar items to show).

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware, adminOrStaffMiddleware } from "../middleware/admin.middleware";
import { superAdminMiddleware } from "../middleware/superAdmin.middleware";
import {
  getFeatureFlags,
  updateFeatureFlag,
  getSuperAdminSummary,
  getAdminUser,
  assignPlan,
  getAllPlans,
  updatePlanFeatures,
  getSaaSPaymentHistory,
  getAdminSubscription,
} from "../controllers/superAdmin.controller";

const router = Router();

// ── Feature Flags 

// ADMIN + SUPER_ADMIN + STAFF can read feature flags (frontend needs this to render sidebar)
router.get("/features", authMiddleware, adminOrStaffMiddleware, getFeatureFlags);

// Only SUPER_ADMIN can toggle flags
router.patch(
  "/features/:feature",
  authMiddleware,
  superAdminMiddleware,
  updateFeatureFlag,
);

// ── Super Admin Dashboard 
router.get("/summary", authMiddleware, superAdminMiddleware, getSuperAdminSummary);

// ── Admin User Info 
router.get("/admin-user", authMiddleware, superAdminMiddleware, getAdminUser);
// ── SaaS Subscription Management 
// Manually assign / replace a tenant's subscription (offline payment flow).
router.post("/assign-plan", authMiddleware, superAdminMiddleware, assignPlan);

// ── Dynamic Plan Management
router.get("/plans", authMiddleware, superAdminMiddleware, getAllPlans);
router.put("/plans/:code", authMiddleware, superAdminMiddleware, updatePlanFeatures);

// ── SaaS Payment Ledger 
router.get("/saas-payments", authMiddleware, superAdminMiddleware, getSaaSPaymentHistory);

// View a specific tenant's active billing profile and add-ons
router.get("/admin-subscription/:adminId", authMiddleware, superAdminMiddleware, getAdminSubscription);

export default router;
