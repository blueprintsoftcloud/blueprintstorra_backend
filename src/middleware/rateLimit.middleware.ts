// src/middleware/rateLimit.middleware.ts
// Granular rate limiters for sensitive endpoints.
// express-rate-limit v7 usage — windowMs + limit (replaces deprecated `max`).

import rateLimit from "express-rate-limit";

/**
 * Strict limiter for login & OTP verification:
 * 30 attempts per 15 minutes per IP.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
});

/**
 * OTP send/resend limiter:
 * 5 OTP requests per 10 minutes per IP.
 */
export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many OTP requests. Please wait 10 minutes before trying again.",
  },
});

/**
 * Signup limiter:
 * 10 registrations per hour per IP (prevents mass account creation).
 */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many accounts created from this IP. Try again after 1 hour.",
  },
});

/**
 * Password reset limiter:
 * 5 reset requests per 30 minutes per IP.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many password reset attempts. Try again after 30 minutes.",
  },
});

/**
 * General API limiter — applied at the app level in server.ts.
 * 200 requests per minute per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many requests. Please slow down.",
  },
});
