import "dotenv/config";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../src/config/database";
import { Product } from "../src/models";

async function initialize() {
  console.log("=== INITIALIZING PRODUCTS RENTAL STOCK ===");
  await connectDB();

  try {
    // Set rentalStock for all products that currently have it undefined or <= 0
    const products = await Product.find({
      $or: [
        { rentalStock: { $exists: false } },
        { rentalStock: { $lte: 0 } },
        { rentalStock: null }
      ]
    });

    console.log(`Found ${products.length} products to update.`);

    let count = 0;
    for (const prod of products) {
      // Set rentalStock equal to standard stock (or at least 5 if standard stock is 0)
      const targetRentalStock = prod.stock > 0 ? prod.stock : 5;
      prod.rentalStock = targetRentalStock;
      await prod.save();
      count++;
    }

    console.log(`✅ Successfully updated ${count} products with valid rental stock values!`);
  } catch (error) {
    console.error("❌ Error during rental stock initialization:", error);
  } finally {
    await disconnectDB();
    console.log("=== COMPLETED INITIALIZING PRODUCTS RENTAL STOCK ===");
  }
}

initialize();
