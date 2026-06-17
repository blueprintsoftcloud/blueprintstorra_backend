// src/middleware/featureGate.middleware.ts
//
// Tenant-scoped feature gate — replaces the legacy global FeatureFlag model.
//
// Access is granted only when the requesting tenant's active Subscription
// covers the requested feature, either via the base plan or a purchased add-on.
//
// Role handling:
//   SUPER_ADMIN → bypasses all gates (must always be able to manage tenants).
//   ADMIN       → shopOwnerId = req.user.id (direct lookup).
//   STAFF       → StaffProfile.managedBy is resolved first to get the Admin ID.
//   other       → fail-closed (CUSTOMERs must never reach admin-gated routes).

import { Request, Response, NextFunction } from 'express';
import { Subscription, StaffProfile, Plan, FeatureFlag, User } from '../models/mongoose';
import type { FeatureType } from '../config/plans';
import { AppError } from '../utils/AppError';

export const featureGate = (requestedFeature: FeatureType) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Super Admins are never gated — they manage the platform itself.
    if (req.user?.role === 'SUPER_ADMIN') {
      next();
      return;
    }

    try {
      // ── 1. Resolve the owning Admin's ID ────────────────────────────────
      let shopOwnerId: string;

      if (req.user?.role === 'ADMIN') {
        // Secondary admins share the primary admin's subscription.
        // req.user.isPrimaryAdmin and req.user.primaryAdminId are embedded in the JWT.
        if (req.user.isPrimaryAdmin) {
          shopOwnerId = req.user.id;
        } else if (req.user.primaryAdminId) {
          shopOwnerId = req.user.primaryAdminId;
        } else {
          // Orphaned secondary admin — no primary linked in token.
          res.status(403).json({ message: 'Admin account is not linked to a primary admin.' });
          return;
        }
      } else if (req.user?.role === 'STAFF') {
        // Staff are employed under an Admin tenant. We must resolve the owning
        // Admin's ID from StaffProfile before we can check their subscription.
        const staffProfile = await StaffProfile.findOne({ userId: req.user.id }).lean();
        if (!staffProfile) {
          res.status(403).json({ message: 'Staff profile not found.' });
          return;
        }
        shopOwnerId = staffProfile.managedBy.toString();

        const owner = await User.findById(shopOwnerId).select('role').lean();
        if (owner && owner.role === 'SUPER_ADMIN') {
          // If managed by SUPER_ADMIN, they bypass active subscription query
          // but are still subject to Layer 1 (Global Kill Switch).
          const globalFlag = await FeatureFlag.findOne({ feature: requestedFeature }).lean();
          if (globalFlag && globalFlag.isEnabled === false) {
            res.status(403).json({
              message: 'Feature temporarily disabled for maintenance.',
              feature: requestedFeature,
            });
            return;
          }
          next();
          return;
        }
      } else {
        // CUSTOMER or unauthenticated — should never reach an admin feature gate.
        // Fail closed rather than silently passing.
        res.status(403).json({ message: 'Access denied.' });
        return;
      }

      // ── 2. Layer 1 — Global Kill Switch ─────────────────────────────────
      // The Super Admin may disable any feature platform-wide for maintenance.
      // This overrides plan entitlements and add-ons unconditionally.
      const globalFlag = await FeatureFlag.findOne({ feature: requestedFeature }).lean();
      if (globalFlag && globalFlag.isEnabled === false) {
        res.status(403).json({
          message: 'Feature temporarily disabled for maintenance.',
          feature: requestedFeature,
        });
        return;
      }

      // ── 3. Fetch the tenant's active subscription ────────────────────────
      // findOne hits the unique index on adminId (O(1) point query).
      const sub = await Subscription.findOne({
        adminId: shopOwnerId,
        status: 'ACTIVE',
      }).lean();

      if (!sub) {
        res.status(403).json({
          message: 'No active subscription found for this account. Please contact your administrator.',
        });
        return;
      }

      // ── 4. Fetch the live plan definition (Layer 2 — Plan Toggles) ──────
      // Plan has a unique index on `code` → O(1) point query.
      const plan = await Plan.findOne({ code: sub.planCode }).lean();

      if (!plan) {
        return next(new AppError(404, 'Subscribed tier template no longer exists. Please contact support.'));
      }

      // ── 5. Evaluate access: Plan toggles (Layer 2) + Add-ons (Layer 3) ──
      // A plan entry with isEnabled: false counts as absent — the feature is
      // "in the plan" by code but paused by the Super Admin.
      const inPlan = plan.features.some(
        (f) => f.feature === requestedFeature && f.isEnabled === true,
      );
      const isAddon = sub.purchasedAddons.includes(requestedFeature);

      // ── 6. Gate ──────────────────────────────────────────────────────────
      if (!inPlan && !isAddon) {
        res.status(403).json({
          message: 'Your current subscription tier does not include access to this feature. Please upgrade your plan to unlock.',
          feature: requestedFeature,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
