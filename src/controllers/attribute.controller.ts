import { Request, Response } from "express";
import { Attribute, AttributeValue } from "../models/mongoose";
import logger from "../utils/logger";
import { createAuditLog } from "../utils/auditLog";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/category/:categoryId/attributes
// Returns all attributes + their predefined values for a category.
// Used by: product-add form, product-edit form, customer filter panel.
export const getCategoryAttributes = async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.categoryId as string;

    const attributes = await prisma.categoryAttribute.findMany({
      where: { categoryId },
      include: { values: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });

    res.json({ attributes });
  } catch (err: any) {
    logger.error("getCategoryAttributes error", err);
    res.status(500).json({ message: "Error fetching category attributes" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — Attribute CRUD
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/category/:categoryId/attributes
export const addCategoryAttribute = async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.categoryId as string;
    const { name, type, isFilterable, isRequired, sortOrder } = req.body;

    if (!name || !type) {
      return res.status(400).json({ message: "name and type are required" });
    }

    const validTypes = ["SELECT", "MULTISELECT", "TEXT", "NUMBER", "BOOLEAN"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: `type must be one of: ${validTypes.join(", ")}` });
    }

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const attribute = await prisma.categoryAttribute.create({
      data: {
        categoryId,
        name: name.trim(),
        type,
        isFilterable: isFilterable !== undefined ? Boolean(isFilterable) : true,
        isRequired: isRequired !== undefined ? Boolean(isRequired) : false,
        sortOrder: sortOrder ? parseInt(sortOrder) : 0,
      },
      include: { values: true },
    });

    await createAuditLog({
      req,
      action: "ADD_CATEGORY_ATTRIBUTE",
      entity: "CategoryAttribute",
      entityId: attribute.id,
      details: { categoryId, name: attribute.name, type: attribute.type },
    });

    res.status(201).json({ message: "Attribute added", attribute });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "An attribute with this name already exists in this category" });
    }
    logger.error("addCategoryAttribute error", err);
    res.status(500).json({ message: "Error adding attribute" });
  }
};

// PUT /api/category/:categoryId/attributes/:attrId
export const updateCategoryAttribute = async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.categoryId as string;
    const attrId = req.params.attrId as string;
    const { name, type, isFilterable, isRequired, sortOrder } = req.body;

    const existing = await prisma.categoryAttribute.findFirst({
      where: { id: attrId, categoryId },
    });
    if (!existing) {
      return res.status(404).json({ message: "Attribute not found" });
    }

    if (type) {
      const validTypes = ["SELECT", "MULTISELECT", "TEXT", "NUMBER", "BOOLEAN"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: `type must be one of: ${validTypes.join(", ")}` });
      }
    }

    const updated = await prisma.categoryAttribute.update({
      where: { id: attrId },
      data: {
        name: name ? name.trim() : existing.name,
        type: type ?? existing.type,
        isFilterable: isFilterable !== undefined ? Boolean(isFilterable) : existing.isFilterable,
        isRequired: isRequired !== undefined ? Boolean(isRequired) : existing.isRequired,
        sortOrder: sortOrder !== undefined ? parseInt(sortOrder) : existing.sortOrder,
      },
      include: { values: { orderBy: { sortOrder: "asc" } } },
    });

    res.json({ message: "Attribute updated", attribute: updated });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "An attribute with this name already exists in this category" });
    }
    logger.error("updateCategoryAttribute error", err);
    res.status(500).json({ message: "Error updating attribute" });
  }
};

// DELETE /api/category/:categoryId/attributes/:attrId
export const deleteCategoryAttribute = async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.categoryId as string;
    const attrId = req.params.attrId as string;

    const existing = await prisma.categoryAttribute.findFirst({
      where: { id: attrId, categoryId },
    });
    if (!existing) {
      return res.status(404).json({ message: "Attribute not found" });
    }

    await prisma.categoryAttribute.delete({ where: { id: attrId } });

    await createAuditLog({
      req,
      action: "DELETE_CATEGORY_ATTRIBUTE",
      entity: "CategoryAttribute",
      entityId: attrId,
      details: { categoryId, name: existing.name },
    });

    res.json({ message: "Attribute deleted" });
  } catch (err: any) {
    logger.error("deleteCategoryAttribute error", err);
    res.status(500).json({ message: "Error deleting attribute" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — Attribute Value CRUD
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/category/:categoryId/attributes/:attrId/values
export const addAttributeValue = async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.categoryId as string;
    const attrId = req.params.attrId as string;
    const { value, sortOrder } = req.body;

    if (!value || !value.trim()) {
      return res.status(400).json({ message: "value is required" });
    }

    const attribute = await prisma.categoryAttribute.findFirst({
      where: { id: attrId, categoryId },
    });
    if (!attribute) {
      return res.status(404).json({ message: "Attribute not found" });
    }

    const attrValue = await prisma.categoryAttributeValue.create({
      data: {
        attributeId: attrId,
        value: value.trim(),
        sortOrder: sortOrder ? parseInt(sortOrder) : 0,
      },
    });

    res.status(201).json({ message: "Value added", value: attrValue });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "This value already exists for this attribute" });
    }
    logger.error("addAttributeValue error", err);
    res.status(500).json({ message: "Error adding attribute value" });
  }
};

// PUT /api/category/:categoryId/attributes/:attrId/values/:valueId
export const updateAttributeValue = async (req: Request, res: Response) => {
  try {
    const attrId = req.params.attrId as string;
    const valueId = req.params.valueId as string;
    const { value, sortOrder } = req.body;

    const existing = await prisma.categoryAttributeValue.findFirst({
      where: { id: valueId, attributeId: attrId },
    });
    if (!existing) {
      return res.status(404).json({ message: "Attribute value not found" });
    }

    const updated = await prisma.categoryAttributeValue.update({
      where: { id: valueId },
      data: {
        value: value ? value.trim() : existing.value,
        sortOrder: sortOrder !== undefined ? parseInt(sortOrder) : existing.sortOrder,
      },
    });

    res.json({ message: "Value updated", value: updated });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "This value already exists for this attribute" });
    }
    logger.error("updateAttributeValue error", err);
    res.status(500).json({ message: "Error updating attribute value" });
  }
};

// DELETE /api/category/:categoryId/attributes/:attrId/values/:valueId
export const deleteAttributeValue = async (req: Request, res: Response) => {
  try {
    const attrId = req.params.attrId as string;
    const valueId = req.params.valueId as string;

    const existing = await prisma.categoryAttributeValue.findFirst({
      where: { id: valueId, attributeId: attrId },
    });
    if (!existing) {
      return res.status(404).json({ message: "Attribute value not found" });
    }

    await prisma.categoryAttributeValue.delete({ where: { id: valueId } });

    res.json({ message: "Value deleted" });
  } catch (err: any) {
    logger.error("deleteAttributeValue error", err);
    res.status(500).json({ message: "Error deleting attribute value" });
  }
};
