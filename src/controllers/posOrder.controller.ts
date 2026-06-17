import { Request, Response } from "express";
import { POSOrder, Product } from "../models";
import logger from "../utils/logger";

const resolveNextTicketId = async (): Promise<string> => {
  const lastKotOrder = await POSOrder.findOne({
    ticketId: { $exists: true, $nin: [null, ""] }
  }).sort({ createdAt: -1 });

  let nextKotNum = 1000;
  if (lastKotOrder && lastKotOrder.ticketId) {
    const parsed = parseInt(lastKotOrder.ticketId);
    if (!isNaN(parsed) && parsed >= 1000) {
      nextKotNum = parsed + 1;
    }
  }
  return String(nextKotNum);
};

const resolveNextInvoiceNo = async (): Promise<string> => {
  const lastInvoiceOrder = await POSOrder.findOne({
    invoiceNo: { $exists: true, $nin: [null, ""] }
  }).sort({ createdAt: -1 });

  let nextPrefix = "AA";
  let nextNum = 10000; // starts at 10000 (5 digit number)

  if (lastInvoiceOrder && lastInvoiceOrder.invoiceNo) {
    const match = lastInvoiceOrder.invoiceNo.match(/^([A-Za-z]+)\s*(\d+)$/);
    if (match) {
      nextPrefix = match[1].toUpperCase();
      nextNum = parseInt(match[2]) + 1;
      // Rollover prefix if 5-digit limit is reached
      if (nextNum > 99999) {
        nextNum = 10000;
        const chars = nextPrefix.split("");
        let carry = true;
        for (let i = chars.length - 1; i >= 0; i--) {
          if (carry) {
            const code = chars[i].charCodeAt(0) + 1;
            if (code > 90) { // 'Z'
              chars[i] = 'A';
              carry = true;
            } else {
              chars[i] = String.fromCharCode(code);
              carry = false;
            }
          }
        }
        nextPrefix = carry ? 'A' + chars.join('') : chars.join('');
      }
    }
  }
  return `${nextPrefix} ${nextNum}`;
};

// POST /api/orders/create
export const createPOSOrder = async (req: Request, res: Response) => {
  try {
    const {
      mode,
      invoiceNo,
      ticketId,
      tableNumber,
      customerName,
      paymentMethod = "CASH",
      items,
      gstPercent = 0,
      serviceCharge = 0
    } = req.body;

    if (!mode || !["BILLING", "KOT"].includes(mode)) {
      return res.status(400).json({ message: "Invalid transaction mode. Must be BILLING or KOT." });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Transaction items are required and must be a non-empty array." });
    }

    // 1. Fetch products and perform calculations / stock checks
    const itemsDetail = [];
    let subtotal = 0;

    for (const item of items) {
      const { productId, quantity } = item;
      if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({ message: "Each item must have a valid productId and positive quantity." });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found with ID: ${productId}` });
      }

      // Check stock if mode is BILLING
      if (mode === "BILLING") {
        const availableStock = product.stock;
        if (availableStock < quantity) {
          return res.status(400).json({
            message: `Insufficient stock for product "${product.name}". Available: ${availableStock}, Ordered: ${quantity}`
          });
        }
      }

      subtotal += product.price * quantity;
      itemsDetail.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: quantity
      });
    }

    const gstAmount = mode === "BILLING" ? Math.round((subtotal * gstPercent) / 100) : 0;
    const finalServiceCharge = mode === "BILLING" ? Number(serviceCharge || 0) : 0;
    const totalAmount = mode === "BILLING" ? (subtotal + gstAmount + finalServiceCharge) : 0;

    // 2. Generate identifiers sequentially if not provided or if "..." placeholders are received
    let finalInvoiceNo = (invoiceNo && invoiceNo.trim() !== "...") ? invoiceNo : undefined;
    let finalTicketId = (ticketId && ticketId.trim() !== "...") ? ticketId : undefined;

    if (mode === "KOT" && !finalTicketId) {
      finalTicketId = await resolveNextTicketId();
    }

    if (!finalInvoiceNo) {
      finalInvoiceNo = await resolveNextInvoiceNo();
    }

    // 3. Create POSOrder in database
    const posOrder = await POSOrder.create({
      invoiceNo: finalInvoiceNo,
      ticketId: finalTicketId,
      mode,
      status: mode === "BILLING" ? "COMPLETED" : "PENDING_KITCHEN",
      tableNumber,
      customerName,
      paymentMethod,
      items: itemsDetail,
      subtotal: mode === "BILLING" ? subtotal : 0,
      gstPercent: mode === "BILLING" ? gstPercent : 0,
      gstAmount,
      serviceCharge: finalServiceCharge,
      totalAmount
    });

    // 4. If Billing mode, deduct stock immediately
    if (mode === "BILLING") {
      for (const item of itemsDetail) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { stock: -item.quantity, stockQuantity: -item.quantity }
        });
      }
    }

    res.status(201).json({
      message: mode === "BILLING" ? "POS Invoice generated successfully" : "Kitchen order ticket created",
      order: posOrder
    });
  } catch (err: any) {
    logger.error("createPOSOrder error", err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/orders/kot/:ticketId
export const getKOTByTicketId = async (req: Request, res: Response) => {
  try {
    const ticketId = req.params.ticketId as string;

    if (!ticketId) {
      return res.status(400).json({ message: "ticketId is required" });
    }

    const order = await POSOrder.findOne({
      ticketId: ticketId.trim(),
      mode: "KOT",
      status: "PENDING_KITCHEN"
    });

    if (!order) {
      return res.status(404).json({ message: `No active Kitchen Order Ticket found with ID: ${ticketId}` });
    }

    res.status(200).json({ order });
  } catch (err: any) {
    logger.error("getKOTByTicketId error", err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/orders/billing-complete/:ticketId
export const completeKOTBilling = async (req: Request, res: Response) => {
  try {
    const ticketId = req.params.ticketId as string;
    const { gstPercent = 0, serviceCharge = 0, customerName, paymentMethod = "CASH" } = req.body;

    if (!ticketId) {
      return res.status(400).json({ message: "ticketId is required" });
    }

    const order = await POSOrder.findOne({
      ticketId: ticketId.trim(),
      mode: "KOT",
      status: "PENDING_KITCHEN"
    });

    if (!order) {
      return res.status(404).json({ message: `No active KOT order found to complete with ticket ID: ${ticketId}` });
    }

    // Check stock for all items before completing checkout
    for (const item of order.items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found with ID: ${item.productId}` });
      }
      const availableStock = product.stock;
      if (availableStock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for product "${product.name}". Available: ${availableStock}, Ordered: ${item.quantity}`
        });
      }
    }

    // Recalculate based on captured snapshot items
    const subtotal = order.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const gstAmount = Math.round((subtotal * gstPercent) / 100);
    const finalServiceCharge = Number(serviceCharge || 0);
    const totalAmount = subtotal + gstAmount + finalServiceCharge;

    // Update POSOrder state
    order.status = "COMPLETED";
    order.mode = "BILLING";
    order.gstPercent = gstPercent;
    order.gstAmount = gstAmount;
    order.serviceCharge = finalServiceCharge;
    order.subtotal = subtotal;
    order.totalAmount = totalAmount;
    order.paymentMethod = paymentMethod;
    if (customerName) {
      order.customerName = customerName;
    }

    await order.save();

    // Deduct inventory levels
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.quantity, stockQuantity: -item.quantity }
      });
    }

    res.status(200).json({
      message: "KOT ticket converted to completed invoice successfully",
      order
    });
  } catch (err: any) {
    logger.error("completeKOTBilling error", err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/orders/billing-history
export const getPOSBillingHistory = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
    const skip = (page - 1) * limit;

    const { search, invoiceNo, startDate, endDate } = req.query;

    const query: any = { mode: "BILLING" };

    if (invoiceNo) {
      query.invoiceNo = { $regex: String(invoiceNo), $options: "i" };
    }

    if (search) {
      query.$or = [
        { invoiceNo: { $regex: String(search), $options: "i" } },
        { customerName: { $regex: String(search), $options: "i" } },
        { ticketId: { $regex: String(search), $options: "i" } }
      ];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(String(startDate));
      }
      if (endDate) {
        query.createdAt.$lte = new Date(String(endDate));
      }
    }

    const totalItems = await POSOrder.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limit);

    const orders = await POSOrder.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(200).json({
      success: true,
      orders,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (err: any) {
    logger.error("getPOSBillingHistory error", err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/orders/next-sequence
export const getNextSequence = async (req: Request, res: Response) => {
  try {
    const nextTicketId = await resolveNextTicketId();
    const nextInvoiceNo = await resolveNextInvoiceNo();

    res.status(200).json({
      success: true,
      nextTicketId,
      nextInvoiceNo
    });
  } catch (err: any) {
    logger.error("getNextSequence error", err);
    res.status(500).json({ error: err.message });
  }
};


