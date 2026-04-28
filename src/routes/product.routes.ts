import { Router } from "express";
import {
  productList,
  productAdd,
  productUpdate,
  productDelete,
} from "../controllers/product.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { featureGate } from "../middleware/featureGate.middleware";
import { adminOrStaff } from "../middleware/staffPermission.middleware";
import upload from "../middleware/upload";
import { validate } from "../middleware/validate.middleware";
import { productAddSchema, productUpdateSchema } from "../schemas/product.schema";

const router = Router();

// Admin/Staff only — gated by PRODUCT_MANAGEMENT feature flag + granular permission
router.get("/list", authMiddleware, adminOrStaff("PRODUCT_VIEW"), featureGate("PRODUCT_MANAGEMENT"), productList);
router.post(
  "/add",
  authMiddleware,
  adminOrStaff("PRODUCT_ADD"),
  featureGate("PRODUCT_MANAGEMENT"),
  upload.fields([{ name: "image", maxCount: 1 }, { name: "images", maxCount: 10 }]),
  validate(productAddSchema),
  productAdd,
);
router.put(
  "/update/:id",
  authMiddleware,
  adminOrStaff("PRODUCT_EDIT"),
  featureGate("PRODUCT_MANAGEMENT"),
  upload.fields([{ name: "image", maxCount: 1 }, { name: "images", maxCount: 10 }]),
  validate(productUpdateSchema),
  productUpdate,
);
router.delete(
  "/delete/:id",
  authMiddleware,
  adminOrStaff("PRODUCT_DELETE"),
  featureGate("PRODUCT_MANAGEMENT"),
  productDelete,
);

export default router;
