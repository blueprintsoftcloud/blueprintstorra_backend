import "dotenv/config";
import mongoose from "mongoose";
import logger from "../utils/logger";

export const connectDB = async (): Promise<void> => {
  try {
    const url = process.env.MONGO_URL ?? process.env.DATABASE_URL;

    if (!url) {
      logger.error("❌ MONGO_URL or DATABASE_URL is missing in .env");
      throw new Error("MONGO_URL or DATABASE_URL environment variable is required");
    }

    await mongoose.connect(url);
    logger.info("✅ MongoDB connected via Mongoose");
  } catch (err) {
    logger.error("❌ Database connection failed", err);
    process.exit(1);
  }
};

export const disconnectDB = async (): Promise<void> => {
  await mongoose.disconnect();
};


