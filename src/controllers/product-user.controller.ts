import { Request, Response } from "express";
import { Types } from "mongoose";
import { Product, Category, Review } from "../models/mongoose";
import logger from "../utils/logger";

// GET /api/user/categories  — lightweight category list for user display
export const getAllCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true, image: true },
      orderBy: { name: "asc" },
    });
    res
      .status(200)
      .json({ message: "Category fetched in user display", categories });
  } catch (err: any) {
    logger.error("getAllCategories error", err);
    res.status(500).json({ message: "Error in category fetching" });
  }
};

// GET /api/user/products?page=1&limit=24  — all active products with category
export const getAllProducts = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "24", featured } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "24") || 24, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    const where: Record<string, unknown> = { isActive: true };
    if (featured === "true") where.isFeatured = true;

    const orderBy = featured === "true"
      ? [{ featuredOrder: "asc" as const }, { name: "asc" as const }]
      : [{ createdAt: "desc" as const }];

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          image: true,
          description: true,
          price: true,
          category: { select: { id: true, name: true } },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    res.status(200).json({
      message: "Products fetched successfully",
      products,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getAllProducts error", err);
    res.status(500).json({ message: "Error in products fetching" });
  }
};

// GET /api/user/shop/categories/:categoryId?page=1&limit=12&sort=featured&minPrice=&maxPrice=&sizes=S,M&inStock=true&onSale=true&attrs={}
export const getProductsByCategoryId = async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.categoryId as string;
    const {
      page = "1",
      limit = "12",
      sort,
      minPrice,
      maxPrice,
      sizes,
      inStock,
      onSale,
      attrs,
      attributeValueIds,
    } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "12") || 12, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    const where: Prisma.ProductWhereInput = { categoryId, isActive: true };

    // Price range filter
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice && !isNaN(parseFloat(minPrice))) {
        (where.price as Prisma.FloatFilter).gte = parseFloat(minPrice);
      }
      if (maxPrice && !isNaN(parseFloat(maxPrice))) {
        (where.price as Prisma.FloatFilter).lte = parseFloat(maxPrice);
      }
    }

    // Size filter (legacy — still supported)
    if (sizes && sizes.trim().length > 0) {
      const sizeList = sizes.split(",").map((s) => s.trim()).filter(Boolean);
      if (sizeList.length > 0) {
        where.sizes = { hasSome: sizeList };
      }
    }

    // In-stock filter
    if (inStock === "true") {
      where.stock = { gt: 0 };
    }

    // On-sale filter (discount > 0)
    if (onSale === "true") {
      where.discount = { gt: 0 };
    }

    // Dynamic attribute filters: attrs={"attrId":"valueId1,valueId2",...}
    if (attrs) {
      try {
        const attrFilters: Record<string, string> = JSON.parse(attrs);
        const attrConditions: Prisma.ProductWhereInput[] = Object.entries(attrFilters)
          .filter(([, val]) => val)
          .map(([attributeId, val]) => {
            const valueIds = val.split(",").filter(Boolean);
            return {
              attributeValues: {
                some: {
                  attributeId,
                  ...(valueIds.length > 0
                    ? { attributeValueId: { in: valueIds } }
                    : {}),
                },
              },
            };
          });
        if (attrConditions.length > 0) {
          where.AND = attrConditions;
        }
      } catch { /* ignore malformed JSON */ }
    }

    // attributeValueIds: comma-separated list of CategoryAttributeValue IDs
    // matches products that have ALL the selected values (across different attributes)
    if (attributeValueIds && attributeValueIds.trim().length > 0) {
      const ids = attributeValueIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        const existing = (where.AND as Prisma.ProductWhereInput[] | undefined) ?? [];
        (where.AND as Prisma.ProductWhereInput[]) = [
          ...existing,
          {
            attributeValues: {
              some: { attributeValueId: { in: ids } },
            },
          },
        ];
      }
    }

    // Sort
    const orderByMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      "price-asc":  { price: "asc" },
      "price-desc": { price: "desc" },
      newest:       { createdAt: "desc" },
      popular:      { rating: "desc" },
      featured:     { createdAt: "desc" },
    };
    const orderBy = orderByMap[sort ?? "featured"] ?? { createdAt: "desc" };

    const [getProducts, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          attributeValues: {
            include: {
              attribute: { select: { id: true, name: true, type: true } },
              attributeValue: { select: { id: true, value: true } },
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    res.status(200).json({
      message: "Products fetched by the selected category ID",
      getProducts,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getProductsByCategoryId error", err);
    res.status(500).json({
      message: "Error in products fetching by the selected category ID",
    });
  }
};

// GET /api/user/products/:productId  — product detail + related
export const productCard = async (req: Request, res: Response) => {
  try {
    const productId = req.params.productId as string;

    if (!Types.ObjectId.isValid(productId)) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: { select: { id: true, name: true } },
        reviews: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            user: { select: { id: true, username: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        attributeValues: {
          include: {
            attribute: { select: { id: true, name: true, type: true, isFilterable: true } },
            attributeValue: { select: { id: true, value: true } },
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const relatedProducts = await prisma.product.findMany({
      where: {
        categoryId: product.categoryId,
        id: { notIn: [product.id] },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        price: true,
        image: true,
        stock: true,
        rating: true,
      },
      take: 4,
    });

    res.status(200).json({
      message: "Product details fetched successfully",
      product: {
        ...product,
        inStock: product.stock > 0,
        stockStatus: product.stock > 0 ? "In Stock" : "Out of Stock",
      },
      relatedProducts,
    });
  } catch (err: any) {
    logger.error("productCard error", err);
    res.status(500).json({ message: "Server error fetching product details" });
  }
};

// GET /api/user/products/search?q=&category=&minPrice=&maxPrice=&minRating=&sort=&page=&limit=
export const searchProducts = async (req: Request, res: Response) => {
  try {
    const {
      q,
      category,
      minPrice,
      maxPrice,
      minRating,
      sort,
      page = "1",
      limit = "24",
    } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "24") || 24, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    // Build Prisma where clause
    const where: Prisma.ProductWhereInput = { isActive: true };

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    if (category) {
      const catDoc = await prisma.category.findFirst({
        where: {
          OR: [
            { name: { equals: category, mode: "insensitive" } },
            { code: category },
          ],
        },
        select: { id: true },
      });
      where.categoryId = catDoc?.id ?? "__no_match__";
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice && !isNaN(parseFloat(minPrice)))
        (where.price as Prisma.FloatFilter).gte = parseFloat(minPrice);
      if (maxPrice && !isNaN(parseFloat(maxPrice)))
        (where.price as Prisma.FloatFilter).lte = parseFloat(maxPrice);
    }

    if (minRating && !isNaN(parseFloat(minRating))) {
      where.rating = { gte: Math.max(1, Math.min(5, parseFloat(minRating))) };
    }

    // Sort
    const orderByMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      "price-asc": { price: "asc" },
      "price-desc": { price: "desc" },
      newest: { createdAt: "desc" },
      rating: { rating: "desc" },
    };
    const orderBy = orderByMap[sort ?? ""] ?? { createdAt: "desc" };

    const [totalItems, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          price: true,
          rating: true,
          image: true,
          category: { select: { id: true, name: true } },
        },
      }),
    ]);

    res.status(200).json({
      items,
      total: totalItems,
      page: parseInt(page ?? "1"),
      pageSize,
      totalPages: Math.ceil(totalItems / pageSize),
    });
  } catch (err: any) {
    logger.error("searchProducts error", err);
    res
      .status(500)
      .json({
        message: "An unexpected server error occurred during search",
        details: err.message,
      });
  }
};

// POST /api/user/products/:id/reviews  (authenticated)
export const createProductReview = async (req: Request, res: Response) => {
  try {
    const productId = req.params.id as string;
    const userId = req.user!.id;
    const { rating, comment } = req.body;

    if (
      !rating ||
      isNaN(Number(rating)) ||
      Number(rating) < 1 ||
      Number(rating) > 5
    ) {
      return res
        .status(400)
        .json({ message: "Rating must be a number between 1 and 5" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if user already reviewed
    const existing = await prisma.review.findFirst({
      where: { productId, userId },
    });
    if (existing) {
      return res.status(400).json({ message: "Product already reviewed" });
    }

    // Create review
    await prisma.review.create({
      data: {
        productId,
        userId,
        rating: Number(rating),
        comment: comment ?? null,
      },
    });

    // Recalculate product rating
    const aggResult = await prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await prisma.product.update({
      where: { id: productId },
      data: {
        rating: aggResult._avg.rating ?? 0,
        numReviews: aggResult._count.rating,
      },
    });

    res.status(201).json({ message: "Review added" });
  } catch (err: any) {
    logger.error("createProductReview error", err);
    res.status(500).json({ message: "Error creating review" });
  }
};

// GET /api/user/shop/global-search?q=text  (public)
export const globalSearch = async (req: Request, res: Response) => {
  try {
    const { q } = req.query as { q?: string };

    if (!q || q.trim().length < 1) {
      return res.status(200).json({ categories: [], products: [] });
    }

    const term = q.trim();

    const [categories, products] = await Promise.all([
      prisma.category.findMany({
        where: { isActive: true, name: { contains: term, mode: "insensitive" } },
        select: { id: true, name: true, image: true },
        take: 5,
      }),
      prisma.product.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          price: true,
          image: true,
          category: { select: { id: true, name: true } },
        },
        take: 8,
      }),
    ]);

    res.status(200).json({ categories, products });
  } catch (err: any) {
    logger.error("globalSearch error", err);
    res.status(500).json({ message: "Search failed" });
  }
};

// GET /api/user/profile  (authenticated)
export const getProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, phone: true, role: true },
    });
    res
      .status(200)
      .json({ message: "User profile data fetched successfully", users: user });
  } catch (err: any) {
    logger.error("getProfile error", err);
    res.status(500).json({ message: "Error in User profile data fetching" });
  }
};

// GET /api/user/shop/categories/:categoryId/filters
// Returns filterable attribute definitions + price range for the category's active products.
// The storefront filter panel calls this once per category to know what filters to render.
export const getProductFilters = async (req: Request, res: Response) => {
  try {
    const { categoryId } = req.params;

    const [attributes, priceAgg] = await Promise.all([
      prisma.categoryAttribute.findMany({
        where: { categoryId: categoryId as string, isFilterable: true },
        include: { values: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.product.aggregate({
        where: { categoryId: categoryId as string, isActive: true },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);

    res.json({
      attributes,
      priceRange: {
        min: priceAgg._min?.price ?? 0,
        max: priceAgg._max?.price ?? 0,
      },
    });
  } catch (err: any) {
    logger.error("getProductFilters error", err);
    res.status(500).json({ message: "Error fetching product filters" });
  }
};

