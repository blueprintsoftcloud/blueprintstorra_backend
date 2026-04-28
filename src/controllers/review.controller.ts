// src/controllers/review.controller.ts
// Handles product reviews — create, read, delete.
// Only customers with a DELIVERED order containing the product may submit a review.
// Controlled by the PRODUCT_REVIEWS feature flag.

import { Request, Response } from "express";
import { Review, Product, User } from "../models/mongoose";
import logger from "../utils/logger";

// ─── Helper: is PRODUCT_REVIEWS feature enabled ───────────────────────────────
async function isReviewsEnabled(): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({
    where: { feature: "PRODUCT_REVIEWS" },
  });
  return flag?.isEnabled ?? true; // default enabled if no row
}

// ─── Helper: recalculate + save product aggregate rating ─────────────────────
async function recalcProductRating(productId: string): Promise<void> {
  const stats = await prisma.review.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await prisma.product.update({
    where: { id: productId },
    data: {
      rating: Math.round((stats._avg.rating ?? 0) * 10) / 10,
      numReviews: stats._count.rating,
    },
  });
}

// GET /api/reviews/:productId  (public — optionalAuth)
// Returns all reviews for a product. 403 if feature is disabled.
export const getProductReviews = async (req: Request, res: Response) => {
  try {
    if (!(await isReviewsEnabled())) {
      return res.status(403).json({ message: "Product reviews are currently disabled.", feature: "PRODUCT_REVIEWS" });
    }

    const productId = String(req.params.productId);

    const reviews = await prisma.review.findMany({
      where: { productId },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Aggregate stats
    const total = reviews.length;
    const avg = total > 0 ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / total : 0;
    const distribution = [5, 4, 3, 2, 1].map((star: number) => ({
      star,
      count: reviews.filter((r: any) => r.rating === star).length,
    }));

    return res.json({ reviews, total, avg: Math.round(avg * 10) / 10, distribution });
  } catch (err) {
    logger.error("getProductReviews error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/reviews/my/:productId  (requires auth — CUSTOMER)
// Returns the current user's review for a product, or null.
export const getMyReview = async (req: Request, res: Response) => {
  try {
    if (!(await isReviewsEnabled())) {
      return res.status(403).json({ message: "Product reviews are currently disabled.", feature: "PRODUCT_REVIEWS" });
    }

    const productId = String(req.params.productId);
    const userId = req.user!.id;

    const review = await prisma.review.findFirst({
      where: { userId, productId },
    });

    // Also check if eligible to review (DELIVERED order with this product)
    const hasPurchased = await prisma.orderItem.findFirst({
      where: {
        productId,
        order: { userId, orderStatus: "DELIVERED" },
      },
      select: { id: true },
    });

    return res.json({ review, canReview: !!hasPurchased });
  } catch (err) {
    logger.error("getMyReview error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/reviews/:productId  (requires auth — CUSTOMER)
// Creates a review. User must have a DELIVERED order containing the product.
export const createReview = async (req: Request, res: Response) => {
  try {
    if (!(await isReviewsEnabled())) {
      return res.status(403).json({ message: "Product reviews are currently disabled.", feature: "PRODUCT_REVIEWS" });
    }

    const productId = String(req.params.productId);
    const { rating, comment } = req.body;
    const userId = req.user!.id;

    // Only customers can post reviews
    if (req.user!.role !== "CUSTOMER") {
      return res.status(403).json({ message: "Only customers can submit reviews." });
    }

    // Validate rating
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Rating must be an integer between 1 and 5." });
    }

    // Validate product exists
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    // Verify customer has a DELIVERED order containing this product
    const hasPurchased = await prisma.orderItem.findFirst({
      where: {
        productId,
        order: { userId, orderStatus: "DELIVERED" },
      },
      select: { id: true },
    });

    if (!hasPurchased) {
      return res.status(403).json({ message: "You can only review products from a completed (delivered) order." });
    }

    // One review per customer per product
    const existing = await prisma.review.findFirst({
      where: { userId, productId },
    });
    if (existing) {
      return res.status(409).json({ message: "You have already reviewed this product." });
    }

    const sanitizedComment = typeof comment === "string" ? comment.trim().slice(0, 1000) : null;

    const review = await prisma.review.create({
      data: { userId, productId, rating: ratingNum, comment: sanitizedComment || null },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
    });

    await recalcProductRating(productId);

    return res.status(201).json({ message: "Review submitted successfully!", review });
  } catch (err) {
    logger.error("createReview error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PATCH /api/reviews/:reviewId  (requires auth — CUSTOMER, own review only)
// Update a review.
export const updateReview = async (req: Request, res: Response) => {
  try {
    if (!(await isReviewsEnabled())) {
      return res.status(403).json({ message: "Product reviews are currently disabled.", feature: "PRODUCT_REVIEWS" });
    }

    const reviewId = String(req.params.reviewId);
    const { rating, comment } = req.body;
    const userId = req.user!.id;

    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return res.status(404).json({ message: "Review not found." });
    if (review.userId !== userId) return res.status(403).json({ message: "You can only edit your own review." });

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Rating must be an integer between 1 and 5." });
    }

    const sanitizedComment = typeof comment === "string" ? comment.trim().slice(0, 1000) : null;

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: { rating: ratingNum, comment: sanitizedComment || null },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
    });

    await recalcProductRating(review.productId);

    return res.json({ message: "Review updated.", review: updated });
  } catch (err) {
    logger.error("updateReview error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// DELETE /api/reviews/:reviewId  (customer deletes own, admin deletes any)
export const deleteReview = async (req: Request, res: Response) => {
  try {
    const reviewId = String(req.params.reviewId);
    const userId = req.user!.id;
    const role = req.user!.role;

    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) return res.status(404).json({ message: "Review not found." });

    // Customers can only delete their own; admins/super_admins can delete any
    if (role === "CUSTOMER" && review.userId !== userId) {
      return res.status(403).json({ message: "You can only delete your own review." });
    }
    if (role === "STAFF") {
      return res.status(403).json({ message: "Staff cannot delete reviews." });
    }

    await prisma.review.delete({ where: { id: reviewId } });
    await recalcProductRating(review.productId);

    return res.json({ message: "Review deleted." });
  } catch (err) {
    logger.error("deleteReview error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/reviews/admin/all  (admin — list all reviews with pagination)
export const getAllReviewsAdmin = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20", productId } = req.query as Record<string, string>;

    const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * pageSize;

    const where = productId ? { productId: String(productId) } : {};

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          user: { select: { id: true, username: true, email: true, avatar: true } },
          product: { select: { id: true, name: true, image: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.review.count({ where }),
    ]);

    return res.json({
      reviews,
      pagination: { total, page: parseInt(page) || 1, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    logger.error("getAllReviewsAdmin error", err);
    return res.status(500).json({ message: "Server error" });
  }
};
