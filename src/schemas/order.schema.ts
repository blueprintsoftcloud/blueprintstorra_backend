// src/schemas/order.schema.ts
import { z } from "zod";

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z
    .string({ required_error: "Razorpay order ID is required" })
    .min(1),
  razorpay_payment_id: z
    .string({ required_error: "Razorpay payment ID is required" })
    .min(1),
  razorpay_signature: z
    .string({ required_error: "Razorpay signature is required" })
    .min(1),
  buyNowProductId: z.string().optional(),
});

export const updateOrderStatusSchema = z.object({
  orderStatus: z.enum(
    ["PROCESSING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"],
    { required_error: "Order status is required" },
  ),
});
