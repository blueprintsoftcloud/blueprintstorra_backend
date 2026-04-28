import { Request, Response } from "express";
import { User, Product, Order } from "../models/mongoose";
import logger from "../utils/logger";

// ── GET /api/analytics/summary ─────────────────────────────────────────────
// Summary stats cards: revenue, orders, customers, products, pending orders
export const getSummary = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(now.getDate() - 60);

    const [
      totalRevenue,
      revenueThisMonth,
      revenuePrevMonth,
      totalOrders,
      ordersThisMonth,
      ordersPrevMonth,
      pendingOrders,
      totalCustomers,
      customersThisMonth,
      customersPrevMonth,
      totalProducts,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: { paymentStatus: "PAID" },
        _sum: { finalAmount: true },
      }),
      prisma.order.aggregate({
        where: { paymentStatus: "PAID", createdAt: { gte: thirtyDaysAgo } },
        _sum: { finalAmount: true },
      }),
      prisma.order.aggregate({
        where: {
          paymentStatus: "PAID",
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
        _sum: { finalAmount: true },
      }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.order.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),
      prisma.order.count({ where: { orderStatus: "PROCESSING" } }),
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.user.count({
        where: { role: "CUSTOMER", createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.user.count({
        where: {
          role: "CUSTOMER",
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
      prisma.product.count(),
    ]);

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      revenue: {
        total: totalRevenue._sum.finalAmount ?? 0,
        thisMonth: revenueThisMonth._sum.finalAmount ?? 0,
        growthPct: pct(
          revenueThisMonth._sum.finalAmount ?? 0,
          revenuePrevMonth._sum.finalAmount ?? 0,
        ),
      },
      orders: {
        total: totalOrders,
        thisMonth: ordersThisMonth,
        processing: pendingOrders,
        growthPct: pct(ordersThisMonth, ordersPrevMonth),
      },
      customers: {
        total: totalCustomers,
        thisMonth: customersThisMonth,
        growthPct: pct(customersThisMonth, customersPrevMonth),
      },
      products: {
        total: totalProducts,
      },
    });
  } catch (err: any) {
    logger.error("getSummary error", err);
    res.status(500).json({ message: "Error fetching analytics summary" });
  }
};

// ── GET /api/analytics/revenue?days=30 ────────────────────────────────────
// Daily revenue for the last N days (default 30) — bar/line chart data
export const getRevenueByDay = async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt((req.query.days as string) ?? "30") || 30, 1), 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const orders = await prisma.order.findMany({
      where: { paymentStatus: "PAID", createdAt: { gte: since } },
      select: { finalAmount: true, createdAt: true },
    });

    // Group by ISO date string "YYYY-MM-DD"
    const byDay: Record<string, { date: string; revenue: number; orders: number }> = {};

    // Pre-fill all days with zero so chart gaps are visible
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      byDay[key] = { date: key, revenue: 0, orders: 0 };
    }

    for (const o of orders) {
      const key = o.createdAt.toISOString().split("T")[0];
      if (byDay[key]) {
        byDay[key].revenue += o.finalAmount;
        byDay[key].orders += 1;
      }
    }

    res.json(Object.values(byDay));
  } catch (err: any) {
    logger.error("getRevenueByDay error", err);
    res.status(500).json({ message: "Error fetching revenue chart data" });
  }
};

// ── GET /api/analytics/order-status ───────────────────────────────────────
// Count of orders grouped by orderStatus — pie chart data
export const getOrderStatusBreakdown = async (_req: Request, res: Response) => {
  try {
    const statuses = ["PROCESSING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"] as const;

    const counts = await Promise.all(
      statuses.map((status) =>
        prisma.order.count({ where: { orderStatus: status } }),
      ),
    );

    const result = statuses.map((status, i) => ({ status, count: counts[i] }));
    res.json(result);
  } catch (err: any) {
    logger.error("getOrderStatusBreakdown error", err);
    res.status(500).json({ message: "Error fetching order status breakdown" });
  }
};

// ── GET /api/analytics/top-products?limit=5 ───────────────────────────────
// Top products by total revenue from their order items
export const getTopProducts = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) ?? "5") || 5, 1), 20);

    const items = await prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { price: true, quantity: true },
      _count: { id: true },
      orderBy: { _sum: { price: "desc" } },
      take: limit,
    });

    const productIds = items.map((i: any) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true, image: true },
    });

    const productMap = Object.fromEntries(products.map((p: any) => [p.id, p]));

    const result = items.map((item: any) => ({
      product: productMap[item.productId] ?? null,
      totalRevenue: item._sum.price ?? 0,
      totalQuantitySold: item._sum.quantity ?? 0,
      orderCount: item._count.id,
    }));

    res.json(result);
  } catch (err: any) {
    logger.error("getTopProducts error", err);
    res.status(500).json({ message: "Error fetching top products" });
  }
};

// ── GET /api/analytics/top-categories ─────────────────────────────────────
// Top categories by number of products sold through order items
export const getTopCategories = async (_req: Request, res: Response) => {
  try {
    // Find products and their categories, joined through orderItems
    const orderItems = await prisma.orderItem.findMany({
      select: {
        quantity: true,
        price: true,
        product: { select: { category: { select: { id: true, name: true } } } },
      },
    });

    const categoryMap: Record<string, { name: string; revenue: number; unitsSold: number }> = {};

    for (const item of orderItems) {
      const cat = item.product?.category;
      if (!cat) continue;
      if (!categoryMap[cat.id]) {
        categoryMap[cat.id] = { name: cat.name, revenue: 0, unitsSold: 0 };
      }
      categoryMap[cat.id].revenue += item.price;
      categoryMap[cat.id].unitsSold += item.quantity;
    }

    const result = Object.entries(categoryMap)
      .map(([id, v]: any) => ({ id, ...v }))
      .sort((a: any, b: any) => b.revenue - a.revenue)
      .slice(0, 8);

    res.json(result);
  } catch (err: any) {
    logger.error("getTopCategories error", err);
    res.status(500).json({ message: "Error fetching top categories" });
  }
};

// ── GET /api/analytics/profit?from=YYYY-MM-DD&to=YYYY-MM-DD ───────────────
// Profit summary: total revenue, total cost (purchase price), gross profit, margin %
export const getProfitSummary = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : undefined;

    const dateFilter = fromDate || toDate
      ? { createdAt: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } }
      : {};

    // Revenue (paid orders)
    const revenueAgg = await prisma.order.aggregate({
      where: { paymentStatus: "PAID", ...dateFilter },
      _sum: { finalAmount: true },
      _count: { id: true },
    });

    // For cost: multiply quantity sold * purchasePrice per item in paid orders
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: { paymentStatus: "PAID", ...dateFilter },
      },
      select: {
        quantity: true,
        price: true,
        product: { select: { purchasePrice: true } },
      },
    });

    let totalCost = 0;
    let totalRevenue = revenueAgg._sum.finalAmount ?? 0;
    let itemsWithCost = 0;
    let itemsWithoutCost = 0;

    for (const item of orderItems) {
      const pp = item.product?.purchasePrice;
      if (pp != null) {
        totalCost += pp * item.quantity;
        itemsWithCost++;
      } else {
        itemsWithoutCost++;
      }
    }

    const grossProfit = totalRevenue - totalCost;
    const marginPct = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

    // Previous period comparison
    let prevRevenue = 0;
    let prevProfit = 0;
    if (fromDate && toDate) {
      const diffMs = toDate.getTime() - fromDate.getTime();
      const prevFrom = new Date(fromDate.getTime() - diffMs);
      const prevTo = new Date(fromDate.getTime() - 1);
      const prevAgg = await prisma.order.aggregate({
        where: { paymentStatus: "PAID", createdAt: { gte: prevFrom, lte: prevTo } },
        _sum: { finalAmount: true },
      });
      prevRevenue = prevAgg._sum.finalAmount ?? 0;
      const prevItems = await prisma.orderItem.findMany({
        where: { order: { paymentStatus: "PAID", createdAt: { gte: prevFrom, lte: prevTo } } },
        select: { quantity: true, product: { select: { purchasePrice: true } } },
      });
      let prevCost = 0;
      for (const item of prevItems) {
        const pp = item.product?.purchasePrice;
        if (pp != null) prevCost += pp * item.quantity;
      }
      prevProfit = prevRevenue - prevCost;
    }

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      revenue: totalRevenue,
      cost: totalCost,
      grossProfit,
      marginPct,
      orderCount: revenueAgg._count.id,
      coveragePct: orderItems.length > 0
        ? Math.round((itemsWithCost / orderItems.length) * 100)
        : 100,
      growth: {
        revenue: pct(totalRevenue, prevRevenue),
        profit: pct(grossProfit, prevProfit),
      },
    });
  } catch (err: any) {
    logger.error("getProfitSummary error", err);
    res.status(500).json({ message: "Error fetching profit summary" });
  }
};

// ── GET /api/analytics/profit-by-day?from=YYYY-MM-DD&to=YYYY-MM-DD ────────
// Daily revenue vs cost vs profit for chart
export const getProfitByDay = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const days = 30;
    const fromDate = from ? new Date(from) : (() => { const d = new Date(); d.setDate(d.getDate() - days); return d; })();
    const toDate = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : new Date();

    const orders = await prisma.order.findMany({
      where: { paymentStatus: "PAID", createdAt: { gte: fromDate, lte: toDate } },
      select: {
        finalAmount: true,
        createdAt: true,
        items: { select: { quantity: true, product: { select: { purchasePrice: true } } } },
      },
    });

    const byDay: Record<string, { date: string; revenue: number; cost: number; profit: number; orders: number }> = {};

    // Pre-fill all days
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    for (let i = 0; i <= Math.min(diffDays, 90); i++) {
      const d = new Date(fromDate);
      d.setDate(fromDate.getDate() + i);
      const key = d.toISOString().split("T")[0];
      byDay[key] = { date: key, revenue: 0, cost: 0, profit: 0, orders: 0 };
    }

    for (const o of orders) {
      const key = o.createdAt.toISOString().split("T")[0];
      if (!byDay[key]) continue;
      byDay[key].revenue += o.finalAmount;
      byDay[key].orders += 1;
      for (const item of o.items) {
        if (item.product?.purchasePrice != null) {
          byDay[key].cost += item.product.purchasePrice * item.quantity;
        }
      }
      byDay[key].profit = byDay[key].revenue - byDay[key].cost;
    }

    res.json(Object.values(byDay));
  } catch (err: any) {
    logger.error("getProfitByDay error", err);
    res.status(500).json({ message: "Error fetching profit chart data" });
  }
};

// ── GET /api/analytics/top-products-profit?limit=10 ───────────────────────
// Top products by profit margin
export const getTopProductsByProfit = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) ?? "10") || 10, 1), 50);
    const { from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : undefined;

    const orderFilter = {
      paymentStatus: "PAID" as const,
      ...(fromDate || toDate ? { createdAt: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } } : {}),
    };

    const items = await prisma.orderItem.groupBy({
      by: ["productId"],
      where: { order: orderFilter },
      _sum: { price: true, quantity: true },
      _count: { id: true },
      orderBy: { _sum: { price: "desc" } },
      take: limit,
    });

    const productIds = items.map((i: any) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true, purchasePrice: true, image: true },
    });

    const productMap = Object.fromEntries(products.map((p: any) => [p.id, p]));

    const result = items.map((item: any) => {
      const p = productMap[item.productId];
      const revenue = item._sum.price ?? 0;
      const qty = item._sum.quantity ?? 0;
      const cost = p?.purchasePrice != null ? p.purchasePrice * qty : null;
      const profit = cost != null ? revenue - cost : null;
      const margin = revenue > 0 && profit != null ? Math.round((profit / revenue) * 100) : null;
      return {
        product: p ?? null,
        totalRevenue: revenue,
        totalQuantitySold: qty,
        orderCount: item._count.id,
        totalCost: cost,
        grossProfit: profit,
        marginPct: margin,
      };
    }).sort((a: any, b: any) => (b.grossProfit ?? 0) - (a.grossProfit ?? 0));

    res.json(result);
  } catch (err: any) {
    logger.error("getTopProductsByProfit error", err);
    res.status(500).json({ message: "Error fetching top products by profit" });
  }
};

// ── GET /api/analytics/payment-methods ────────────────────────────────────
// Breakdown of payment methods (ONLINE vs POD) with revenue
export const getPaymentMethodBreakdown = async (_req: Request, res: Response) => {
  try {
    const methods = ["ONLINE", "POD"] as const;
    const results = await Promise.all(
      methods.map(async (method) => {
        const agg = await prisma.order.aggregate({
          where: { paymentMethod: method },
          _sum: { finalAmount: true },
          _count: { id: true },
        });
        return {
          method,
          count: agg._count.id,
          revenue: agg._sum.finalAmount ?? 0,
        };
      })
    );
    res.json(results);
  } catch (err: any) {
    logger.error("getPaymentMethodBreakdown error", err);
    res.status(500).json({ message: "Error fetching payment method data" });
  }
};

// ── GET /api/analytics/summary-with-range?from=YYYY-MM-DD&to=YYYY-MM-DD ───
// Summary stats gated by date range
export const getSummaryWithRange = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : undefined;
    const dateFilter = fromDate || toDate
      ? { createdAt: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } }
      : {};

    // Comparison window (same duration before the range)
    let prevFilter: typeof dateFilter = {};
    if (fromDate && toDate) {
      const diffMs = toDate.getTime() - fromDate.getTime();
      prevFilter = { createdAt: { gte: new Date(fromDate.getTime() - diffMs), lte: new Date(fromDate.getTime() - 1) } };
    } else {
      const now = new Date(); const thirtyAgo = new Date(); thirtyAgo.setDate(now.getDate() - 30);
      const sixtyAgo = new Date(); sixtyAgo.setDate(now.getDate() - 60);
      prevFilter = { createdAt: { gte: sixtyAgo, lte: thirtyAgo } };
      if (!fromDate && !toDate) {
        Object.assign(dateFilter, { createdAt: { gte: thirtyAgo } });
      }
    }

    const [
      totalRevOrders, prevRevOrders,
      totalOrders, prevOrders,
      totalCustomers, prevCustomers,
      totalProducts,
      pendingOrders,
    ] = await Promise.all([
      prisma.order.aggregate({ where: { paymentStatus: "PAID", ...dateFilter }, _sum: { finalAmount: true } }),
      prisma.order.aggregate({ where: { paymentStatus: "PAID", ...prevFilter }, _sum: { finalAmount: true } }),
      prisma.order.count({ where: dateFilter as any }),
      prisma.order.count({ where: prevFilter as any }),
      prisma.user.count({ where: { role: "CUSTOMER", ...dateFilter } }),
      prisma.user.count({ where: { role: "CUSTOMER", ...prevFilter } }),
      prisma.product.count(),
      prisma.order.count({ where: { orderStatus: "PROCESSING" } }),
    ]);

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      revenue: {
        total: totalRevOrders._sum.finalAmount ?? 0,
        growthPct: pct(totalRevOrders._sum.finalAmount ?? 0, prevRevOrders._sum.finalAmount ?? 0),
      },
      orders: {
        total: totalOrders,
        processing: pendingOrders,
        growthPct: pct(totalOrders, prevOrders),
      },
      customers: {
        total: totalCustomers,
        growthPct: pct(totalCustomers, prevCustomers),
      },
      products: { total: totalProducts },
    });
  } catch (err: any) {
    logger.error("getSummaryWithRange error", err);
    res.status(500).json({ message: "Error fetching summary" });
  }
};
