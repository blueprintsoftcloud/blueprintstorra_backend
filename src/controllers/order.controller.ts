import { Request, Response } from "express";
import crypto from "crypto";
import { User, Order, Cart, Product, PaymentLog, StaffProfile, Role, Feature, OrderStatus, NotificationType } from "../models/mongoose";
import razorpay from "../config/razorpay";
import { calculateShippingWithConfig } from "../services/shipping.service";
import { env } from "../config/env";
import logger from "../utils/logger";
import { transporter, orderStatusEmailTemplate, orderConfirmationEmailTemplate } from "../config/mailer";
import { createAuditLog } from "../utils/auditLog";
import { getWarehouseCoords, getShippingConfigFromDB } from "../utils/warehouseSettings";

// ── Notification Helpers ──────────────────────────────────────────────────────
/** Fan-out: create one Notification per recipient, push via their private socket room. */
const notifyUsers = async (
  req: Request,
  orderId: string,
  message: string,
  type: NotificationType,
  actorId: string,
  recipientIds: string[],
): Promise<void> => {
  const io = req.app.get("socketio");
  for (const recipientId of recipientIds) {
    try {
      const notif = await prisma.notification.create({
        data: { message, orderId, type, triggeredById: actorId, recipientId },
        include: {
          triggeredBy: { select: { id: true, username: true, email: true } },
        },
      });
      if (io) io.to(recipientId).emit("new-notification", notif);
    } catch (err) {
      logger.warn(`notifyUser ${recipientId} error`, err);
    }
  }
};

/** Returns all ADMIN + SUPER_ADMIN user IDs. */
const getAdminRecipients = async (): Promise<string[]> => {
  const users = await prisma.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } },
    select: { id: true },
  });
  return users.map((u: any) => u.id);
};

/** Returns ADMIN + SUPER_ADMIN IDs plus active STAFF with the given permission. */
const getAdminAndStaffRecipients = async (staffPermission: string): Promise<string[]> => {
  const [admins, staff] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } },
      select: { id: true },
    }),
    prisma.staffProfile.findMany({
      where: { permissions: { has: staffPermission }, isActive: true },
      select: { userId: true },
    }),
  ]);
  return [...admins.map((u: any) => u.id), ...staff.map((s: any) => s.userId)];
};

// ── Stock Helper ───────────────────────────────────────────────────────────────
const deductStock = async (
  items: Array<{ productId: string; quantity: number }>,
) => {
  for (const item of items) {
    const result = await prisma.product.updateMany({
      where: { id: item.productId, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });
    if (result.count === 0) {
      throw new Error(`Insufficient stock for product ${item.productId}`);
    }
  }
};

// GET /api/orders/pre-checkout  (authenticated)
export const preCheckout = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    const validItems = cart.items.filter((i: any) => i.product.stock >= i.quantity);
    const outOfStock = cart.items.length - validItems.length;

    if (validItems.length === 0) {
      return res
        .status(400)
        .json({
          message: "All items in your cart are currently out of stock.",
        });
    }

    if (outOfStock > 0) {
      // Remove out-of-stock items from cart
      const staleIds = cart.items
        .filter((i: any) => i.product.stock < i.quantity)
        .map((i: any) => i.id);
      await prisma.cartItem.deleteMany({ where: { id: { in: staleIds } } });
      return res
        .status(200)
        .json({
          message:
            "Some items were out of stock and removed. Proceeding with available items.",
          redirect: true,
        });
    }

    res
      .status(200)
      .json({ message: "Proceed to address selection", redirect: true });
  } catch (err: any) {
    logger.error("preCheckout error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// POST /api/orders/place  (authenticated) — online payment
export const placeOrder = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { couponId, buyNowProductId } = req.body as { couponId?: string; buyNowProductId?: string };

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    const address = await prisma.address.findFirst({
      where: { userId, isDefault: true },
    });

    if (!cart || cart.items.length === 0)
      return res.status(400).json({ message: "Cart is empty" });
    if (!address)
      return res.status(400).json({ message: "Delivery address missing" });

    // When Buy Now is used, only process the specified product
    const eligibleItems = buyNowProductId
      ? cart.items.filter((i: any) => i.product.id === buyNowProductId)
      : cart.items;

    if (eligibleItems.length === 0)
      return res.status(400).json({ message: "Product not found in cart" });

    // Build order items + subtotal
    let subtotal = 0;
    const orderItems = eligibleItems.map((item: any) => {
      subtotal += item.product.price * item.quantity;
      return {
        productId: item.product.id,
        quantity: item.quantity,
        price: item.product.price,
      };
    });

    // Recalculate shipping server-side (security: never trust client)
    // If WAREHOUSE_SETTINGS feature is disabled by Super Admin → free shipping
    const warehouseFlag = await prisma.featureFlag.findUnique({ where: { feature: "WAREHOUSE_SETTINGS" } });
    const warehouseFeatureEnabled = !warehouseFlag || warehouseFlag.isEnabled;
    let shippingCharge: number;
    if (warehouseFeatureEnabled) {
      const [warehouse, shippingConfig] = await Promise.all([getWarehouseCoords(), getShippingConfigFromDB()]);
      shippingCharge = calculateShippingWithConfig(
        address.latitude ?? 0,
        address.longitude ?? 0,
        address.country,
        address.state,
        shippingConfig,
        warehouse.lat,
        warehouse.lng,
      ).shippingCharge;
    } else {
      shippingCharge = 0; // Warehouse Settings disabled → free shipping
    }

    // ── Coupon validation (server-side re-check for security) ─────────────
    let discountAmount = 0;
    let resolvedCouponId: string | undefined;

    if (couponId) {
      const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
      if (coupon && coupon.isActive && (!coupon.expiresAt || coupon.expiresAt > new Date()) && (coupon.maxUses === null || coupon.usedCount < coupon.maxUses) && subtotal >= coupon.minOrderAmount) {
        discountAmount = coupon.discountType === "PERCENTAGE"
          ? Math.round((subtotal * coupon.discountValue) / 100)
          : Math.min(coupon.discountValue, subtotal);
        resolvedCouponId = coupon.id;
      }
    }

    const finalAmount = Math.max(subtotal + shippingCharge - discountAmount, 0);

    // Create Razorpay order
    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(finalAmount * 100), // paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });

    // Save order to DB
    const order = await prisma.order.create({
      data: {
        userId,
        totalAmount: subtotal,
        shippingCharge,
        discountAmount,
        taxAmount: 0,
        finalAmount,
        paymentMethod: "ONLINE",
        paymentStatus: "PENDING",
        orderStatus: "PROCESSING",
        razorpayOrderId: rzpOrder.id,
        couponId: resolvedCouponId,
        shippingAddress: {
          fullAddress: address.fullAddress,
          city: address.city,
          state: address.state,
          zipCode: address.zipCode,
          country: address.country,
        },
        items: { create: orderItems },
      },
    });

    // Increment coupon usage counter
    if (resolvedCouponId) {
      await prisma.coupon.update({ where: { id: resolvedCouponId }, data: { usedCount: { increment: 1 } } });
    }

    await deductStock(orderItems);

    // ── Payment Log: order initiated ─────────────────────────────────────
    await prisma.paymentLog.create({
      data: {
        orderId: order.id,
        userId,
        event: "ORDER_CREATED",
        razorpayOrderId: rzpOrder.id,
        paymentMethod: "ONLINE",
        paymentStatus: "PENDING",
        amount: finalAmount,
        gatewayResponse: { razorpayOrderId: rzpOrder.id, currency: rzpOrder.currency, receipt: rzpOrder.receipt },
        ipAddress: req.ip ?? null,
      },
    }).catch((e: any) => logger.warn("PaymentLog create (ORDER_CREATED) failed", e));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const shortId = order.id.slice(-6);

    const orderRecipients = await getAdminAndStaffRecipients("ORDER_VIEW");
    await notifyUsers(req, order.id, `New Order from ${user!.username}: ₹${finalAmount}`, "NEW_ORDER", userId, orderRecipients);
    await notifyUsers(req, order.id, `Your order #${shortId} has been initiated. Proceed to payment.`, "NEW_ORDER", userId, [userId]);

    res.status(200).json({ order, rzpOrder });
  } catch (err: any) {
    logger.error("placeOrder error", err);
    res
      .status(500)
      .json({ message: "Error initiating order", error: err.message });
  }
};

// POST /api/orders/verify  (authenticated)
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, buyNowProductId } =
      req.body as { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string; buyNowProductId?: string };
    const userId = req.user!.id;

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    const order = await prisma.order.findFirst({
      where: { razorpayOrderId: razorpay_order_id },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const shortId = order.id.slice(-6);

    if (expectedSignature === razorpay_signature) {
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "PAID",
          orderStatus: "CONFIRMED",
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        },
      });

      // ── Payment Log: success ────────────────────────────────────────────
      await prisma.paymentLog.create({
        data: {
          orderId: order.id,
          userId,
          event: "PAYMENT_SUCCESS",
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          paymentMethod: "ONLINE",
          paymentStatus: "PAID",
          amount: order.finalAmount,
          signatureValid: true,
          gatewayResponse: { razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id },
          ipAddress: req.ip ?? null,
        },
      }).catch((e: any) => logger.warn("PaymentLog create (PAYMENT_SUCCESS) failed", e));

      // Clear only the bought item (Buy Now) or the entire cart (regular checkout)
      if (buyNowProductId) {
        await prisma.cartItem.deleteMany({ where: { cart: { userId }, productId: buyNowProductId } });
      } else {
        await prisma.cart.deleteMany({ where: { userId } });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      const adminIds = await getAdminRecipients();
      await notifyUsers(req, order.id, `Payment Confirmed: Order #${shortId} by ${user!.username}`, "PAYMENT_SUCCESS", userId, adminIds);
      await notifyUsers(req, order.id, `Success! Payment confirmed for order #${shortId}`, "PAYMENT_SUCCESS", userId, [userId]);

      // Send order confirmation email to customer
      try {
        const customer = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, username: true },
        });
        if (customer?.email) {
          await transporter.sendMail({
            from: `"blueprint_crm" <${env.EMAIL_USER}>`,
            to: customer.email,
            ...orderConfirmationEmailTemplate(shortId, customer.username, updated.finalAmount.toFixed(2), "ONLINE"),
          });
          logger.info(`Order confirmation email sent to ${customer.email}`);
        }
      } catch (emailErr) {
        logger.error("Order confirmation email failed", emailErr);
      }

      return res.status(200).json({ message: "Success", order: updated });
    } else {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "FAILED" },
      });

      // ── Payment Log: failure ────────────────────────────────────────────
      await prisma.paymentLog.create({
        data: {
          orderId: order.id,
          userId,
          event: "PAYMENT_FAILED",
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          paymentMethod: "ONLINE",
          paymentStatus: "FAILED",
          amount: order.finalAmount,
          signatureValid: false,
          gatewayResponse: { razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, reason: "signature_mismatch" },
          ipAddress: req.ip ?? null,
        },
      }).catch((e: any) => logger.warn("PaymentLog create (PAYMENT_FAILED) failed", e));

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      const adminIds = await getAdminRecipients();
      await notifyUsers(req, order.id, `ALERT: Payment Failed for ${user!.username} (#${shortId})`, "PAYMENT_FAILED", userId, adminIds);
      await notifyUsers(req, order.id, `Payment failed for order #${shortId}. Please contact support.`, "PAYMENT_FAILED", userId, [userId]);
      return res.status(400).json({ message: "Payment verification failed" });
    }
  } catch (err: any) {
    logger.error("verifyPayment error", err);
    res.status(500).json({ message: "Verification Error" });
  }
};

// POST /api/orders/place-pod  (authenticated) — Pay on Delivery
export const placeOrderPOD = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { couponId, buyNowProductId } = req.body as { couponId?: string; buyNowProductId?: string };

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    const address = await prisma.address.findFirst({
      where: { userId, isDefault: true },
    });

    if (!cart || cart.items.length === 0)
      return res.status(400).json({ message: "Cart is empty" });
    if (!address)
      return res.status(400).json({ message: "Delivery address missing" });

    if (address.country !== "India") {
      return res
        .status(400)
        .json({
          message: "Pay on Delivery is not available for international orders.",
        });
    }

    // When Buy Now is used, only process the specified product
    const eligibleItems = buyNowProductId
      ? cart.items.filter((i: any) => i.product.id === buyNowProductId)
      : cart.items;

    if (eligibleItems.length === 0)
      return res.status(400).json({ message: "Product not found in cart" });

    let subtotal = 0;
    const orderItems = eligibleItems.map((item: any) => {
      subtotal += item.product.price * item.quantity;
      return {
        productId: item.product.id,
        quantity: item.quantity,
        price: item.product.price,
      };
    });

    // If WAREHOUSE_SETTINGS feature is disabled by Super Admin → free shipping
    const warehouseFlagPOD = await prisma.featureFlag.findUnique({ where: { feature: "WAREHOUSE_SETTINGS" } });
    const warehouseFeatureEnabledPOD = !warehouseFlagPOD || warehouseFlagPOD.isEnabled;
    let shippingCharge: number;
    if (warehouseFeatureEnabledPOD) {
      const [warehouse, shippingConfig] = await Promise.all([getWarehouseCoords(), getShippingConfigFromDB()]);
      shippingCharge = calculateShippingWithConfig(
        address.latitude ?? 0,
        address.longitude ?? 0,
        address.country,
        address.state,
        shippingConfig,
        warehouse.lat,
        warehouse.lng,
      ).shippingCharge;
    } else {
      shippingCharge = 0; // Warehouse Settings disabled → free shipping
    }

    // ── Coupon validation (server-side re-check for security) ─────────────
    let discountAmount = 0;
    let resolvedCouponId: string | undefined;

    if (couponId) {
      const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
      if (coupon && coupon.isActive && (!coupon.expiresAt || coupon.expiresAt > new Date()) && (coupon.maxUses === null || coupon.usedCount < coupon.maxUses) && subtotal >= coupon.minOrderAmount) {
        discountAmount = coupon.discountType === "PERCENTAGE"
          ? Math.round((subtotal * coupon.discountValue) / 100)
          : Math.min(coupon.discountValue, subtotal);
        resolvedCouponId = coupon.id;
      }
    }

    const finalAmount = Math.max(subtotal + shippingCharge - discountAmount, 0);

    const order = await prisma.order.create({
      data: {
        userId,
        totalAmount: subtotal,
        shippingCharge,
        discountAmount,
        taxAmount: 0,
        finalAmount,
        paymentMethod: "POD",
        paymentStatus: "PENDING",
        orderStatus: "CONFIRMED",
        couponId: resolvedCouponId,
        shippingAddress: {
          fullAddress: address.fullAddress,
          city: address.city,
          state: address.state,
          zipCode: address.zipCode,
          country: address.country,
        },
        items: { create: orderItems },
      },
    });

    // Increment coupon usage counter
    if (resolvedCouponId) {
      await prisma.coupon.update({ where: { id: resolvedCouponId }, data: { usedCount: { increment: 1 } } });
    }

    await deductStock(orderItems);
    // Clear only the bought item (Buy Now) or the entire cart (regular checkout)
    if (buyNowProductId) {
      await prisma.cartItem.deleteMany({ where: { cart: { userId }, productId: buyNowProductId } });
    } else {
      await prisma.cart.deleteMany({ where: { userId } });
    }

    // ── Payment Log: POD order placed ────────────────────────────────────
    await prisma.paymentLog.create({
      data: {
        orderId: order.id,
        userId,
        event: "ORDER_POD",
        paymentMethod: "POD",
        paymentStatus: "PENDING",
        amount: finalAmount,
        signatureValid: null,
        gatewayResponse: { note: "Pay on Delivery — no gateway transaction" },
        ipAddress: req.ip ?? null,
      },
    }).catch((e: any) => logger.warn("PaymentLog create (ORDER_POD) failed", e));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const shortId = order.id.slice(-6);
    const orderRecipients = await getAdminAndStaffRecipients("ORDER_VIEW");
    await notifyUsers(req, order.id, `New POD Order from ${user!.username}: ₹${finalAmount}`, "NEW_ORDER", userId, orderRecipients);
    await notifyUsers(req, order.id, `Your POD order #${shortId} has been confirmed! Pay on delivery.`, "NEW_ORDER", userId, [userId]);

    // Send order confirmation email to customer
    try {
      const customer = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, username: true },
      });
      if (customer?.email) {
        await transporter.sendMail({
          from: `"blueprint_crm" <${env.EMAIL_USER}>`,
          to: customer.email,
          ...orderConfirmationEmailTemplate(shortId, customer.username, finalAmount.toFixed(2), "POD"),
        });
        logger.info(`POD order confirmation email sent to ${customer.email}`);
      }
    } catch (emailErr) {
      logger.error("POD order confirmation email failed", emailErr);
    }

    res.status(200).json({ message: "Order placed successfully via POD", order });
  } catch (err: any) {
    logger.error("placeOrderPOD error", err);
    res
      .status(500)
      .json({ message: "Error placing POD order", error: err.message });
  }
};

// POST /api/orders/cancel/:id  (authenticated)
export const cancelOrder = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    // Ownership: customers can only cancel their own orders
    if (order.userId !== userId) {
      return res.status(403).json({ message: "Forbidden." });
    }

    // Only allow cancellation of orders still in PROCESSING state.
    // PROCESSING = online payment not yet completed.
    // CONFIRMED / SHIPPED = order is active — contact admin to cancel.
    if (order.orderStatus !== "PROCESSING") {
      return res.status(400).json({
        message:
          order.orderStatus === "CANCELLED"
            ? "This order is already cancelled."
            : "Only orders awaiting payment can be self-cancelled. Please contact support to cancel a confirmed or shipped order.",
      });
    }

    // Restore stock
    for (const item of order.items) {
      await prisma.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }

    await prisma.order.update({
      where: { id },
      data: { orderStatus: "CANCELLED" },
    });

    res.status(200).json({ message: "Order cancelled and stock restored" });
  } catch (err: any) {
    logger.error("cancelOrder error", err);
    res.status(500).json({ message: "Cancel error" });
  }
};

// GET /api/orders/my-orders?page=1&limit=10  (authenticated)
export const getOrders = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { page = "1", limit = "10" } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "10") || 10, 1), 50);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, image: true, price: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.order.count({ where: { userId } }),
    ]);

    res.status(200).json({
      message: "Orders Fetched successfully",
      order: orders,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getOrders error", err);
    res.status(500).json({ message: "Error in fetching orders" });
  }
};

// GET /api/orders/admin?page=1&limit=20&status=  (admin)
export const getOrdersForAdmin = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20", status } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "20") || 20, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;
    const where = status ? { orderStatus: status.toUpperCase() as OrderStatus } : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, email: true } },
          items: {
            include: {
              product: {
                select: { id: true, name: true, price: true, image: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);

    res.status(200).json({
      message: "Orders fetched for Admin",
      order: orders,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getOrdersForAdmin error", err);
    res.status(500).json({ message: "Error in fetching Orders for admin" });
  }
};

// PUT /api/orders/update-status/:id  (admin)
export const updateStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { orderStatus } = req.body as { orderStatus: OrderStatus };
    const adminId = req.user!.id;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Restore stock when cancelling
    if (orderStatus === "CANCELLED" && order.orderStatus !== "CANCELLED") {
      for (const item of order.items) {
        await prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { orderStatus },
    });

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { username: true },
    });
    const shortId = id.slice(-6);

    const adminIds = await getAdminRecipients();
    await notifyUsers(req, id, `Admin ${admin!.username} updated Order #${shortId} to ${orderStatus}`, "ORDER_UPDATE", adminId, adminIds);
    await notifyUsers(req, id, `Your order #${shortId} status has been updated to: ${orderStatus}`, "ORDER_UPDATE", adminId, [order.userId]);

    // Send order-status email to customer
    try {
      const customer = await prisma.user.findUnique({
        where: { id: order.userId },
        select: { email: true, username: true },
      });
      if (customer?.email) {
        await transporter.sendMail({
          from: `"blueprint_crm" <${env.EMAIL_USER}>`,
          to: customer.email,
          ...orderStatusEmailTemplate(shortId, orderStatus, customer.username),
        });
        logger.info(`Order status email sent to ${customer.email} for order ${shortId}`);
      }
    } catch (emailErr) {
      logger.error("Order status email failed", emailErr);
    }

    await createAuditLog({
      req,
      action: "UPDATE_ORDER_STATUS",
      entity: "Order",
      entityId: id,
      details: { from: order.orderStatus, to: orderStatus, shortId },
    });

    res
      .status(200)
      .json({
        message: `Order status updated to ${orderStatus} Successfully`,
        order: updated,
      });
  } catch (err: any) {
    logger.error("updateStatus error", err);
    res.status(500).json({ message: "Error in Updating order status" });
  }
};

// GET /api/orders/my-transactions?page=1&limit=10  (authenticated customer)
export const getMyTransactions = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { page = "1", limit = "10" } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "10") || 10, 1), 50);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    const [transactions, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        select: {
          id: true,
          createdAt: true,
          paymentMethod: true,
          paymentStatus: true,
          orderStatus: true,
          totalAmount: true,
          shippingCharge: true,
          discountAmount: true,
          finalAmount: true,
          razorpayPaymentId: true,
          razorpayOrderId: true,
          coupon: { select: { code: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, image: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.order.count({ where: { userId } }),
    ]);

    res.status(200).json({
      transactions,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getMyTransactions error", err);
    res.status(500).json({ message: "Error fetching transaction history" });
  }
};

// GET /api/orders/customer-transactions?page=1&limit=20&search=&paymentStatus=&paymentMethod=  (admin/staff)
export const getCustomerTransactions = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      search,
      paymentStatus,
      paymentMethod,
    } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "20") || 20, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    const where: any = {};
    if (paymentStatus) where.paymentStatus = paymentStatus.toUpperCase();
    if (paymentMethod) where.paymentMethod = paymentMethod.toUpperCase();
    if (search) {
      where.user = {
        OR: [
          { username: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const [transactions, total] = await Promise.all([
      prisma.order.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          paymentMethod: true,
          paymentStatus: true,
          orderStatus: true,
          totalAmount: true,
          shippingCharge: true,
          discountAmount: true,
          finalAmount: true,
          razorpayPaymentId: true,
          razorpayOrderId: true,
          coupon: { select: { code: true } },
          user: { select: { id: true, username: true, email: true, phone: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, image: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);

    res.status(200).json({
      transactions,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getCustomerTransactions error", err);
    res.status(500).json({ message: "Error fetching customer transactions" });
  }
};

// GET /api/orders/:id  — customer (own order) or admin/staff (any order)
export const getOrderById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const requestingUser = req.user!;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, image: true, price: true, code: true } },
          },
        },
        coupon: { select: { code: true, discountType: true, discountValue: true } },
      },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Customers may only fetch their own orders
    if (
      requestingUser.role !== Role.ADMIN &&
      requestingUser.role !== Role.SUPER_ADMIN &&
      requestingUser.role !== Role.STAFF &&
      order.userId !== requestingUser.id
    ) {
      return res.status(403).json({ message: "Not authorised" });
    }

    res.status(200).json({ order });
  } catch (err: any) {
    logger.error("getOrderById error", err);
    res.status(500).json({ message: "Error fetching order" });
  }
};

// ─── Admin Place Order on Behalf of Customer ──────────────────────────────────

// GET /api/orders/admin-order/search-customers?q=   (admin / super-admin)
// Search existing customers by name, phone, or email.
export const searchCustomersForOrder = async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    if (!q) return res.json({ customers: [] });

    const customers = await prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { email:    { contains: q, mode: "insensitive" } },
          { phone:    { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, username: true, email: true, phone: true },
      take: 10,
    });
    res.json({ customers });
  } catch (err: any) {
    logger.error("searchCustomersForOrder error", err);
    res.status(500).json({ message: "Search failed" });
  }
};

// GET /api/orders/admin-order/products?search=&page=1  (admin / super-admin)
// Returns active products with stock info for product picker.
export const getProductsForAdminOrder = async (req: Request, res: Response) => {
  try {
    const { search = "", page = "1", limit = "20" } = req.query as Record<string, string | undefined>;
    const pageSize = Math.min(Math.max(parseInt(limit ?? "20") || 20, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;
    const where = {
      isActive: true,
      stock: { gt: 0 },
      ...(search ? { name: { contains: search as string, mode: "insensitive" as const } } : {}),
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true, name: true, code: true, image: true, price: true, stock: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
        skip,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);
    res.json({ products, pagination: { total, page: Math.max(parseInt(page ?? "1") || 1, 1), limit: pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err: any) {
    logger.error("getProductsForAdminOrder error", err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
};

// POST /api/orders/admin-order/place   (admin / super-admin)
// Body: {
//   customerId?:   string,          // existing CUSTOMER id
//   newCustomer?:  { username, phone, email? }, // create new if no customerId
//   items:         [{ productId, quantity }],
//   address:       { fullAddress, city, state, zipCode, country },
//   paymentMethod: "CASH" | "POD",
//   paymentNote?:  string,           // e.g. UPI ref, receipt no, etc.
// }
export const placeAdminOrder = async (req: Request, res: Response) => {
  try {
    const adminId = req.user!.id;
    const {
      customerId,
      newCustomer,
      items,
      address,
      paymentMethod = "CASH",
      paymentNote,
    } = req.body as {
      customerId?: string;
      newCustomer?: { username: string; phone: string; email?: string };
      items: Array<{ productId: string; quantity: number }>;
      address: { fullAddress: string; city: string; state: string; zipCode: string; country: string };
      paymentMethod: "CASH" | "POD";
      paymentNote?: string;
    };

    // ── 1. Resolve customer ──────────────────────────────────────────────────
    let customer: { id: string; username: string; email: string | null };

    if (customerId) {
      const existing = await prisma.user.findUnique({
        where: { id: customerId },
        select: { id: true, username: true, email: true, role: true },
      });
      if (!existing || existing.role !== "CUSTOMER") {
        return res.status(404).json({ message: "Customer not found" });
      }
      customer = existing;
    } else if (newCustomer) {
      if (!newCustomer.username?.trim() || !newCustomer.phone?.trim()) {
        return res.status(400).json({ message: "Name and phone are required for a new customer" });
      }
      // Check if phone already exists
      const phoneExists = await prisma.user.findUnique({ where: { phone: newCustomer.phone } });
      if (phoneExists) {
        return res.status(400).json({ message: "A customer with this phone number already exists. Use existing customer search." });
      }
      const created = await prisma.user.create({
        data: {
          username: newCustomer.username.trim(),
          phone: newCustomer.phone.trim(),
          email: newCustomer.email?.trim() || null,
          role: "CUSTOMER",
          isVerified: true,
        },
        select: { id: true, username: true, email: true },
      });
      customer = created;
    } else {
      return res.status(400).json({ message: "Provide either customerId or newCustomer details" });
    }

    // ── 2. Validate + price items ────────────────────────────────────────────
    if (!items?.length) return res.status(400).json({ message: "At least one item is required" });

    const productIds = items.map((i: any) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, name: true, price: true, stock: true },
    });

    const productMap = Object.fromEntries(products.map((p: any) => [p.id, p]));

    let subtotal = 0;
    const orderItems: Array<{ productId: string; quantity: number; price: number }> = [];

    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) return res.status(400).json({ message: `Product ${item.productId} not found or inactive` });
      if (product.stock < item.quantity) return res.status(400).json({ message: `Insufficient stock for "${product.name}" (available: ${product.stock})` });
      subtotal += product.price * item.quantity;
      orderItems.push({ productId: item.productId, quantity: item.quantity, price: product.price });
    }

    const finalAmount = subtotal; // No shipping for admin orders (cash counter sales)

    // ── 3. Create order ──────────────────────────────────────────────────────
    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        placedByAdminId: adminId,
        totalAmount: subtotal,
        shippingCharge: 0,
        discountAmount: 0,
        taxAmount: 0,
        finalAmount,
        paymentMethod: paymentMethod as "CASH" | "POD",
        paymentStatus: paymentMethod === "CASH" ? "PAID" : "PENDING",
        orderStatus: "CONFIRMED",
        shippingAddress: {
          fullAddress: address.fullAddress,
          city: address.city,
          state: address.state,
          zipCode: address.zipCode,
          country: address.country || "India",
        },
        items: { create: orderItems },
      },
    });

    // ── 4. Deduct stock ──────────────────────────────────────────────────────
    await deductStock(orderItems);

    // ── 5. Payment log ───────────────────────────────────────────────────────
    await prisma.paymentLog.create({
      data: {
        orderId: order.id,
        userId: customer.id,
        event: "ADMIN_ORDER_PLACED",
        paymentMethod: paymentMethod as "CASH" | "POD",
        paymentStatus: paymentMethod === "CASH" ? "PAID" : "PENDING",
        amount: finalAmount,
        gatewayResponse: {
          placedByAdmin: adminId,
          note: paymentNote ?? (paymentMethod === "CASH" ? "Cash collected at counter" : "Pay on delivery"),
        },
        ipAddress: req.ip ?? null,
      },
    }).catch((e: any) => logger.warn("PaymentLog (ADMIN_ORDER_PLACED) failed", e));

    // ── 6. Notifications ─────────────────────────────────────────────────────
    const shortId = order.id.slice(-6);
    const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { username: true } });
    const adminRecipients = await getAdminRecipients();
    await notifyUsers(req, order.id, `Admin Order #${shortId} placed by ${admin!.username} for ${customer.username}`, "NEW_ORDER", adminId, adminRecipients);

    // ── 7. Confirmation email ────────────────────────────────────────────────
    if (customer.email) {
      try {
        await transporter.sendMail({
          from: `"blueprint_crm" <${env.EMAIL_USER}>`,
          to: customer.email,
          ...orderConfirmationEmailTemplate(shortId, customer.username, finalAmount.toFixed(2), paymentMethod === "CASH" ? "ONLINE" : "POD"),
        });
        logger.info(`Admin-order confirmation email sent to ${customer.email}`);
      } catch (emailErr) {
        logger.warn("Admin-order confirmation email failed", emailErr);
      }
    }

    // ── 8. Audit log ─────────────────────────────────────────────────────────
    await createAuditLog({
      req,
      action: "ADMIN_PLACE_ORDER",
      entity: "Order",
      entityId: order.id,
      details: { customerId: customer.id, customerName: customer.username, paymentMethod, paymentNote, finalAmount },
    });

    res.status(201).json({
      message: "Order placed successfully",
      order: { id: order.id, shortId, finalAmount, paymentMethod, orderStatus: order.orderStatus },
      customer: { id: customer.id, username: customer.username, email: customer.email },
    });
  } catch (err: any) {
    logger.error("placeAdminOrder error", err);
    res.status(500).json({ message: "Failed to place order", error: err.message });
  }
};
