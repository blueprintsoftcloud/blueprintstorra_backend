// src/middleware/featureGate.middleware.ts
// Factory middleware that checks if a feature flag is enabled.
// Must be used AFTER authMiddleware + adminMiddleware (or superAdminMiddleware).
//
// Behaviour:
//   - SUPER_ADMIN: always passes through — feature gates never block Super Admin.
//   - ADMIN: passes only if the corresponding FeatureFlag.isEnabled === true.
//   - Returns 403 with { message, feature } if the feature is disabled.

import { Request, Response, NextFunction } from "express";
import { FeatureFlag, Feature } from "../models/mongoose";

export const featureGate = (feature: Feature) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Super Admin is never blocked by feature flags
    if (req.user?.role === "SUPER_ADMIN") {
      next();
      return;
    }

    try {
      const flag = await prisma.featureFlag.findUnique({
        where: { feature: feature as Feature },
      });

      // Only block if a row explicitly has isEnabled = false.
      // A missing row means the flag was never toggled — default is enabled.
      if (flag && !flag.isEnabled) {
        res.status(403).json({
          message: "This feature has been disabled by the Super Admin.",
          feature,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
