import { Router } from "express";
import {
  getPublicBanners,
  getAllBannersAdmin,
  updateDiscountHeader,
  updateCarouselHeader,
  updateFeaturedHeader,
  updatePromoHeader,
  getFeaturedProducts,
  toggleFeaturedProduct,
  setFeaturedProductOrder,
  createBanner,
  updateBanner,
  deleteBanner,
  toggleBanner,
} from "../controllers/homeBanner.controller";
import { getHomepageConfig } from "../controllers/companySettings.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOrSuperAdmin } from "../middleware/admin.middleware";
import { featureGate } from "../middleware/featureGate.middleware";
import upload from "../middleware/upload";

const router = Router();

// Public — no auth required (used by the home page)
router.get("/", getPublicBanners);
router.get("/homepage-config", getHomepageConfig);

// Admin — authenticated + feature-gated
router.get("/admin", authMiddleware, adminOrSuperAdmin, getAllBannersAdmin);
router.put(
  "/discount-header",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  updateDiscountHeader,
);
router.put(
  "/carousel-header",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  updateCarouselHeader,
);
router.put(
  "/featured-header",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  updateFeaturedHeader,
);
router.put(
  "/promo-header",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  updatePromoHeader,
);

// Featured Products management
router.get(
  "/featured-products",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  getFeaturedProducts,
);
router.patch(
  "/featured-products/:productId/toggle",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  toggleFeaturedProduct,
);
router.patch(
  "/featured-products/:productId/order",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  setFeaturedProductOrder,
);

router.post(
  "/",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  upload.single("image"),
  createBanner,
);
router.put(
  "/:id",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  upload.single("image"),
  updateBanner,
);
router.delete(
  "/:id",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  deleteBanner,
);
router.patch(
  "/:id/toggle",
  authMiddleware,
  adminOrSuperAdmin,
  featureGate("HOMEPAGE_MANAGEMENT"),
  toggleBanner,
);

export default router;
