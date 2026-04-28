import { Router } from "express";
import {
  getMyProfile,
  updateMyProfile,
  getStaffDashboard,
  listStaff,
  createStaff,
  getStaffById,
  updateStaff,
  updatePermissions,
  toggleStaffActive,
  deleteStaff,
} from "../controllers/staff.controller";
import { updateAvatar, deleteAvatar } from "../controllers/profileAdmin.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { featureGate } from "../middleware/featureGate.middleware";
import upload from "../middleware/upload";

const router = Router();

// ── Staff own profile (no adminMiddleware — staff user calls this) ─────────
router.get("/profile", authMiddleware, getMyProfile);
router.get("/dashboard", authMiddleware, getStaffDashboard);
router.patch("/me", authMiddleware, updateMyProfile);
router.patch("/me/avatar", authMiddleware, upload.single("avatar"), updateAvatar);
router.delete("/me/avatar", authMiddleware, deleteAvatar);

// ── Admin-only management endpoints — gated by STAFF_MANAGEMENT feature ──
router.get("/", authMiddleware, adminMiddleware, featureGate("STAFF_MANAGEMENT"), listStaff);
router.post("/", authMiddleware, adminMiddleware, featureGate("STAFF_MANAGEMENT"), createStaff);
router.get("/:id", authMiddleware, adminMiddleware, featureGate("STAFF_MANAGEMENT"), getStaffById);
router.patch("/:id", authMiddleware, adminMiddleware, featureGate("STAFF_MANAGEMENT"), updateStaff);
router.patch("/:id/permissions", authMiddleware, adminMiddleware, featureGate("STAFF_MANAGEMENT"), updatePermissions);
router.patch("/:id/toggle", authMiddleware, adminMiddleware, featureGate("STAFF_MANAGEMENT"), toggleStaffActive);
router.delete("/:id", authMiddleware, adminMiddleware, featureGate("STAFF_MANAGEMENT"), deleteStaff);

export default router;
