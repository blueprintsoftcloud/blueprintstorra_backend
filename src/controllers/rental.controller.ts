import { Request, Response } from "express";
import mongoose from "mongoose";
import { RentalBooking, Product } from "../models";
import logger from "../utils/logger";

/**
 * POST /api/admin/rentals/new
 * Creates a new rental booking contract.
 * Checks stock levels atomically and reserves stock.
 */
export const createRentalBooking = async (req: Request, res: Response) => {
  try {
    const {
      customerName,
      phone,
      address,
      items,
      fromDate,
      toDate,
      advancePaid = 0,
      paymentMethod = 'CASH',
      documents = [],
      submitTime
    } = req.body;

    // 1. Input Validation
    if (!customerName || typeof customerName !== "string" || !customerName.trim()) {
      return res.status(400).json({ message: "customerName is required and must be a non-empty string" });
    }
    if (!phone || typeof phone !== "string" || !phone.trim()) {
      return res.status(400).json({ message: "phone is required and must be a non-empty string" });
    }
    if (!fromDate || isNaN(Date.parse(fromDate))) {
      return res.status(400).json({ message: "fromDate is required and must be a valid date" });
    }
    if (!toDate || isNaN(Date.parse(toDate))) {
      return res.status(400).json({ message: "toDate is required and must be a valid date" });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items must be a non-empty array of rental products" });
    }

    for (const item of items) {
      if (!item.productId || !mongoose.Types.ObjectId.isValid(item.productId)) {
        return res.status(400).json({ message: `Invalid or missing productId in items: ${item.productId}` });
      }
      if (item.quantity === undefined || typeof item.quantity !== "number" || item.quantity < 1) {
        return res.status(400).json({ message: "Each item must have a quantity of at least 1" });
      }
    }

    // 2. Enforce date rules: toDate >= fromDate
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const diffTime = end.getTime() - start.getTime();
    if (diffTime < 0) {
      return res.status(400).json({ message: "toDate must be greater than or equal to fromDate" });
    }
    const totalDurationDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) || 0;

    // Check if replica set is available for transactions
    let session: mongoose.ClientSession | null = null;
    let isReplicaSet = true;
    try {
      session = await mongoose.startSession();
    } catch (e: any) {
      logger.warn("Mongoose could not start a session. Falling back to standalone atomic fallback.", e);
      isReplicaSet = false;
    }

    if (isReplicaSet && session) {
      // ────────────────── TRANSACTION FLOW ──────────────────
      session.startTransaction();
      try {
        // Stock availability checks inside transaction
        for (const item of items) {
          const product = await Product.findById(item.productId).session(session);
          if (!product) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: `Product not found: ${item.productId}` });
          }
          const availableStock = product.rentalStock ?? 0;
          if (availableStock < item.quantity) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              message: `Insufficient rental stock for product "${product.name}". Available: ${availableStock}, Requested: ${item.quantity}`
            });
          }
        }

        // Deduct stock levels inside transaction
        for (const item of items) {
          const product = await Product.findById(item.productId).session(session);
          if (product) {
            product.rentalStock = (product.rentalStock ?? 0) - item.quantity;
            product.stock = (product.stock ?? 0) - item.quantity;
            product.stockQuantity = (product.stockQuantity ?? 0) - item.quantity;
            await product.save({ session });
          }
        }

        // Create booking document inside transaction
        const booking = new RentalBooking({
          customerName: customerName.trim(),
          phone: phone.trim(),
          address,
          items,
          fromDate: start,
          toDate: end,
          totalDurationDays,
          advancePaid,
          paymentMethod,
          documents,
          status: 'Active',
          submitTime: submitTime ? new Date(submitTime) : new Date()
        });
        await booking.save({ session });

        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
          message: "Rental booking created successfully",
          booking
        });
      } catch (error: any) {
        await session.abortTransaction();
        session.endSession();
        logger.error("createRentalBooking transaction error", error);
        return res.status(500).json({ message: "Transaction failed while creating rental booking", error: error.message });
      }
    } else {
      // ────────────────── STANDALONE FALLBACK FLOW ──────────────────
      // 1. Initial lock-free check
      for (const item of items) {
        const product = await Product.findById(item.productId);
        if (!product) {
          return res.status(404).json({ message: `Product not found: ${item.productId}` });
        }
        const availableStock = product.rentalStock ?? 0;
        if (availableStock < item.quantity) {
          return res.status(400).json({
            message: `Insufficient rental stock for product "${product.name}". Available: ${availableStock}, Requested: ${item.quantity}`
          });
        }
      }

      // 2. Perform conditional atomic updates to prevent race conditions
      const modifiedProducts: { productId: string; quantity: number }[] = [];
      try {
        for (const item of items) {
          const updatedProduct = await Product.findOneAndUpdate(
            { _id: item.productId, rentalStock: { $gte: item.quantity } },
            { $inc: { rentalStock: -item.quantity, stock: -item.quantity, stockQuantity: -item.quantity } },
            { new: true }
          );

          if (!updatedProduct) {
            // Concurrency rollback
            for (const rolledBack of modifiedProducts) {
              await Product.findByIdAndUpdate(rolledBack.productId, {
                $inc: { rentalStock: rolledBack.quantity, stock: rolledBack.quantity, stockQuantity: rolledBack.quantity }
              });
            }
            return res.status(400).json({
              message: `Concurrency conflict: stock was taken for product ID: ${item.productId}`
            });
          }

          modifiedProducts.push({ productId: String(item.productId), quantity: item.quantity });
        }

        // 3. Create the booking document
        const booking = new RentalBooking({
          customerName: customerName.trim(),
          phone: phone.trim(),
          address,
          items,
          fromDate: start,
          toDate: end,
          totalDurationDays,
          advancePaid,
          paymentMethod,
          documents,
          status: 'Active',
          submitTime: submitTime ? new Date(submitTime) : new Date()
        });
        await booking.save();

        return res.status(201).json({
          message: "Rental booking created successfully (fallback atomic check)",
          booking
        });
      } catch (error: any) {
        // Undo changes in case of final insert errors
        for (const rolledBack of modifiedProducts) {
          await Product.findByIdAndUpdate(rolledBack.productId, {
            $inc: { rentalStock: rolledBack.quantity, stock: rolledBack.quantity, stockQuantity: rolledBack.quantity }
          });
        }
        logger.error("createRentalBooking fallback error", error);
        return res.status(500).json({ message: "Failed while creating rental booking", error: error.message });
      }
    }
  } catch (error: any) {
    logger.error("createRentalBooking outer error", error);
    return res.status(500).json({ message: "Internal server error during rental booking creation", error: error.message });
  }
};

/**
 * PATCH /api/admin/rentals/:id/return
 * Fulfill the return of a rental contract, restocking products atomically.
 */
export const returnRentalBooking = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 1. Find the target booking
    const booking = await RentalBooking.findById(id);
    if (!booking) {
      return res.status(404).json({ message: "Rental booking not found" });
    }

    // 2. Safety check: prevent duplicate return restocking
    if (booking.status === "Returned") {
      return res.status(400).json({ message: "Rental booking has already been returned" });
    }

    let session: mongoose.ClientSession | null = null;
    let isReplicaSet = true;
    try {
      session = await mongoose.startSession();
    } catch (e) {
      isReplicaSet = false;
    }

    if (isReplicaSet && session) {
      // ────────────────── TRANSACTION FLOW ──────────────────
      session.startTransaction();
      try {
        // Restock all items inside the transaction
        for (const item of booking.items) {
          const product = await Product.findById(item.productId).session(session);
          if (!product) {
            throw new Error(`Product not found: ${item.productId}`);
          }
          product.rentalStock = (product.rentalStock ?? 0) + item.quantity;
          product.stock = (product.stock ?? 0) + item.quantity;
          product.stockQuantity = (product.stockQuantity ?? 0) + item.quantity;
          await product.save({ session });
        }

        // Complete return status
        booking.status = "Returned";
        await booking.save({ session });

        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({
          message: "Rental booking items returned successfully",
          booking
        });
      } catch (error: any) {
        await session.abortTransaction();
        session.endSession();
        logger.error("returnRentalBooking transaction error", error);
        return res.status(500).json({ message: "Transaction failed while returning rental booking", error: error.message });
      }
    } else {
      // ────────────────── STANDALONE FALLBACK FLOW ──────────────────
      const restoredProducts: { productId: string; quantity: number }[] = [];
      try {
        for (const item of booking.items) {
          const product = await Product.findByIdAndUpdate(
            item.productId,
            { $inc: { rentalStock: item.quantity, stock: item.quantity, stockQuantity: item.quantity } },
            { new: true }
          );
          if (!product) {
            throw new Error(`Product not found during restocking: ${item.productId}`);
          }
          restoredProducts.push({ productId: String(item.productId), quantity: item.quantity });
        }

        booking.status = "Returned";
        await booking.save();

        return res.status(200).json({
          message: "Rental booking items returned successfully (fallback atomic check)",
          booking
        });
      } catch (error: any) {
        // Revert restocked products on failure
        for (const rolledBack of restoredProducts) {
          await Product.findByIdAndUpdate(rolledBack.productId, {
            $inc: { rentalStock: -rolledBack.quantity, stock: -rolledBack.quantity, stockQuantity: -rolledBack.quantity }
          });
        }
        logger.error("returnRentalBooking fallback error", error);
        return res.status(500).json({ message: "Failed while returning rental booking", error: error.message });
      }
    }
  } catch (error: any) {
    logger.error("returnRentalBooking outer error", error);
    return res.status(500).json({ message: "Internal server error during rental return", error: error.message });
  }
};

/**
 * GET /api/admin/rentals
 * Lists rental booking contracts, supports pagination, status filters, and customer searches.
 */
export const listRentalBookings = async (req: Request, res: Response) => {
  try {
    const { status, search, page = "1", limit = "20" } = req.query;

    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { customerName: { $regex: String(search), $options: "i" } },
        { phone: { $regex: String(search), $options: "i" } }
      ];
    }

    const currentPage = Math.max(1, parseInt(String(page)) || 1);
    const limitPage = Math.max(1, parseInt(String(limit)) || 20);
    const skip = (currentPage - 1) * limitPage;

    const [bookings, total] = await Promise.all([
      RentalBooking.find(query)
        .populate("items.productId", "name price code image")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitPage)
        .lean(),
      RentalBooking.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      bookings,
      pagination: {
        total,
        page: currentPage,
        limit: limitPage,
        totalPages: Math.ceil(total / limitPage)
      }
    });
  } catch (error: any) {
    logger.error("listRentalBookings error", error);
    return res.status(500).json({ message: "Error listing rental bookings", error: error.message });
  }
};

/**
 * GET /api/admin/rentals/:id
 * Fetches specific details of a rental booking contract by ID.
 */
export const getRentalBookingById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await RentalBooking.findById(id)
      .populate("items.productId", "name price code image");

    if (!booking) {
      return res.status(404).json({ message: "Rental booking not found" });
    }

    return res.status(200).json({
      success: true,
      booking
    });
  } catch (error: any) {
    logger.error("getRentalBookingById error", error);
    return res.status(500).json({ message: "Error fetching rental booking details", error: error.message });
  }
};
