// src/schemas/product.schema.ts
import { z } from "zod";

export const productAddSchema = z.object({
  code: z
    .string({ required_error: "Product code is required" })
    .min(1, "Code cannot be empty")
    .max(50, "Code too long")
    .trim(),
  name: z
    .string({ required_error: "Product name is required" })
    .min(1, "Name cannot be empty")
    .max(200, "Name too long")
    .trim(),
  description: z.string().max(2000, "Description too long").trim().optional(),
  purchasePrice: z
    .union([z.string(), z.number()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v) && v >= 0, "Purchase price must be a non-negative number")
    .optional(),
  price: z
    .union([z.string(), z.number()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v) && v >= 0, "Price must be a non-negative number"),
  category: z
    .string({ required_error: "Category ID is required" })
    .min(1, "Category is required"),
  stock: z
    .union([z.string(), z.number()])
    .transform((v) => parseInt(String(v), 10))
    .refine((v) => !isNaN(v) && v >= 0, "Stock must be a non-negative integer")
    .optional()
    .default(0),
});

export const productUpdateSchema = z.object({
  code: z.string().min(1).max(50).trim().optional(),
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(2000).trim().optional(),
  purchasePrice: z
    .union([z.string(), z.number()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v) && v >= 0, "Purchase price must be a non-negative number")
    .optional(),
  price: z
    .union([z.string(), z.number()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v) && v >= 0, "Price must be a non-negative number")
    .optional(),
  category: z.string().min(1).optional(),
  stock: z
    .union([z.string(), z.number()])
    .transform((v) => parseInt(String(v), 10))
    .refine((v) => !isNaN(v) && v >= 0, "Stock must be a non-negative integer")
    .optional(),
});
