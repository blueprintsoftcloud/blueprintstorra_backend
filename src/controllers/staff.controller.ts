import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { User, StaffProfile, Product, Order } from "../models/mongoose";
import { STAFF_PERMISSIONS, StaffPermission } from "../config/staffPermissions";
import logger from "../utils/logger";

// ── GET /api/staff/profile  (staff's own profile + permissions) ────────────
export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        avatar: true,
        staffProfile: { select: { permissions: true, isActive: true } },
      },
    });
    if (!user) {
      res.status(404).json({ message: "Staff not found" });
      return;
    }
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      permissions: user.staffProfile?.permissions ?? [],
      isActive: user.staffProfile?.isActive ?? false,
    });
  } catch (err: any) {
    logger.error("getMyProfile error", err);
    res.status(500).json({ message: "Error fetching staff profile" });
  }
};

// ── PATCH /api/staff/me  (staff: update own username) ───────────────────────
export const updateMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { username } = req.body as { username?: string };

    if (!username || username.trim().length < 3) {
      res.status(400).json({ message: "Username must be at least 3 characters" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { username: username.trim() },
      select: { id: true, username: true, email: true, role: true },
    });

    res.json({ message: "Profile updated successfully", user: updated });
  } catch (err: any) {
    logger.error("updateMyProfile error", err);
    res.status(500).json({ message: "Error updating profile" });
  }
};

// ── GET /api/staff/dashboard  (staff: own dashboard summary) ─────────────
export const getStaffDashboard = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(now.getDate() - 60);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100;
      return Math.round(((curr - prev) / prev) * 100);
    };

    const [
      totalOrders, ordersThisMonth, ordersPrevMonth,
      totalProducts,
      totalCategories,
      processingOrders,
      paidAgg, paidThisMonth, paidPrevMonth,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.order.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
      prisma.product.count(),
      prisma.category.count(),
      prisma.order.count({ where: { orderStatus: "PROCESSING" } }),
      prisma.order.aggregate({ where: { paymentStatus: "PAID" }, _sum: { finalAmount: true } }),
      prisma.order.aggregate({ where: { paymentStatus: "PAID", createdAt: { gte: thirtyDaysAgo } }, _sum: { finalAmount: true } }),
      prisma.order.aggregate({ where: { paymentStatus: "PAID", createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }, _sum: { finalAmount: true } }),
    ]);

    // Order status breakdown (pie chart)
    const statuses = ["PROCESSING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
    const statusCounts = await Promise.all(
      statuses.map((s) => prisma.order.count({ where: { orderStatus: s } })),
    );
    const orderStatus = statuses.map((s, i) => ({ status: s, count: statusCounts[i] }));

    // Revenue by day — last 7 days (bar chart)
    const recentOrders = await prisma.order.findMany({
      where: { paymentStatus: "PAID", createdAt: { gte: sevenDaysAgo } },
      select: { finalAmount: true, createdAt: true },
    });
    const byDay: Record<string, { date: string; revenue: number; orders: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      byDay[key] = { date: key, revenue: 0, orders: 0 };
    }
    for (const o of recentOrders) {
      const key = o.createdAt.toISOString().split("T")[0];
      if (byDay[key]) { byDay[key].revenue += o.finalAmount; byDay[key].orders += 1; }
    }

    // Top 5 products by sales
    const topProductsRaw = await prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true, price: true },
      _count: { id: true },
      orderBy: { _sum: { price: "desc" } },
      take: 5,
    });
    const productIds = topProductsRaw.map((p: any) => p.productId).filter(Boolean) as string[];
    const productDetails = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, image: true, price: true },
    });
    const productMap = Object.fromEntries(productDetails.map((p: any) => [p.id, p]));
    const topProducts = topProductsRaw.map((p: any) => ({
      product: p.productId ? productMap[p.productId] ?? null : null,
      totalRevenue: p._sum.price ?? 0,
      totalQuantitySold: p._sum.quantity ?? 0,
      orderCount: p._count.id,
    }));

    res.json({
      summary: {
        orders: { total: totalOrders, thisMonth: ordersThisMonth, processing: processingOrders, growthPct: pct(ordersThisMonth, ordersPrevMonth) },
        revenue: { total: paidAgg._sum.finalAmount ?? 0, thisMonth: paidThisMonth._sum.finalAmount ?? 0, growthPct: pct(paidThisMonth._sum.finalAmount ?? 0, paidPrevMonth._sum.finalAmount ?? 0) },
        products: { total: totalProducts },
        categories: { total: totalCategories },
      },
      orderStatus,
      revenueChart: Object.values(byDay),
      topProducts,
    });
  } catch (err: any) {
    logger.error("getStaffDashboard error", err);
    res.status(500).json({ message: "Error loading staff dashboard" });
  }
};

// ── GET /api/staff  (admin: list staff they manage) ───────────────────────
export const listStaff = async (req: Request, res: Response) => {
  try {
    const managedBy = req.user!.id;
    const staff = await prisma.staffProfile.findMany({
      where: { managedBy },
      include: {
        user: {
          select: { id: true, username: true, email: true, phone: true, createdAt: true, avatar: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(staff);
  } catch (err: any) {
    logger.error("listStaff error", err);
    res.status(500).json({ message: "Error fetching staff list" });
  }
};

// ── POST /api/staff  (admin: create staff account) ─────────────────────────
export const createStaff = async (req: Request, res: Response) => {
  try {
    const managedBy = req.user!.id;
    const { username, email, phone, password, permissions, notes } = req.body as {
      username: string;
      email: string;
      phone: string;
      password: string;
      permissions?: string[];
      notes?: string;
    };

    if (!username || !email || !phone || !password) {
      res.status(400).json({ message: "username, email, phone and password are required" });
      return;
    }

    // Validate formats
    if (username.trim().length < 3) {
      res.status(400).json({ message: "Username must be at least 3 characters" });
      return;
    }
    if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) {
      res.status(400).json({ message: "Invalid email address format" });
      return;
    }
    if (!/^[6-9][0-9]{9}$/.test(String(phone))) {
      res.status(400).json({ message: "Phone must be a valid 10-digit Indian mobile number" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ message: "Password must be at least 6 characters" });
      return;
    }

    // Validate permissions
    const validPerms = (permissions ?? []).filter((p) =>
      STAFF_PERMISSIONS.includes(p as StaffPermission),
    );

    const emailExists = await prisma.user.findFirst({ where: { email } });
    if (emailExists) {
      res.status(409).json({ message: "An account with this email address already exists." });
      return;
    }
    const phoneExists = await prisma.user.findFirst({ where: { phone: String(phone) } });
    if (phoneExists) {
      res.status(409).json({ message: "An account with this phone number already exists." });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user + profile in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          phone: String(phone),
          password: hashedPassword,
          role: "STAFF",
          isVerified: true,
        },
      });
      const profile = await tx.staffProfile.create({
        data: {
          userId: user.id,
          managedBy,
          permissions: validPerms,
          notes: notes ?? null,
        },
      });
      return { user, profile };
    });

    res.status(201).json({
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      phone: result.user.phone,
      permissions: result.profile.permissions,
      isActive: result.profile.isActive,
      notes: result.profile.notes,
      createdAt: result.user.createdAt,
    });
  } catch (err: any) {
    logger.error("createStaff error", err);
    if (err?.code === "P2002") {
      const field = err?.meta?.target?.includes("email") ? "email address" : "phone number";
      res.status(409).json({ message: `An account with this ${field} already exists.` });
      return;
    }
    res.status(500).json({ message: "Error creating staff account" });
  }
};

// ── GET /api/staff/:id  (admin: get one staff member) ──────────────────────
export const getStaffById = async (req: Request, res: Response) => {
  try {
    const managedBy = req.user!.id;
    const { id } = req.params;

    const profile = await prisma.staffProfile.findFirst({
      where: { id: id as string, managedBy },
      include: {
        user: {
          select: { id: true, username: true, email: true, phone: true, createdAt: true },
        },
      },
    });

    if (!profile) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    res.json(profile);
  } catch (err: any) {
    logger.error("getStaffById error", err);
    res.status(500).json({ message: "Error fetching staff member" });
  }
};
// ── PATCH /api/staff/:id  (admin: update basic staff details) ────────────────
export const updateStaff = async (req: Request, res: Response) => {
  try {
    const managedBy = req.user!.id;
    const { id } = req.params;
    const { username, email, phone, notes, newPassword } = req.body as {
      username?: string;
      email?: string;
      phone?: string;
      notes?: string;
      newPassword?: string;
    };

    const profile = await prisma.staffProfile.findFirst({
      where: { id: id as string, managedBy },
    });
    if (!profile) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }

    // Check email uniqueness if changing
    if (email) {
      if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) {
        res.status(400).json({ message: "Invalid email address format" });
        return;
      }
      const conflict = await prisma.user.findFirst({
        where: { email, id: { not: profile.userId } },
      });
      if (conflict) {
        res.status(409).json({ message: "Another account with this email already exists" });
        return;
      }
    }

    if (phone && !/^[6-9][0-9]{9}$/.test(String(phone))) {
      res.status(400).json({ message: "Phone must be a valid 10-digit Indian mobile number" });
      return;
    }

    if (username && username.trim().length < 3) {
      res.status(400).json({ message: "Username must be at least 3 characters" });
      return;
    }

    if (newPassword !== undefined && newPassword !== "") {
      if (newPassword.length < 6) {
        res.status(400).json({ message: "Password must be at least 6 characters" });
        return;
      }
    }

    const [updatedUser, updatedProfile] = await prisma.$transaction(async (tx: any) => {
      const userUpdateData: Record<string, any> = {
        ...(username && { username }),
        ...(email && { email }),
        ...(phone && { phone: String(phone) }),
      };
      if (newPassword && newPassword.length >= 6) {
        userUpdateData.password = await bcrypt.hash(newPassword, 10);
      }
      return [
        await tx.user.update({
          where: { id: profile.userId },
          data: userUpdateData,
          select: { id: true, username: true, email: true, phone: true, createdAt: true },
        }),
        await tx.staffProfile.update({
          where: { id: id as string },
          data: { notes: notes ?? null },
        }),
      ];
    });

    res.json({
      id: updatedProfile.id,
      notes: updatedProfile.notes,
      user: updatedUser,
    });
  } catch (err: any) {
    logger.error("updateStaff error", err);
    res.status(500).json({ message: "Error updating staff details" });
  }
};
// ── PATCH /api/staff/:id/permissions  (admin: update permissions) ──────────
export const updatePermissions = async (req: Request, res: Response) => {
  try {
    const managedBy = req.user!.id;
    const { id } = req.params;
    const { permissions } = req.body as { permissions: string[] };

    if (!Array.isArray(permissions)) {
      res.status(400).json({ message: "permissions must be an array" });
      return;
    }

    const validPerms = permissions.filter((p) =>
      STAFF_PERMISSIONS.includes(p as StaffPermission),
    );

    const profile = await prisma.staffProfile.findFirst({
      where: { id: id as string, managedBy },
    });
    if (!profile) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }

    const updated = await prisma.staffProfile.update({
      where: { id: id as string },
      data: { permissions: validPerms },
    });
    res.json(updated);
  } catch (err: any) {
    logger.error("updatePermissions error", err);
    res.status(500).json({ message: "Error updating permissions" });
  }
};

// ── PATCH /api/staff/:id/toggle  (admin: activate / deactivate) ───────────
export const toggleStaffActive = async (req: Request, res: Response) => {
  try {
    const managedBy = req.user!.id;
    const { id } = req.params;

    const profile = await prisma.staffProfile.findFirst({
      where: { id: id as string, managedBy },
    });
    if (!profile) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }

    const updated = await prisma.staffProfile.update({
      where: { id: id as string },
      data: { isActive: !profile.isActive },
    });
    res.json(updated);
  } catch (err: any) {
    logger.error("toggleStaffActive error", err);
    res.status(500).json({ message: "Error toggling staff status" });
  }
};

// ── DELETE /api/staff/:id  (admin: remove staff) ───────────────────────────
export const deleteStaff = async (req: Request, res: Response) => {
  try {
    const managedBy = req.user!.id;
    const { id } = req.params;

    const profile = await prisma.staffProfile.findFirst({
      where: { id: id as string, managedBy },
    });
    if (!profile) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }

    // Deleting the profile cascades to deleting the User (via onDelete: Cascade on userId FK)
    await prisma.user.delete({ where: { id: profile.userId } });
    res.json({ message: "Staff member removed" });
  } catch (err: any) {
    logger.error("deleteStaff error", err);
    res.status(500).json({ message: "Error deleting staff member" });
  }
};
