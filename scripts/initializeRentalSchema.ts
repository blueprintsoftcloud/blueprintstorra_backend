import "dotenv/config";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../src/config/database";
import { 
  RentalBooking, 
  Product, 
  Subscription, 
  Plan, 
  SaaSOrder, 
  POSOrder 
} from "../src/models/mongoose";

async function initializeAllSchemas() {
  console.log("🚀 === INITIALIZING ALL NEW SCHEMAS ===\n");
  
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB\n");

    const createdCollections: string[] = [];
    const updatedCollections: string[] = [];

    // ─────────────────────────────────────────────────────────────────
    // Step 1: Subscription Collection
    // ─────────────────────────────────────────────────────────────────
    console.log("📋 Step 1: Creating Subscription collection...");
    try {
      await Subscription.collection.createIndex({ adminId: 1 }, { unique: true });
      await Subscription.collection.createIndex({ status: 1 });
      createdCollections.push("Subscription");
      console.log("✅ Subscription collection created with indexes\n");
    } catch (error: any) {
      if (error.code === 48) {
        console.log("ℹ️  Subscription collection already exists\n");
      } else {
        throw error;
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 2: Plan Collection
    // ─────────────────────────────────────────────────────────────────
    console.log("📋 Step 2: Creating Plan collection...");
    try {
      await Plan.collection.createIndex({ code: 1 }, { unique: true });
      createdCollections.push("Plan");
      console.log("✅ Plan collection created with indexes\n");
    } catch (error: any) {
      if (error.code === 48) {
        console.log("ℹ️  Plan collection already exists\n");
      } else {
        throw error;
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 3: SaaSOrder Collection
    // ─────────────────────────────────────────────────────────────────
    console.log("📋 Step 3: Creating SaaSOrder collection...");
    try {
      await SaaSOrder.collection.createIndex({ adminId: 1 });
      await SaaSOrder.collection.createIndex({ createdAt: -1 });
      createdCollections.push("SaaSOrder");
      console.log("✅ SaaSOrder collection created with indexes\n");
    } catch (error: any) {
      if (error.code === 48) {
        console.log("ℹ️  SaaSOrder collection already exists\n");
      } else {
        throw error;
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 4: POSOrder Collection
    // ─────────────────────────────────────────────────────────────────
    console.log("📋 Step 4: Creating POSOrder collection...");
    try {
      await POSOrder.collection.createIndex({ invoiceNo: 1 });
      await POSOrder.collection.createIndex({ ticketId: 1 });
      await POSOrder.collection.createIndex({ status: 1 });
      await POSOrder.collection.createIndex({ mode: 1 });
      createdCollections.push("POSOrder");
      console.log("✅ POSOrder collection created with indexes\n");
    } catch (error: any) {
      if (error.code === 48) {
        console.log("ℹ️  POSOrder collection already exists\n");
      } else {
        throw error;
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 5: RentalBooking Collection
    // ─────────────────────────────────────────────────────────────────
    console.log("📋 Step 5: Creating RentalBooking collection...");
    try {
      await RentalBooking.collection.createIndex({ status: 1 });
      await RentalBooking.collection.createIndex({ customerName: 1 });
      await RentalBooking.collection.createIndex({ fromDate: 1, toDate: 1 });
      createdCollections.push("RentalBooking");
      console.log("✅ RentalBooking collection created with indexes\n");
    } catch (error: any) {
      if (error.code === 48) {
        console.log("ℹ️  RentalBooking collection already exists\n");
      } else {
        throw error;
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 6: Add rentalStock field to products
    // ─────────────────────────────────────────────────────────────────
    console.log("📦 Step 6: Initializing rental stock for products...");
    const productsToUpdate = await Product.find({
      $or: [
        { rentalStock: { $exists: false } },
        { rentalStock: { $lte: 0 } },
        { rentalStock: null }
      ]
    });

    if (productsToUpdate.length > 0) {
      console.log(`Found ${productsToUpdate.length} products needing rental stock initialization`);
      
      let updateCount = 0;
      for (const product of productsToUpdate) {
        const targetRentalStock = product.stock > 0 ? product.stock : 5;
        product.rentalStock = targetRentalStock;
        await product.save();
        updateCount++;
      }
      updatedCollections.push(`Product (${updateCount} items updated)`);
      console.log(`✅ Updated ${updateCount} products with rental stock\n`);
    } else {
      console.log("ℹ️  All products already have valid rental stock\n");
    }

    // ─────────────────────────────────────────────────────────────────
    // Step 7: Verify all collections
    // ─────────────────────────────────────────────────────────────────
    console.log("🔍 Step 7: Verifying all collections...");
    const collections = await mongoose.connection.db?.listCollections().toArray();
    const collectionNames = collections?.map(c => c.name.toLowerCase()) || [];

    console.log("\n📊 Collection Status:");
    console.log(`  • subscription: ${collectionNames.includes('subscriptions') ? '✅' : '⚠️'}`);
    console.log(`  • plan: ${collectionNames.includes('plans') ? '✅' : '⚠️'}`);
    console.log(`  • saasorder: ${collectionNames.includes('saasorders') ? '✅' : '⚠️'}`);
    console.log(`  • posorder: ${collectionNames.includes('posorders') ? '✅' : '⚠️'}`);
    console.log(`  • rentalbooking: ${collectionNames.includes('rentalbookings') ? '✅' : '⚠️'}`);

    console.log("\n✨ === SCHEMA INITIALIZATION COMPLETED SUCCESSFULLY ===\n");
    console.log("📝 Summary:");
    console.log(`  • New Collections Created: ${createdCollections.length}`);
    createdCollections.forEach(col => console.log(`    ✅ ${col}`));
    
    if (updatedCollections.length > 0) {
      console.log(`  • Collections Updated: ${updatedCollections.length}`);
      updatedCollections.forEach(col => console.log(`    ✅ ${col}`));
    }
    
    console.log(`  • Database: ${process.env.MONGODB_URI?.split('/').pop() || 'blueprint'}`);
    console.log("");

  } catch (error) {
    console.error("\n❌ Error during schema initialization:", error);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

initializeAllSchemas();
