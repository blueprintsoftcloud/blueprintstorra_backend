// src/middleware/auth.middleware.ts
// Verifies the JWT access token from the HttpOnly cookie.
// Sets req.user = { id, email, role } on success.
// Returns 401 on missing or invalid token, with an 'expired' flag for the frontend interceptor.

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

interface JwtPayload {
  id: string;
  email: string;
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN" | "STAFF";
}

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const token = req.cookies?.jwt as string | undefined;

  if (!token) {
    res.status(401).json({ message: "Access Denied. No token provided." });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (err: unknown) {
    const isExpired = err instanceof Error && err.name === "TokenExpiredError";
    res.status(401).json({
      message: isExpired
        ? "Session expired. Please log in again."
        : "Invalid token.",
      expired: isExpired,
    });
  }
};
