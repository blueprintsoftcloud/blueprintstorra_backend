import { Request, Response } from "express";
import { Category, Product } from "../models/mongoose";
import { deleteFromCloudinary, uploadToCloudinary } from "../config/cloudinary";
import logger from "../utils/logger";
import { createAuditLog } from "../utils/auditLog";

// GET /api/categories
export const categoryList = async (req: Request, res: Response) => {
  try {
    const list = await prisma.category.findMany({
      orderBy: { name: "asc" },
    });
    console.log("Categories from DB:", list); // Debug log
    res.json({ list });
  } catch (err: any) {
    logger.error("categoryList error", err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/categories  (admin)
export const categoryAdd = async (req: Request, res: Response) => {
  try {
    const { code, name, description } = req.body;

    if (!code || !name) {
      return res.status(400).json({ message: "Code and Name are required" });
    }

    // Upload image to Cloudinary if provided
    let imageUrl: string | null = null;
    if (req.file) {
      imageUrl = await uploadToCloudinary(
        req.file.buffer,
        `categories/${code}`,
      );
    }

    const category = await prisma.category.create({
      data: {
        code,
        name,
        description: description ?? null,
        image: imageUrl,
      },
    });

    await createAuditLog({ req, action: "ADD_CATEGORY", entity: "Category", entityId: category.id, details: { code: category.code, name: category.name } });
    res.status(201).json({ message: "Admin added new category", category });
  } catch (err: any) {
    logger.error("categoryAdd error", err);
    res
      .status(500)
      .json({ message: "Error in category adding", error: err.message });
  }
};

// PUT /api/categories/:id  (admin)
export const categoryUpdate = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { code, name, description } = req.body;

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Category not found" });
    }

    let imageUrl = existing.image;
    if (req.file) {
      imageUrl = await uploadToCloudinary(
        req.file.buffer,
        `categories/${code ?? existing.code}`,
      );
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        code: code ?? existing.code,
        name: name ?? existing.name,
        description: description ?? existing.description,
        image: imageUrl,
      },
    });

    await createAuditLog({ req, action: "UPDATE_CATEGORY", entity: "Category", entityId: updated.id, details: { code: updated.code, name: updated.name } });
    res
      .status(200)
      .json({ message: "Category updated successfully", category: updated });
  } catch (err: any) {
    logger.error("categoryUpdate error", err);
    res
      .status(500)
      .json({ message: "Error in category update", error: err.message });
  }
};

// DELETE /api/categories/:id  (admin)
export const categoryDelete = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // 1. Find all products in this category
    const products = await prisma.product.findMany({
      where: { categoryId: id },
      select: { id: true },
    });
    const productIds = products.map((p: any) => p.id);

    // 2. Block deletion if any open orders contain products in this category.
    // Silently auto-cancelling paid/confirmed orders on category delete would
    // cause unrecoverable revenue loss — admin must resolve orders first.
    if (productIds.length > 0) {
      const openOrderCount = await prisma.order.count({
        where: {
          orderStatus: { notIn: ["DELIVERED", "CANCELLED"] },
          items: { some: { productId: { in: productIds } } },
        },
      });

      if (openOrderCount > 0) {
        return res.status(409).json({
          message: `Cannot delete: ${openOrderCount} open order${openOrderCount > 1 ? "s" : ""} contain products from this category. Wait until all orders are delivered or cancelled before deleting.`,
        });
      }

      // 3. Remove deleted products from all carts, then recalculate totals
      const affectedCarts = await prisma.cart.findMany({
        where: { items: { some: { productId: { in: productIds } } } },
        include: { items: { include: { product: true } } },
      });

      for (const cart of affectedCarts) {
        // Remove items for deleted products
        await prisma.cartItem.deleteMany({
          where: {
            cartId: cart.id,
            productId: { in: productIds },
          },
        });
        // Cart total is computed on-the-fly from CartItems — no stored total to update
      }

      // 4. Delete the products themselves
      await prisma.product.deleteMany({ where: { categoryId: id } });
    }

    // 5. Delete category image from Cloudinary
    if (category.image) {
      await deleteFromCloudinary(category.image).catch((e: unknown) =>
        logger.warn("Failed to delete category image from Cloudinary", e),
      );
    }

    // 6. Delete the category
    await prisma.category.delete({ where: { id } });
    await createAuditLog({ req, action: "DELETE_CATEGORY", entity: "Category", entityId: id, details: { name: category.name } });

    res.status(200).json({ message: "Category deleted successfully" });
  } catch (err: any) {
    logger.error("categoryDelete error", err);
    res
      .status(500)
      .json({ message: "Error in category Delete", error: err.message });
  }
};
