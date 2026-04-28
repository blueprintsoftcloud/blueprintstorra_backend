import { Request, Response } from "express";
import { Address, FeatureFlag } from "../models/mongoose";
import { calculateShippingWithConfig } from "../services/shipping.service";
import { getWarehouseCoords, getShippingConfigFromDB } from "../utils/warehouseSettings";
import logger from "../utils/logger";
import NodeGeocoder from "node-geocoder";

const geocoder = NodeGeocoder({ provider: "openstreetmap" });

/** Check whether the WAREHOUSE_SETTINGS feature flag is enabled. */
const isWarehouseEnabled = async (): Promise<boolean> => {
  const flag = await FeatureFlag.findOne({ feature: "WAREHOUSE_SETTINGS" });
  return !flag || flag.isEnabled;
};

// POST /api/address/save-geo  (authenticated)
export const saveLocationAndGetShipping = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user!.id;

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({ message: "latitude and longitude are required" });
    }

    const geoResponse = await geocoder.reverse({ lat: latitude, lon: longitude });
    if (!geoResponse.length) {
      return res.status(400).json({ message: "Address not found for these coordinates" });
    }
    const data = geoResponse[0];

    let shippingCharge = 0;
    let distanceKm = 0;
    if (await isWarehouseEnabled()) {
      const [warehouse, config] = await Promise.all([getWarehouseCoords(), getShippingConfigFromDB()]);
      const result = calculateShippingWithConfig(
        latitude, longitude, data.country ?? "", data.state ?? "", config, warehouse.lat, warehouse.lng,
      );
      shippingCharge = result.shippingCharge;
      distanceKm = result.distanceKm;
    }

    const existingDefault = await Address.findOne({ userId, isDefault: true });
    const addressData = {
      userId,
      fullAddress: data.formattedAddress ?? "",
      city: data.city ?? "",
      state: data.state ?? "",
      country: data.country ?? "",
      zipCode: data.zipcode ?? "",
      latitude,
      longitude,
      isDefault: true,
    };
    const address = existingDefault
      ? await Address.findByIdAndUpdate(existingDefault.id, addressData, { new: true })
      : await Address.create(addressData);

    res.status(200).json({ address, distance: distanceKm.toFixed(2) + " KM", shippingCharge });
  } catch (err: any) {
    logger.error("saveLocationAndGetShipping error", err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/address/save-manual  (authenticated)
export const saveManualAddress = async (req: Request, res: Response) => {
  try {
    const { fullAddress, city, state, zipCode, country = "India" } = req.body;
    const userId = req.user!.id;

    if (!fullAddress || !city || !zipCode) {
      return res.status(400).json({ message: "fullAddress, city, and zipCode are required" });
    }

    let shippingCharge = 0;
    if (await isWarehouseEnabled()) {
      const [warehouse, config] = await Promise.all([getWarehouseCoords(), getShippingConfigFromDB()]);
      shippingCharge = calculateShippingWithConfig(0, 0, country, state ?? "", config, warehouse.lat, warehouse.lng).shippingCharge;
    }

    const existingDefault = await Address.findOne({ userId, isDefault: true });
    const addressData = {
      userId, fullAddress, city, state: state ?? "", country, zipCode,
      latitude: null, longitude: null, isDefault: true,
    };
    const address = existingDefault
      ? await Address.findByIdAndUpdate(existingDefault.id, addressData, { new: true })
      : await Address.create(addressData);

    res.status(200).json({ address, shippingCharge });
  } catch (err: any) {
    logger.error("saveManualAddress error", err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/address/default  (authenticated)
export const getDefaultAddress = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const address = await Address.findOne({ userId, isDefault: true });
    res.json({ address: address ?? null });
  } catch (err: any) {
    logger.error("getDefaultAddress error", err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/address/preview-shipping  (authenticated)
// Returns shipping estimate WITHOUT saving to DB — used by the delivery preview modal.
export const previewShipping = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, manual, state: manualState } = req.body;

    if (!(await isWarehouseEnabled())) {
      return res.json({ shippingCharge: 0, distanceKm: 0, type: "free", label: "Free shipping", free: true });
    }

    const [warehouse, config] = await Promise.all([getWarehouseCoords(), getShippingConfigFromDB()]);

    // Manual mode — no GPS, use provided state for rate lookup
    if (manual) {
      const result = calculateShippingWithConfig(0, 0, "India", manualState ?? "", config, warehouse.lat, warehouse.lng);
      return res.json({ ...result, free: false });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: "latitude and longitude required for GPS preview" });
    }

    let state = "";
    let country = "India";
    let fullAddress = "";
    try {
      const geo = await geocoder.reverse({ lat: latitude, lon: longitude });
      if (geo.length) {
        state = geo[0].state ?? "";
        country = geo[0].country ?? "India";
        fullAddress = geo[0].formattedAddress ?? "";
      }
    } catch { /* geocoding failed — proceed with empty state */ }

    const result = calculateShippingWithConfig(latitude, longitude, country, state, config, warehouse.lat, warehouse.lng);
    return res.json({ ...result, address: fullAddress, state, country, lat: latitude, lng: longitude, free: false });
  } catch (err: any) {
    logger.error("previewShipping error", err);
    res.status(500).json({ error: err.message });
  }
};
