import nodemailer from "nodemailer";
import crypto from "crypto";
import { env } from "./env";

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;

export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: env.EMAIL_USER,
    pass: env.EMAIL_PASS,
  },
});

export const generateOtpCode = (): string => {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return crypto.randomInt(min, max).toString();
};

export const otpEmailTemplate = (otp: string) => ({
  subject: "Your One-Time Password (OTP) for Verification",
  html: `
    <div style="font-family:sans-serif;padding:20px;border:1px solid #ddd;border-radius:8px;max-width:500px;margin:auto;">
      <h2 style="color:#333;">Email Verification Required</h2>
      <p>Use the following OTP to complete your process. Valid for <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.</p>
      <div style="text-align:center;margin:30px 0;">
        <span style="font-size:32px;font-weight:bold;color:#4F46E5;background:#EEF2FF;padding:15px 25px;border-radius:6px;letter-spacing:5px;">
          ${otp}
        </span>
      </div>
      <p style="font-size:12px;color:#777;">If you did not request this, please ignore this email.</p>
    </div>`,
});

export const orderConfirmationEmailTemplate = (
  orderShortId: string,
  customerName: string,
  totalAmount: string,
  paymentMethod: "ONLINE" | "POD",
): { subject: string; html: string } => ({
  subject: `Order Confirmed! Your order #${orderShortId} is placed`,
  html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;">
  <div style="background:#10b981;border-radius:10px 10px 0 0;padding:28px 24px;text-align:center;">
    <h2 style="color:#fff;margin:0;font-size:22px;">Order Confirmed!</h2>
    <p style="color:rgba(255,255,255,0.9);margin:6px 0 0;font-size:16px;font-weight:600;">#${orderShortId}</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px 24px;">
    <p style="font-size:16px;color:#111827;margin-top:0;">Hi <strong>${customerName}</strong>,</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;">
      Thank you for your order! ${paymentMethod === "POD" ? "You will pay on delivery." : "Your payment has been received."}
    </p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      <tr style="background:#f3f4f6;">
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Order Total</td>
        <td style="padding:10px 14px;font-size:16px;font-weight:700;color:#10b981;text-align:right;">₹${totalAmount}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Payment</td>
        <td style="padding:10px 14px;font-size:14px;color:#374151;text-align:right;">${paymentMethod === "POD" ? "Pay on Delivery" : "Online Payment"}</td>
      </tr>
    </table>
    <p style="font-size:13px;color:#9ca3af;margin-bottom:0;">
      We will notify you as your order progresses. Thank you for shopping with blueprint_crm!
    </p>
  </div>
</div>`,
});

export const orderStatusEmailTemplate = (
  orderShortId: string,
  status: string,
  customerName: string,
): { subject: string; html: string } => {
  const statusConfig: Record<string, { label: string; color: string; message: string }> = {
    PROCESSING: { label: "Processing", color: "#6366f1", message: "Your order is being processed. We'll update you soon." },
    CONFIRMED:  { label: "Confirmed",  color: "#10b981", message: "Great news! Your order has been confirmed and will be prepared shortly." },
    SHIPPED:    { label: "Shipped",    color: "#3b82f6", message: "Your order is on its way! Expect delivery soon." },
    DELIVERED:  { label: "Delivered",  color: "#22c55e", message: "Your order has been delivered. We hope you love it!" },
    CANCELLED:  { label: "Cancelled",  color: "#ef4444", message: "Your order has been cancelled. If you have any questions, please contact support." },
  };

  const cfg = statusConfig[status] ?? {
    label: status,
    color: "#6b7280",
    message: "Your order status has been updated.",
  };

  return {
    subject: `Your Order #${orderShortId} is now ${cfg.label}`,
    html: `
<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;">
  <div style="background:${cfg.color};border-radius:10px 10px 0 0;padding:28px 24px;text-align:center;">
    <h2 style="color:#fff;margin:0;font-size:22px;letter-spacing:0.3px;">Order #${orderShortId}</h2>
    <p style="color:rgba(255,255,255,0.9);margin:6px 0 0;font-size:16px;font-weight:600;">${cfg.label}</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px 24px;">
    <p style="font-size:16px;color:#111827;margin-top:0;">Hi <strong>${customerName}</strong>,</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;">${cfg.message}</p>
    <div style="margin:24px 0;padding:16px;background:#f3f4f6;border-radius:8px;text-align:center;">
      <span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Order Status</span><br/>
      <strong style="font-size:20px;color:${cfg.color};">${cfg.label}</strong>
    </div>
    <p style="font-size:13px;color:#9ca3af;margin-bottom:0;">
      Thank you for shopping with us. If you have any questions, please reply to this email.
    </p>
  </div>
</div>`,
  };
};
