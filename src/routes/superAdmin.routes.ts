// src/routes/superAdmin.routes.ts
// Routes exclusive to SUPER_ADMIN, except GET /features which Admin can also read
// (so the frontend knows which sidebar items to show).

import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { superAdminMiddleware } from "../middleware/superAdmin.middleware";
import {
  getFeatureFlags,
  updateFeatureFlag,
  getSuperAdminSummary,
  getAdminUser,
} from "../controllers/superAdmin.controller";

const router = Router();

// ── Feature Flags ─────────────────────────────────────────────────────────────

// ADMIN + SUPER_ADMIN can read feature flags (frontend needs this to render sidebar)
router.get("/features", authMiddleware, adminMiddleware, getFeatureFlags);

// Only SUPER_ADMIN can toggle flags
router.patch(
  "/features/:feature",
  authMiddleware,
  superAdminMiddleware,
  updateFeatureFlag,
);

// ── Super Admin Dashboard ─────────────────────────────────────────────────────
router.get("/summary", authMiddleware, superAdminMiddleware, getSuperAdminSummary);

// ── Admin User Info ───────────────────────────────────────────────────────────
router.get("/admin-user", authMiddleware, superAdminMiddleware, getAdminUser);

export default router;
