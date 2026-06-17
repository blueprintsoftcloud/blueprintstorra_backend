// src/routes/billing.routes.ts

import { Router } from 'express';
import {
  createUpgradeIntent,
  createAddonIntent,
  verifyPayment,
  getMySubscription,
} from '../controllers/billing.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware, adminOrStaffMiddleware } from '../middleware/admin.middleware';

const router = Router();

// ── Authenticated admin routes ─────────────────────────────────────────────
router.post('/upgrade', authMiddleware, adminMiddleware, createUpgradeIntent);
router.post('/addon',   authMiddleware, adminMiddleware, createAddonIntent);

// Synchronous payment verification — called by the frontend after Razorpay checkout.
router.post('/verify',  authMiddleware, adminMiddleware, verifyPayment);

// Billing dashboard data — current plan + available plans/add-ons.
router.get('/my-subscription', authMiddleware, adminOrStaffMiddleware, getMySubscription);

export default router;
