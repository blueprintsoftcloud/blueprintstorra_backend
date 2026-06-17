import { Request, Response } from "express";
import { CompanySettings } from "../models/mongoose";
import { uploadToCloudinary } from "../config/cloudinary";
import logger from "../utils/logger";

const KEYS = ["COMPANY_NAME", "COMPANY_TAGLINE", "COMPANY_LOGO", "COMPANY_FAVICON", "ANNOUNCEMENT_BAR", "ANNOUNCEMENT_BAR_ENABLED"] as const;
type CompanyKey = (typeof KEYS)[number];

const DEFAULT_HERO_CONFIG = {
  activeTemplate: 1,
  templates: {
    "1": { title: "Summer styles are finally here", subtitle: "This year, our new summer collection will shelter you from the harsh elements of a world that doesn't care if you live or die.", ctaText: "Shop Collection", ctaLink: "/products" },
    "2": { title: "New Arrivals Just Dropped", subtitle: "Discover our latest curated pieces.", ctaText: "Explore Now", ctaLink: "/products", bgImage: "" },
    "3": { title: "Elegance Redefined", subtitle: "Timeless. Modern. Yours.", ctaText: "Shop Now", ctaLink: "/products", accentText: "New Season" },
    "4": { title: "Lets Create your Own Style", subtitle: "It is a long established fact that a reader will be distracted by the readable content of a page.", ctaText: "Shop Now", ctaLink: "/products", accentText: "Trendy Collections", highlightText: "Create", badgeText: "25%\nDiscount on Everything", bgImage: "" },
    "5": {
      title: "Elevate Your Style With Bold Fashion",
      subtitle: "Discover our latest curated pieces for the season.",
      ctaText: "Explore Collections",
      ctaLink: "/products",
      images: [
        "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&q=80&w=400",
        "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&q=80&w=400",
      ],
    },
  },
};

const DEFAULT_FOOTER_CONFIG = {
  activeTemplate: 1,
  templates: {
    "1": {
      tagline: "We are a design house dedicated to the art of Indian textile. Our mission is to keep the loom alive while dressing the future.",
      instagramLink: "https://instagram.com",
      facebookLink: "https://facebook.com",
      twitterLink: "https://twitter.com",
      mailLink: "info@yourbrand.com",
    },
    "2": {
      tagline: "Crafting timeless Indian fashion for the modern world.",
      instagramLink: "https://instagram.com",
      facebookLink: "https://facebook.com",
      twitterLink: "https://twitter.com",
      mailLink: "info@yourbrand.com",
    },
    "3": {
      tagline: "From our looms to your wardrobe — authentically Indian.",
      newsletterTitle: "Stay in the loop",
      instagramLink: "https://instagram.com",
      facebookLink: "https://facebook.com",
      twitterLink: "https://twitter.com",
      mailLink: "info@yourbrand.com",
    },
  },
};

// GET /api/admin/company-settings  — public (invoice pages need it)
export const getCompanySettings = async (_req: Request, res: Response) => {
  try {
    const rows = (await prisma.appSetting.findMany({
      where: { key: { in: [...KEYS] } },
    })) || [];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.status(200).json({ settings });
  } catch (err: any) {
    logger.error("getCompanySettings error", err);
    res.status(500).json({ message: "Error fetching company settings" });
  }
};

const parseJsonOrDefault = <T>(value: string | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

// GET /api/admin/homepage-config  — admin only (hero + footer template config)
export const getHomepageConfig = async (_req: Request, res: Response) => {
  try {
    const rows = (await prisma.appSetting.findMany({
      where: { key: { in: ["HERO_CONFIG", "FOOTER_CONFIG"] } },
    })) || [];
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;

    const heroConfig = parseJsonOrDefault(map["HERO_CONFIG"], DEFAULT_HERO_CONFIG);
    const footerConfig = parseJsonOrDefault(map["FOOTER_CONFIG"], DEFAULT_FOOTER_CONFIG);

    res.status(200).json({ heroConfig, footerConfig });
  } catch (err: any) {
    logger.error("getHomepageConfig error", err);
    res.status(500).json({ message: "Error fetching homepage config" });
  }
};

// PUT /api/admin/homepage-config/hero  — admin only
export const updateHeroConfig = async (req: Request, res: Response) => {
  try {
    const config = req.body as object;
    const value = JSON.stringify(config);
    await prisma.appSetting.upsert({
      where: { key: "HERO_CONFIG" },
      update: { value },
      create: { key: "HERO_CONFIG", value },
    });
    res.status(200).json({ message: "Hero config updated", heroConfig: config });
  } catch (err: any) {
    logger.error("updateHeroConfig error", err);
    res.status(500).json({ message: "Error updating hero config" });
  }
};

// PUT /api/admin/homepage-config/footer  — admin only
export const updateFooterConfig = async (req: Request, res: Response) => {
  try {
    const config = req.body as object;
    const value = JSON.stringify(config);
    await prisma.appSetting.upsert({
      where: { key: "FOOTER_CONFIG" },
      update: { value },
      create: { key: "FOOTER_CONFIG", value },
    });
    res.status(200).json({ message: "Footer config updated", footerConfig: config });
  } catch (err: any) {
    logger.error("updateFooterConfig error", err);
    res.status(500).json({ message: "Error updating footer config" });
  }
};

// POST /api/admin/upload-image  — admin only (returns Cloudinary URL)
export const uploadAdminImage = async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ message: "No file provided" }); return; }
    const folder = (req.body?.folder as string) || "hero";
    const url = await uploadToCloudinary(req.file.buffer, folder);
    res.status(200).json({ url });
  } catch (err: any) {
    logger.error("uploadAdminImage error", err);
    res.status(500).json({ message: "Upload failed" });
  }
};

// PUT /api/admin/company-settings  — admin + super admin
export const updateCompanySettings = async (req: Request, res: Response) => {
  try {
    const { companyName, companyTagline, logoUrl, faviconUrl, announcementBar } = req.body as {
      companyName?: string;
      companyTagline?: string;
      logoUrl?: string;
      faviconUrl?: string;
      announcementBar?: string;
    };

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    let finalLogoUrl: string | undefined = logoUrl;
    let finalFaviconUrl: string | undefined = faviconUrl;

    // If a logo file was uploaded, push to Cloudinary
    const logoFileObj = files?.["logo"]?.[0];
    if (logoFileObj) {
      finalLogoUrl = await uploadToCloudinary(logoFileObj.buffer, "company");
    }

    // If a favicon file was uploaded, push to Cloudinary
    const faviconFileObj = files?.["favicon"]?.[0];
    if (faviconFileObj) {
      finalFaviconUrl = await uploadToCloudinary(faviconFileObj.buffer, "company/favicon");
    }

    const updates: { key: CompanyKey; value: string }[] = [];

    if (companyName !== undefined && companyName.trim() !== "") {
      updates.push({ key: "COMPANY_NAME", value: companyName.trim() });
    }
    if (companyTagline !== undefined) {
      updates.push({ key: "COMPANY_TAGLINE", value: companyTagline.trim() });
    }
    if (finalLogoUrl !== undefined) {
      updates.push({ key: "COMPANY_LOGO", value: finalLogoUrl });
    }
    if (finalFaviconUrl !== undefined) {
      updates.push({ key: "COMPANY_FAVICON", value: finalFaviconUrl });
    }
    if (announcementBar !== undefined) {
      updates.push({ key: "ANNOUNCEMENT_BAR", value: announcementBar });
    }

    await Promise.all(
      updates.map((u) =>
        prisma.appSetting.upsert({
          where: { key: u.key },
          update: { value: u.value },
          create: { key: u.key, value: u.value },
        }),
      ),
    );

    // Return the freshest state
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: [...KEYS] } },
    });
    const settings: Record<string, string | null> = {
      COMPANY_NAME: null,
      COMPANY_TAGLINE: null,
      COMPANY_LOGO: null,
      COMPANY_FAVICON: null,
      ANNOUNCEMENT_BAR: null,
      ANNOUNCEMENT_BAR_ENABLED: null,
    };
    for (const row of rows) settings[row.key] = row.value;

    res.status(200).json({ message: "Company settings updated", settings });
  } catch (err: any) {
    logger.error("updateCompanySettings error", err);
    res.status(500).json({ message: "Error updating company settings" });
  }
};

// PATCH /api/admin/announcement-toggle  — admin + super admin
// Body: { enabled: boolean }
export const toggleAnnouncementBar = async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ message: "'enabled' must be a boolean" });
      return;
    }
    const value = enabled ? "true" : "false";
    await prisma.appSetting.upsert({
      where: { key: "ANNOUNCEMENT_BAR_ENABLED" },
      update: { value },
      create: { key: "ANNOUNCEMENT_BAR_ENABLED", value },
    });
    res.status(200).json({ message: `Announcement bar ${enabled ? "enabled" : "disabled"}`, enabled });
  } catch (err: any) {
    logger.error("toggleAnnouncementBar error", err);
    res.status(500).json({ message: "Error toggling announcement bar" });
  }
};
