// src/schemas/category.schema.ts
import { z } from "zod";

export const categoryAddSchema = z.object({
  code: z
    .string({ required_error: "Category code is required" })
    .min(1, "Code cannot be empty")
    .max(50, "Code too long")
    .trim(),
  name: z
    .string({ required_error: "Category name is required" })
    .min(1, "Name cannot be empty")
    .max(100, "Name too long")
    .trim(),
  description: z.string().max(500, "Description too long").trim().optional(),
});

export const categoryUpdateSchema = z.object({
  code: z.string().min(1).max(50).trim().optional(),
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).trim().optional(),
});
