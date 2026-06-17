import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import {
  createRentalBooking,
  returnRentalBooking,
  listRentalBookings,
  getRentalBookingById
} from "../controllers/rental.controller";

const router = Router();

// Apply admin auth middlewares globally to all rental endpoints
router.use(authMiddleware, adminMiddleware);

// Define rental endpoints
router.post("/new", createRentalBooking);
router.patch("/:id/return", returnRentalBooking);
router.get("/", listRentalBookings);
router.get("/:id", getRentalBookingById);

export default router;
