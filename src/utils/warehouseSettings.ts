// src/utils/warehouseSettings.ts
// Reads warehouse coordinates from AppSetting table (DB-backed).
// Falls back to .env / hardcoded Kerala defaults if not yet configured.

import { AppSetting } from "../models/mongoose";
import { env } from "../config/env";

const DEFAULT_LAT = parseFloat(env.WAREHOUSE_LAT) || 9.9312;
const DEFAULT_LNG = parseFloat(env.WAREHOUSE_LNG) || 76.2673;

export interface WarehouseCoords {
  lat: number;
  lng: number;
}

export async function getWarehouseCoords(): Promise<WarehouseCoords> {
  const [latSetting, lngSetting] = await Promise.all([
    AppSetting.findOne({ key: "WAREHOUSE_LAT" }),
    AppSetting.findOne({ key: "WAREHOUSE_LNG" }),
  ]);

  return {
    lat: latSetting ? parseFloat(latSetting.value) : DEFAULT_LAT,
    lng: lngSetting ? parseFloat(lngSetting.value) : DEFAULT_LNG,
  };
}

// ── Shipping config ────────────────────────────────────────────────────────────

import type { ShippingConfig } from "../services/shipping.service";

const SHIPPING_DEFAULTS: Record<string, string> = {
  SHIPPING_SAME_STATE: "Kerala",
  SHIPPING_OTHER_STATE_FLAT: "150",
  SHIPPING_SAME_STATE_BASE: "50",
  SHIPPING_SAME_STATE_PER_KM: "5",
  SHIPPING_SAME_STATE_FREE_KM: "10",
  SHIPPING_MANUAL_FLAT: "50",
};

export async function getShippingConfigFromDB(): Promise<ShippingConfig> {
  const keys = Object.keys(SHIPPING_DEFAULTS);
  const settings = await AppSetting.find({ key: { $in: keys } });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  return {
    sameStateName: map["SHIPPING_SAME_STATE"] ?? SHIPPING_DEFAULTS["SHIPPING_SAME_STATE"],
    otherStateFlatRate: Number(map["SHIPPING_OTHER_STATE_FLAT"] ?? 150),
    sameStateBaseRate: Number(map["SHIPPING_SAME_STATE_BASE"] ?? 50),
    sameStatePerKmRate: Number(map["SHIPPING_SAME_STATE_PER_KM"] ?? 5),
    sameStateFreeKmThreshold: Number(map["SHIPPING_SAME_STATE_FREE_KM"] ?? 10),
    manualFlatRate: Number(map["SHIPPING_MANUAL_FLAT"] ?? 50),
  };
}
