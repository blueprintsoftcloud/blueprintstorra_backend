import { Request } from "express";
import { User, Category, Product, Subscription, Plan } from "../models/mongoose";
import { AppError } from "./AppError";

export type ResourceType = 'admins' | 'staff' | 'categories' | 'productsPerCategory';

export const checkQuota = async (req: Request, resource: ResourceType, categoryId?: string) => {
  // 1. Find the Primary Admin to locate the active subscription
  const primaryAdmin = await User.findOne({ role: 'ADMIN', isPrimaryAdmin: true }).lean();
  if (!primaryAdmin) return; // Bypass if no primary admin exists yet

  const sub = await Subscription.findOne({ adminId: primaryAdmin._id, status: 'ACTIVE' }).lean();
  if (!sub) throw new AppError(403, "No active subscription found.");

  const plan = await Plan.findOne({ code: sub.planCode }).lean();
  if (!plan || !plan.limits) return;

  // 2. Count current resource usage
  let currentCount = 0;
  let limit = 0;

  if (resource === 'admins') {
    currentCount = await User.countDocuments({ role: 'ADMIN' });
    limit = plan.limits.admins;
  } else if (resource === 'staff') {
    currentCount = await User.countDocuments({ role: 'STAFF' });
    limit = plan.limits.staff;
  } else if (resource === 'categories') {
    currentCount = await Category.countDocuments();
    limit = plan.limits.categories;
  } else if (resource === 'productsPerCategory') {
    if (!categoryId) throw new AppError(400, "Category ID is required to check product limits.");
    currentCount = await Product.countDocuments({ categoryId });
    limit = plan.limits.productsPerCategory;
  }

  // 3. Enforce limit and generate dynamic error message
  if (currentCount >= limit) {
    const higherPlanExists = await Plan.exists({ price: { $gt: plan.price } });
    
    const resourceName = resource === 'productsPerCategory' ? 'products in this category' : resource;
    
    if (higherPlanExists) {
      throw new AppError(403, `You have reached the maximum limit of ${limit} ${resourceName}. Please upgrade your plan to add more.`);
    } else {
      throw new AppError(403, `You have reached the absolute platform limit of ${limit} ${resourceName}.`);
    }
  }
};