// src/services/shipping.service.ts
// Single source of truth for shipping calculation.
// Replaces duplicate Haversine code in orderController.js and addressController.js.

import { env } from "../config/env";

// Keep env-based warehouse as the sync default (used when callers already have coords)
export const DEFAULT_WAREHOUSE = {
  lat: parseFloat(env.WAREHOUSE_LAT) || 9.9312,
  lng: parseFloat(env.WAREHOUSE_LNG) || 76.2673,
};

const BASE_SHIPPING_LOCAL = 50; // Flat fee up to 10 km (within same city)
const PER_KM_CHARGE = 5; // Extra per KM beyond 10 km
const STATE_FLAT_RATE = 150; // Different Indian state
const GLOBAL_FLAT_RATE = 1500; // International

// Minimum valid coordinate: treat 0,0 (null island) as "unknown"
const isValidCoord = (lat: number, lng: number): boolean =>
  !(lat === 0 && lng === 0) && !isNaN(lat) && !isNaN(lng);

export interface ShippingResult {
  shippingCharge: number;
  distanceKm: number;
}

/**
 * Haversine formula — calculates straight-line distance between two lat/lng points in km.
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Calculate shipping charge based on customer location, country, and state.
 *
 * @param customerLat  - Customer latitude  (null/0 = unknown → use flat rates)
 * @param customerLng  - Customer longitude (null/0 = unknown → use flat rates)
 * @param country      - Customer country string
 * @param state        - Customer state string
 * @param warehouseLat - Warehouse latitude  (defaults to DEFAULT_WAREHOUSE.lat)
 * @param warehouseLng - Warehouse longitude (defaults to DEFAULT_WAREHOUSE.lng)
 */
export const calculateShipping = (
  customerLat: number,
  customerLng: number,
  country: string,
  state: string,
  warehouseLat: number = DEFAULT_WAREHOUSE.lat,
  warehouseLng: number = DEFAULT_WAREHOUSE.lng,
): ShippingResult => {
  // International orders: flat rate regardless of known/unknown coords
  if (country && country.toLowerCase() !== "india") {
    return { shippingCharge: GLOBAL_FLAT_RATE, distanceKm: 0 };
  }

  // Different Indian state: flat rate
  if (state && state.toLowerCase() !== "kerala") {
    return { shippingCharge: STATE_FLAT_RATE, distanceKm: 0 };
  }

  // Within Kerala: use distance if we have real coords, otherwise flat local rate
  if (!isValidCoord(customerLat, customerLng)) {
    // No GPS data (manual address) — charge the base local rate as a safe default
    return { shippingCharge: BASE_SHIPPING_LOCAL, distanceKm: 0 };
  }

  const distanceKm = calculateDistance(
    warehouseLat,
    warehouseLng,
    customerLat,
    customerLng,
  );

  const shippingCharge =
    distanceKm <= 10
      ? BASE_SHIPPING_LOCAL
      : BASE_SHIPPING_LOCAL + Math.round(distanceKm - 10) * PER_KM_CHARGE;

  return { shippingCharge, distanceKm };
};

// ── Configurable shipping ──────────────────────────────────────────────────────

export interface ShippingConfig {
  sameStateName: string;           // e.g. "Kerala"
  otherStateFlatRate: number;      // ₹150 default
  sameStateBaseRate: number;       // ₹50 default
  sameStatePerKmRate: number;      // ₹5/km default
  sameStateFreeKmThreshold: number; // 10 km default
  manualFlatRate: number;          // ₹50 default
}

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  sameStateName: "Kerala",
  otherStateFlatRate: 150,
  sameStateBaseRate: 50,
  sameStatePerKmRate: 5,
  sameStateFreeKmThreshold: 10,
  manualFlatRate: 50,
};

export interface ShippingBreakdown {
  shippingCharge: number;
  distanceKm: number;
  type: "other_state" | "same_state_gps" | "manual" | "free";
  label: string;
}

/**
 * DB-config-aware shipping calculator — rates come from ShippingConfig (stored in AppSetting).
 * Keeps the same logic as calculateShipping but uses configurable thresholds.
 */
export const calculateShippingWithConfig = (
  customerLat: number,
  customerLng: number,
  country: string,
  state: string,
  config: ShippingConfig = DEFAULT_SHIPPING_CONFIG,
  warehouseLat: number = DEFAULT_WAREHOUSE.lat,
  warehouseLng: number = DEFAULT_WAREHOUSE.lng,
): ShippingBreakdown => {
  // No international shipping
  if (country && country.toLowerCase() !== "india") {
    return { shippingCharge: 0, distanceKm: 0, type: "free", label: "No international shipping available" };
  }

  // Different Indian state — flat rate
  if (state && state.toLowerCase() !== config.sameStateName.toLowerCase()) {
    return {
      shippingCharge: config.otherStateFlatRate,
      distanceKm: 0,
      type: "other_state",
      label: `Other Indian state — flat \u20b9${config.otherStateFlatRate}`,
    };
  }

  // Same state but no GPS (manual address)
  if (!isValidCoord(customerLat, customerLng)) {
    return {
      shippingCharge: config.manualFlatRate,
      distanceKm: 0,
      type: "manual",
      label: `Manual address (no GPS) — \u20b9${config.manualFlatRate} flat`,
    };
  }

  // Same state with GPS — distance-based
  const distanceKm = calculateDistance(warehouseLat, warehouseLng, customerLat, customerLng);
  if (distanceKm <= config.sameStateFreeKmThreshold) {
    return {
      shippingCharge: config.sameStateBaseRate,
      distanceKm,
      type: "same_state_gps",
      label: `${config.sameStateName} \u00b7 ${distanceKm.toFixed(1)} km \u00b7 \u20b9${config.sameStateBaseRate} base`,
    };
  }
  const extraKm = Math.round(distanceKm - config.sameStateFreeKmThreshold);
  const shippingCharge = config.sameStateBaseRate + extraKm * config.sameStatePerKmRate;
  return {
    shippingCharge,
    distanceKm,
    type: "same_state_gps",
    label: `${config.sameStateName} \u00b7 ${distanceKm.toFixed(1)} km \u00b7 \u20b9${config.sameStateBaseRate} + \u20b9${config.sameStatePerKmRate}\u00d7${extraKm} km extra`,
  };
};

