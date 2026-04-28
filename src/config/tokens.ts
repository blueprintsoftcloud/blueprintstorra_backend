import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Response } from "express";
import { User } from "../models/index";
import { env } from "./env";

const generateRefreshTokenValue = () => crypto.randomBytes(32).toString("hex");

export const generateToken = async (
  user: { id: string; email: string; role: string },
  res: Response,
): Promise<void> => {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const refreshTokenValue = generateRefreshTokenValue();
  const refreshToken = jwt.sign(
    { id: user.id, tokenValue: refreshTokenValue },
    env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" },
  );

  // Store refresh token value in DB
  await User.findByIdAndUpdate(user.id, {
    refreshToken: refreshTokenValue,
  });

  // In production (HTTPS) use sameSite:"none" + secure:true.
  // In development (plain HTTP over LAN/localhost) use sameSite:"lax" + secure:false
  // so browsers accept the cookie without a TLS connection.
  const isProd = env.NODE_ENV === "production";
  const cookieOpts = {
    httpOnly: true,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    secure: isProd,
  };

  // Purge any stale cookies that may have been stored under non-root paths in
  // older sessions. Browsers treat same-name cookies with different Path values
  // as distinct entries, so we must explicitly clear each stale path.
  // Known stale path: /api/auth/refresh (from an older deployment).
  for (const stalePath of ["/api/auth/refresh", "/api/auth", "/api"]) {
    res.clearCookie("jwt",          { ...cookieOpts, path: stalePath });
    res.clearCookie("refreshToken", { ...cookieOpts, path: stalePath });
  }

  res.cookie("jwt", accessToken, {
    maxAge: 60 * 60 * 1000, // 1 hour
    ...cookieOpts,
    path: "/",
  });

  res.cookie("refreshToken", refreshToken, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    ...cookieOpts,
    path: "/",
  });
};
