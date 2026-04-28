import { Request, Response } from "express";
import { Product, Category, ProductAttributeValue } from "../models/mongoose";
import { deleteFromCloudinary, uploadToCloudinary } from "../config/cloudinary";
import logger from "../utils/logger";
import { createAuditLog } from "../utils/auditLog";

// GET /api/products/list?categoryId=xxx&page=1&limit=20  (admin)
export const productList = async (req: Request, res: Response) => {
  try {
    const { categoryId, page = "1", limit = "20" } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "20") || 20, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;
    const where = categoryId ? { categoryId: categoryId as string } : {};

    const [list, total] = await Promise.all([
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
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    res.status(200).json({
      list,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("productList error", err);
    res
      .status(500)
      .json({ message: "Error in viewing product list", error: err.message });
  }
};

// POST /api/products/add  (admin)
export const productAdd = async (req: Request, res: Response) => {
  try {
    const { code, name, description, price, purchasePrice, category, stock, discount } = req.body;
    const sizesRaw = req.body.sizes;
    const sizes: string[] = Array.isArray(sizesRaw) ? sizesRaw : (sizesRaw ? [sizesRaw] : []);

    if (!code || !name || !category || !price) {
      return res
        .status(400)
        .json({ message: "Code, name, category and price are required" });
    }

    const existing = await prisma.product.findFirst({
      where: { OR: [{ code }, { name }] },
    });
    if (existing) {
      return res
        .status(400)
        .json({ message: "A product with this code or name already exists" });
    }

    // Verify category exists
    const cat = await prisma.category.findUnique({ where: { id: category } });
    if (!cat) {
      return res.status(400).json({ message: "Category not found" });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    let imageUrl: string | null = null;
    if (files?.image?.[0]) {
      imageUrl = await uploadToCloudinary(files.image[0].buffer, `products/${code}`);
    }

    const additionalImages: string[] = [];
    if (files?.images?.length) {
      for (let i = 0; i < files.images.length; i++) {
        const url = await uploadToCloudinary(files.images[i].buffer, `products/${code}/gallery_${i}`);
        additionalImages.push(url);
      }
    }

    const product = await prisma.product.create({
      data: {
        code,
        name,
        description: description ?? null,
        price: parseFloat(price),
        purchasePrice: purchasePrice != null ? parseFloat(purchasePrice) : null,
        categoryId: category,
        image: imageUrl,
        images: additionalImages,
        stock: stock ? parseInt(stock) : 0,
        sizes,
        discount: discount ? parseFloat(discount) : 0,
      },
    });

    // Save dynamic attribute values
    if (req.body.attributeValues) {
      try {
        type AttrEntry = { attributeId: string; attributeValueId?: string; textValue?: string };
        const entries: AttrEntry[] = JSON.parse(req.body.attributeValues);
        const rows: { productId: string; attributeId: string; attributeValueId?: string; textValue?: string }[] = [];
        for (const entry of entries) {
          if (!entry.attributeId) continue;
          // MULTISELECT: comma-separated value IDs
          if (entry.attributeValueId && entry.attributeValueId.includes(",")) {
            for (const vid of entry.attributeValueId.split(",").filter(Boolean)) {
              rows.push({ productId: product.id, attributeId: entry.attributeId, attributeValueId: vid });
            }
          } else if (entry.attributeValueId) {
            rows.push({ productId: product.id, attributeId: entry.attributeId, attributeValueId: entry.attributeValueId });
          } else if (entry.textValue !== undefined) {
            rows.push({ productId: product.id, attributeId: entry.attributeId, textValue: String(entry.textValue) });
          }
        }
        if (rows.length > 0) {
          await prisma.productAttributeValue.createMany({ data: rows });
        }
      } catch { /* ignore malformed attribute payload */ }
    }

    await createAuditLog({ req, action: "ADD_PRODUCT", entity: "Product", entityId: product.id, details: { code: product.code, name: product.name, price: product.price, purchasePrice: product.purchasePrice, category: cat.name } });
    res.status(201).json({ message: "Product added successfully", product });
  } catch (err: any) {
    logger.error("productAdd error", err);
    res
      .status(500)
      .json({ message: "Error in product adding", error: err.message });
  }
};

// PUT /api/products/update/:id  (admin)
export const productUpdate = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { code, name, description, price, purchasePrice, category, stock, discount } = req.body;
    const sizesRaw = req.body.sizes;
    const sizes: string[] | undefined = sizesRaw !== undefined
      ? (Array.isArray(sizesRaw) ? sizesRaw : [sizesRaw])
      : undefined;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return res
        .status(404)
        .json({ message: "Cannot find product for updating" });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    let imageUrl = existing.image;
    if (files?.image?.[0]) {
      imageUrl = await uploadToCloudinary(
        files.image[0].buffer,
        `products/${code ?? existing.code}`,
      );
    }

    // Handle additional images
    let updatedImages = [...(existing.images ?? [])];
    if (req.body.removeImages) {
      try {
        const toRemove: string[] = JSON.parse(req.body.removeImages);
        updatedImages = updatedImages.filter((img) => !toRemove.includes(img));
      } catch { /* ignore parse errors */ }
    }
    if (files?.images?.length) {
      for (let i = 0; i < files.images.length; i++) {
        const url = await uploadToCloudinary(
          files.images[i].buffer,
          `products/${code ?? existing.code}/gallery_${Date.now()}_${i}`,
        );
        updatedImages.push(url);
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        code: code ?? existing.code,
        name: name ?? existing.name,
        description: description ?? existing.description,
        price: price ? parseFloat(price) : existing.price,
        purchasePrice: purchasePrice !== undefined ? (purchasePrice !== null ? parseFloat(purchasePrice) : null) : existing.purchasePrice,
        categoryId: category ?? existing.categoryId,
        image: imageUrl,
        images: updatedImages,
        stock: stock !== undefined ? parseInt(stock) : existing.stock,
        sizes: sizes ?? existing.sizes,
        discount: discount !== undefined ? parseFloat(discount) : existing.discount,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    // Replace attribute values: delete old rows, insert new ones
    if (req.body.attributeValues !== undefined) {
      await prisma.productAttributeValue.deleteMany({ where: { productId: id } });
      try {
        type AttrEntry = { attributeId: string; attributeValueId?: string; textValue?: string };
        const entries: AttrEntry[] = JSON.parse(req.body.attributeValues);
        const rows: { productId: string; attributeId: string; attributeValueId?: string; textValue?: string }[] = [];
        for (const entry of entries) {
          if (!entry.attributeId) continue;
          if (entry.attributeValueId && entry.attributeValueId.includes(",")) {
            for (const vid of entry.attributeValueId.split(",").filter(Boolean)) {
              rows.push({ productId: id, attributeId: entry.attributeId, attributeValueId: vid });
            }
          } else if (entry.attributeValueId) {
            rows.push({ productId: id, attributeId: entry.attributeId, attributeValueId: entry.attributeValueId });
          } else if (entry.textValue !== undefined) {
            rows.push({ productId: id, attributeId: entry.attributeId, textValue: String(entry.textValue) });
          }
        }
        if (rows.length > 0) {
          await prisma.productAttributeValue.createMany({ data: rows });
        }
      } catch { /* ignore malformed attribute payload */ }
    }

    await createAuditLog({ req, action: "UPDATE_PRODUCT", entity: "Product", entityId: updated.id, details: { code: updated.code, name: updated.name, price: updated.price, purchasePrice: updated.purchasePrice } });
    res
      .status(200)
      .json({ message: "Product updated successfully", product: updated });
  } catch (err: any) {
    logger.error("productUpdate error", err);
    res
      .status(500)
      .json({ message: "Error in product update", error: err.message });
  }
};

// DELETE /api/products/delete/:id  (admin)
export const productDelete = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res
        .status(404)
        .json({ message: "Cannot find product for deleting" });
    }

    // Block deletion if any open orders contain this product.
    // Auto-cancelling paid/confirmed orders on product delete causes silent
    // revenue loss — admin must resolve orders first.
    const openOrderCount = await prisma.order.count({
      where: {
        orderStatus: { notIn: ["DELIVERED", "CANCELLED"] },
        items: { some: { productId: id } },
      },
    });

    if (openOrderCount > 0) {
      return res.status(409).json({
        message: `Cannot delete: ${openOrderCount} open order${openOrderCount > 1 ? "s" : ""} contain this product. Wait until all orders are delivered or cancelled before deleting.`,
      });
    }

    // Remove from all carts
    await prisma.cartItem.deleteMany({ where: { productId: id } });

    // Remove from wishlists
    await prisma.wishlist.deleteMany({ where: { productId: id } });

    // Delete image from Cloudinary
    if (product.image) {
      await deleteFromCloudinary(product.image).catch((e: unknown) =>
        logger.warn("Failed to delete product image from Cloudinary", e),
      );
    }

    await prisma.product.delete({ where: { id } });
    await createAuditLog({ req, action: "DELETE_PRODUCT", entity: "Product", entityId: id, details: { code: product.code, name: product.name } });

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (err: any) {
    logger.error("productDelete error", err);
    res
      .status(500)
      .json({ message: "Error in product deleting", error: err.message });
  }
};
