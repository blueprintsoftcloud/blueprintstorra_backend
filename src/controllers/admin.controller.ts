import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { User, Product, Order, OrderItem, StaffProfile } from "../models/mongoose";
import logger from "../utils/logger";
import { createAuditLog } from "../utils/auditLog";
import { checkQuota } from "../utils/quotaChecker";

const calculatePercentage = (current: number, previous: number): number => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
};

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

// GET /api/admin/summary  (admin)
export const getAdminSummary = async (_req: Request, res: Response) => {
  try {
    const last30 = daysAgo(30);
    const prev30 = daysAgo(60);

    // ── Stats Cards ─────────────────────────────────────────────────────────
    const [
      orderTotal,
      orderCurrent,
      orderPrev,
      userTotal,
      userCurrent,
      userPrev,
      productTotal,
      productCurrent,
      productPrev,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: last30 } }),
      Order.countDocuments({ createdAt: { $gte: prev30, $lt: last30 } }),

      User.countDocuments({ role: "CUSTOMER" }),
      User.countDocuments({
        role: "CUSTOMER", createdAt: { $gte: last30 },
      }),
      User.countDocuments({
        role: "CUSTOMER", createdAt: { $gte: prev30, $lt: last30 },
      }),

      Product.countDocuments(),
      Product.countDocuments({ createdAt: { $gte: last30 } }),
      Product.countDocuments({
        createdAt: { $gte: prev30, $lt: last30 },
      }),
    ]);

    // Revenue (sum of finalAmount on PAID orders)
    const revenueAll = await Order.aggregate([
      { $match: { paymentStatus: "PAID" } },
      { $group: { _id: null, total: { $sum: "$finalAmount" } } }
    ]);
    const revenueCurrent = await Order.aggregate([
      { $match: { paymentStatus: "PAID", createdAt: { $gte: last30 } } },
      { $group: { _id: null, total: { $sum: "$finalAmount" } } }
    ]);
    const revenuePrev = await Order.aggregate([
      { $match: { paymentStatus: "PAID", createdAt: { $gte: prev30, $lt: last30 } } },
      { $group: { _id: null, total: { $sum: "$finalAmount" } } }
    ]);

    // ── Sales Chart (last 7 days) ────────────────────────────────────────────
    const sevenDaysAgo = daysAgo(7);
    const paidOrdersLast7 = await Order.find({
      paymentStatus: "PAID", createdAt: { $gte: sevenDaysAgo }
    }).select('finalAmount createdAt');

    // Group by date
    const salesByDate: Record<string, { revenue: number; orders: number }> = {};
    for (const o of paidOrdersLast7) {
      const day = o.createdAt.toISOString().split("T")[0];
      if (!salesByDate[day]) salesByDate[day] = { revenue: 0, orders: 0 };
      salesByDate[day].revenue += o.finalAmount;
      salesByDate[day].orders += 1;
    }
    const salesChart = Object.entries(salesByDate)
      .map(([_id, v]) => ({ _id, ...v }))
      .sort((a, b) => a._id.localeCompare(b._id));

    // ── Latest Orders ────────────────────────────────────────────────────────
    const latestOrders = await Order.find()
      .populate({
        path: 'user',
        select: 'id username email'
      })
      .populate({
        path: 'items',
        populate: {
          path: 'product',
          select: 'id name price image'
        }
      })
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      summary: {
        revenue: {
          total: revenueAll[0]?.total ?? 0,
          growth: calculatePercentage(
            revenueCurrent[0]?.total ?? 0,
            revenuePrev[0]?.total ?? 0,
          ),
        },
        orders: {
          total: orderTotal,
          growth: calculatePercentage(orderCurrent, orderPrev),
        },
        users: {
          total: userTotal,
          growth: calculatePercentage(userCurrent, userPrev),
        },
        products: {
          total: productTotal,
          growth: calculatePercentage(productCurrent, productPrev),
        },
      },
      salesChart,
      latestOrders,
    });
  } catch (err: any) {
    logger.error("getAdminSummary error", err);
    res.status(500).json({ message: "Error loading dashboard data" });
  }
};

// GET /api/admin/dashboard  (admin) — full live snapshot for dashboard home
export const getDashboardData = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const sevenDaysAgo = daysAgo(7);
    const thirtyDaysAgo = daysAgo(30);
    const sixtyDaysAgo = daysAgo(60);

    const [
      // Summary stats
      totalRevenueAgg,
      thisMonthRevenueAgg,
      prevMonthRevenueAgg,
      totalOrders,
      thisMonthOrders,
      prevMonthOrders,
      pendingOrders,
      totalCustomers,
      thisMonthCustomers,
      prevMonthCustomers,
      totalProducts,
      // Sales chart last 7 days
      last7PaidOrders,
      // Order status counts
      processingCount,
      confirmedCount,
      shippedCount,
      deliveredCount,
      cancelledCount,
      // Low stock products
      lowStockProducts,
      // Recent orders
      recentOrders,
      // Payment methods
      onlineAgg,
      codAgg,
      // Order items for top categories
      categoryOrderItems,
      // Top products
      topProductItems,
    ] = await Promise.all([
      Order.aggregate([{ $match: { paymentStatus: "PAID" } }, { $group: { _id: null, total: { $sum: "$finalAmount" } } }]),
      Order.aggregate([{ $match: { paymentStatus: "PAID", createdAt: { $gte: thirtyDaysAgo } } }, { $group: { _id: null, total: { $sum: "$finalAmount" } } }]),
      Order.aggregate([{ $match: { paymentStatus: "PAID", createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } }, { $group: { _id: null, total: { $sum: "$finalAmount" } } }]),
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Order.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      Order.countDocuments({ orderStatus: "PROCESSING" }),
      User.countDocuments({ role: "CUSTOMER" }),
      User.countDocuments({ role: "CUSTOMER", createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ role: "CUSTOMER", createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      Product.countDocuments(),
      // Last 7 days paid orders for revenue chart
      Order.find({
        paymentStatus: "PAID", createdAt: { $gte: sevenDaysAgo }
      }).select('finalAmount createdAt'),
      // Order status breakdown
      Order.countDocuments({ orderStatus: "PROCESSING" }),
      Order.countDocuments({ orderStatus: "CONFIRMED" }),
      Order.countDocuments({ orderStatus: "SHIPPED" }),
      Order.countDocuments({ orderStatus: "DELIVERED" }),
      Order.countDocuments({ orderStatus: "CANCELLED" }),
      // Low stock: products with stock <= 10, ordered by stock asc
      Product.find({ stock: { $lte: 10 } })
        .select('id name stock image')
        .populate('categoryId', 'name')
        .sort({ stock: 1 })
        .limit(8),
      // Recent orders
      Order.find()
        .select('id finalAmount orderStatus paymentStatus paymentMethod createdAt')
        .populate('userId', 'username email')
        .sort({ createdAt: -1 })
        .limit(8),
      // Payment methods
      Order.aggregate([{ $match: { paymentMethod: "ONLINE" } }, { $group: { _id: null, total: { $sum: "$finalAmount" }, count: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { paymentMethod: "POD" } }, { $group: { _id: null, total: { $sum: "$finalAmount" }, count: { $sum: 1 } } }]),
      // Category revenue — query OrderItem directly (items are NOT embedded in Order)
      Order.find({ paymentStatus: "PAID" }).select('_id').limit(5000).then(async (paidOrders) => {
        const paidIds = paidOrders.map((o: any) => o._id);
        return OrderItem.find({ orderId: { $in: paidIds } })
          .populate({ path: 'productId', select: 'categoryId', populate: { path: 'categoryId', select: 'name' } })
          .limit(50000);
      }),
      // Top products by revenue — aggregate OrderItem directly
      OrderItem.aggregate([
        { $group: { _id: "$productId", totalPrice: { $sum: { $multiply: ["$price", "$quantity"] } }, totalQuantity: { $sum: "$quantity" } } },
        { $sort: { totalPrice: -1 } },
        { $limit: 5 }
      ]),
    ]);

    // ── Build sales chart (last 7 days) ────────────────────────────────────
    const salesByDate: Record<string, { date: string; revenue: number; orders: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split("T")[0];
      salesByDate[key] = { date: key, revenue: 0, orders: 0 };
    }
    for (const o of last7PaidOrders) {
      const key = o.createdAt.toISOString().split("T")[0];
      if (salesByDate[key]) {
        salesByDate[key].revenue += o.finalAmount;
        salesByDate[key].orders += 1;
      }
    }

    // ── Build category breakdown ───────────────────────────────────────────
    const catMap: Record<string, { name: string; revenue: number; unitsSold: number }> = {};
    for (const item of categoryOrderItems) {
      const cat = (item as any).productId?.categoryId;
      if (!cat) continue;
      const catKey = cat._id?.toString() ?? cat.id?.toString();
      if (!catKey) continue;
      if (!catMap[catKey]) catMap[catKey] = { name: cat.name, revenue: 0, unitsSold: 0 };
      catMap[catKey].revenue += item.price * item.quantity;
      catMap[catKey].unitsSold += item.quantity;
    }
    const topCategories = Object.entries(catMap)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    // ── Resolve top product names ──────────────────────────────────────────
    const productIds = topProductItems.map((i: any) => i._id);
    const products = await Product.find({ _id: { $in: productIds } })
      .select('id name price image');
    const productMap = Object.fromEntries(products.map((p: any) => [p.id, p]));
    const topProducts = topProductItems.map((item: any) => ({
      product: productMap[item._id] ?? null,
      totalRevenue: item.totalPrice ?? 0,
      totalQuantitySold: item.totalQuantity ?? 0,
    }));

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      summary: {
        revenue: {
          total: totalRevenueAgg[0]?.total ?? 0,
          thisMonth: thisMonthRevenueAgg[0]?.total ?? 0,
          growthPct: pct(thisMonthRevenueAgg[0]?.total ?? 0, prevMonthRevenueAgg[0]?.total ?? 0),
        },
        orders: {
          total: totalOrders,
          thisMonth: thisMonthOrders,
          pending: pendingOrders,
          growthPct: pct(thisMonthOrders, prevMonthOrders),
        },
        customers: {
          total: totalCustomers,
          thisMonth: thisMonthCustomers,
          growthPct: pct(thisMonthCustomers, prevMonthCustomers),
        },
        products: { total: totalProducts },
      },
      salesChart: Object.values(salesByDate),
      orderStatus: [
        { status: "PROCESSING", count: processingCount },
        { status: "CONFIRMED", count: confirmedCount },
        { status: "SHIPPED", count: shippedCount },
        { status: "DELIVERED", count: deliveredCount },
        { status: "CANCELLED", count: cancelledCount },
      ].filter((s) => s.count > 0),
      topCategories,
      topProducts,
      lowStockProducts,
      recentOrders,
      paymentMethods: [
        { method: "ONLINE", count: onlineAgg[0]?.count ?? 0, revenue: onlineAgg[0]?.total ?? 0 },
        { method: "COD", count: codAgg[0]?.count ?? 0, revenue: codAgg[0]?.total ?? 0 },
      ],
    });
  } catch (err: any) {
    logger.error("getDashboardData error", err);
    res.status(500).json({ message: "Error loading dashboard snapshot" });
  }
};

// GET /api/admin/users?page=1&limit=20  (admin)
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20", role, search } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "20") || 20, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    // SUPER_ADMIN is always excluded — Admin is unaware of Super Admin's presence.
    // If a role filter is provided, respect it but never expose SUPER_ADMIN.
    const allowedRoles: ("CUSTOMER" | "ADMIN")[] = ["CUSTOMER", "ADMIN"];
    const requestedRole = role?.toUpperCase() as "CUSTOMER" | "ADMIN" | undefined;
    const where: any =
      requestedRole && allowedRoles.includes(requestedRole)
        ? { role: requestedRole }
        : { role: { $in: allowedRoles } };

    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i");
      where.$or = [
        { username: regex },
        { email: regex },
        { phone: regex },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(where)
        .select('id username email phone role isPrimaryAdmin primaryAdminId createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
      User.countDocuments(where),
    ]);

    res.json({
      users,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getAllUsers error", err);
    res.status(500).json({ message: "Error fetching users" });
  }
};

// POST /api/admin/users  (admin)
export const createAdminUser = async (req: Request, res: Response) => {
  try {
    const { username, email, phone, password, role } = req.body as {
      username: string;
      email: string;
      phone: string;
      password: string;
      role: string;
    };

    const emailExisted = await User.findOne({ email });
    if (emailExisted)
      return res.status(400).json({ Error: "An account with this email address already exists." });

    const phoneExisted = await User.findOne({ phone });
    if (phoneExisted)
      return res.status(400).json({ Error: "An account with this phone number already exists." });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Admin cannot create another SUPER_ADMIN through this endpoint
    if (role.toUpperCase() === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Cannot create a Super Admin account via this endpoint." });
    }

    const normalizedRole = role.toUpperCase() as "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";

    // ── Auto team linkage ────────────────────────────────────────────────────
    // The first ADMIN in the system is the Primary Admin (billing owner).
    // Every subsequent ADMIN is automatically linked as a Secondary Admin.
    let isPrimaryAdmin = false;
    let resolvedPrimaryAdminId: string | null = null;

    if (normalizedRole === 'ADMIN') {
      const existingPrimary = await User.findOne({ role: 'ADMIN', isPrimaryAdmin: true }).select('_id').lean();
      if (!existingPrimary) {
        // No primary exists yet — this user becomes the Primary Admin.
        isPrimaryAdmin = true;
      } else {
        // A Primary Admin already exists — link this user as a Secondary Admin.
        isPrimaryAdmin = false;
        resolvedPrimaryAdminId = existingPrimary._id.toString();
      }
    }

    if (normalizedRole === 'ADMIN') {
      await checkQuota(req, 'admins');
    }

    const newUser = await User.create({
      username,
      email,
      phone,
      password: hashedPassword,
      role: normalizedRole,
      isVerified: true,
      ...(normalizedRole === 'ADMIN' && {
        isPrimaryAdmin,
        ...(resolvedPrimaryAdminId && { primaryAdminId: resolvedPrimaryAdminId }),
      }),
    });
    await createAuditLog({ req, action: "CREATE_USER", entity: "User", details: { username, email, role: normalizedRole } });
    res.json({ message: `User created successfully with role: ${normalizedRole}.` });
  } catch (err: any) {
    logger.error("createAdminUser error", err);
    if (err?.code === "P2002") {
      const field = err?.meta?.target?.includes("email") ? "email address" : "phone number";
      return res.status(400).json({ Error: `An account with this ${field} already exists.` });
    }
    res
      .status(500)
      .json({ message: "Error in creating user", Error: err.message });
  }
};

// PATCH /api/admin/users/:id  (admin)
export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { username, email, phone } = req.body as {
      username?: string;
      email?: string;
      phone?: string;
    };

    const existing = await User.findById(id).select('id role');
    if (!existing) return res.status(404).json({ message: "User not found." });
    if (existing.role === "SUPER_ADMIN") {
      return res.status(403).json({ message: "Cannot modify a Super Admin account." });
    }

    // Check uniqueness conflicts
    if (email || phone) {
      const orConditions: any[] = [];
      if (email) orConditions.push({ email });
      if (phone) orConditions.push({ phone });
      const conflict = await User.findOne({
        _id: { $ne: id },
        $or: orConditions
      }).select('id');
      if (conflict) {
        return res.status(400).json({ message: "Email or phone already in use by another account." });
      }
    }

    const updated = await User.findByIdAndUpdate(
      id,
      {
        ...(username !== undefined && { username }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
      },
      { new: true }
    ).select('id username email phone role');

    return res.json({ message: "User updated successfully.", user: updated });
  } catch (err: any) {
    logger.error("updateUser error", err);
    return res.status(500).json({ message: "Error updating user." });
  }
};

// DELETE /api/admin/users/:id  (admin)
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const target = await User.findById(id).select('id role');
    if (!target) return res.status(404).json({ message: "User not found." });
    if (target.role === "SUPER_ADMIN") {
      return res.status(403).json({ message: "Cannot delete a Super Admin account." });
    }
    if (req.user?.id === id) {
      return res.status(400).json({ message: "You cannot delete your own account." });
    }

    if (target.role === "ADMIN") {
      // Find all staff profiles managed by this admin
      const staffProfiles = await StaffProfile.find({ managedBy: id });
      const staffUserIds = staffProfiles.map((sp) => sp.userId);

      // Delete staff profiles
      await StaffProfile.deleteMany({ managedBy: id });

      // Delete staff users
      if (staffUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: staffUserIds } });
      }
    }

    await User.findByIdAndDelete(id);
    await createAuditLog({ req, action: "DELETE_USER", entity: "User", entityId: id, details: { role: target.role } });
    return res.json({ message: "User deleted successfully." });
  } catch (err: any) {
    logger.error("deleteUser error", err);
    return res.status(500).json({ message: "Error deleting user." });
  }
};
