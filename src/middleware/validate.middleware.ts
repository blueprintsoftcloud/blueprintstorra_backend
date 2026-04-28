// src/middleware/validate.middleware.ts
// Reusable Zod validation middleware.
// Usage:  router.post('/signup', validate(signupSchema), signupController)
// On failure: returns 400 with field-level error messages.
// On success: req.body is replaced with the parsed (and typed) data.

import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";

export const validate =
  (schema: AnyZodObject) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      res.status(400).json({
        message: "Validation failed",
        errors,
      });
      return;
    }

    req.body = result.data; // Replace with sanitised/coerced data
    next();
  };
