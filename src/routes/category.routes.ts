import { Router } from "express";
import {
  categoryList,
  categoryAdd,
  categoryUpdate,
  categoryDelete,
} from "../controllers/category.controller";
import {
  getCategoryAttributes,
  addCategoryAttribute,
  updateCategoryAttribute,
  deleteCategoryAttribute,
  addAttributeValue,
  updateAttributeValue,
  deleteAttributeValue,
} from "../controllers/attribute.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { featureGate } from "../middleware/featureGate.middleware";
import { adminOrStaff } from "../middleware/staffPermission.middleware";
import upload from "../middleware/upload";
import { validate } from "../middleware/validate.middleware";
import { categoryAddSchema, categoryUpdateSchema } from "../schemas/category.schema";

const router = Router();

// Public — customers need this to browse
router.get("/list", categoryList);

// Admin/Staff — gated by CATEGORY_MANAGEMENT feature flag + granular permission
router.post(
  "/add",
  authMiddleware,
  adminOrStaff("CATEGORY_ADD"),
  featureGate("CATEGORY_MANAGEMENT"),
  upload.single("image"),
  validate(categoryAddSchema),
  categoryAdd,
);
router.put(
  "/update/:id",
  authMiddleware,
  adminOrStaff("CATEGORY_EDIT"),
  featureGate("CATEGORY_MANAGEMENT"),
  upload.single("image"),
  validate(categoryUpdateSchema),
  categoryUpdate,
);
router.delete(
  "/delete/:id",
  authMiddleware,
  adminOrStaff("CATEGORY_DELETE"),
  featureGate("CATEGORY_MANAGEMENT"),
  categoryDelete,
);

// ── Category Attribute routes ──────────────────────────────────────────────────
// Public: anyone can read attributes (needed for product-add form + customer filter)
router.get("/:categoryId/attributes", getCategoryAttributes);

// Admin/Staff — manage attributes
router.post(
  "/:categoryId/attributes",
  authMiddleware,
  adminOrStaff("CATEGORY_EDIT"),
  featureGate("CATEGORY_MANAGEMENT"),
  addCategoryAttribute,
);
router.put(
  "/:categoryId/attributes/:attrId",
  authMiddleware,
  adminOrStaff("CATEGORY_EDIT"),
  featureGate("CATEGORY_MANAGEMENT"),
  updateCategoryAttribute,
);
router.delete(
  "/:categoryId/attributes/:attrId",
  authMiddleware,
  adminOrStaff("CATEGORY_EDIT"),
  featureGate("CATEGORY_MANAGEMENT"),
  deleteCategoryAttribute,
);

// Admin/Staff — manage attribute values
router.post(
  "/:categoryId/attributes/:attrId/values",
  authMiddleware,
  adminOrStaff("CATEGORY_EDIT"),
  featureGate("CATEGORY_MANAGEMENT"),
  addAttributeValue,
);
router.put(
  "/:categoryId/attributes/:attrId/values/:valueId",
  authMiddleware,
  adminOrStaff("CATEGORY_EDIT"),
  featureGate("CATEGORY_MANAGEMENT"),
  updateAttributeValue,
);
router.delete(
  "/:categoryId/attributes/:attrId/values/:valueId",
  authMiddleware,
  adminOrStaff("CATEGORY_EDIT"),
  featureGate("CATEGORY_MANAGEMENT"),
  deleteAttributeValue,
);

export default router;
