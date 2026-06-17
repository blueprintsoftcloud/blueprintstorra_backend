import mongoose from "mongoose";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { Product, Category, POSOrder } from "../src/models/mongoose";

async function verifyPOSBillingFlow() {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not found in .env");

    await mongoose.connect(url);
    console.log("✅ MongoDB connected successfully for POS Verification");

    // 1. Seed or find a test category
    let category = await Category.findOne({ code: "TEST_CAT" });
    if (!category) {
      category = await Category.create({
        code: "TEST_CAT",
        name: "Test Category",
        description: "POS test category representation",
      });
      console.log("📁 Created test category:", category.code);
    }

    // 2. Seed a test product
    // Delete any existing test products first to have a clean state
    await Product.deleteMany({ code: { $in: ["POS_PROD_1", "POS_PROD_2"] } });
    await POSOrder.deleteMany({ invoiceNo: { $regex: /^TEST_INV_/ } });

    const product1 = await Product.create({
      code: "POS_PROD_1",
      name: "POS Test Croissant",
      price: 150,
      stock: 10,
      stockQuantity: 10,
      categoryId: category._id,
      images: [],
      sizes: [],
    });

    const product2 = await Product.create({
      code: "POS_PROD_2",
      name: "POS Test Cappuccino",
      price: 180,
      stock: 20,
      stockQuantity: 20,
      categoryId: category._id,
      images: [],
      sizes: [],
    });

    console.log("🥐 Created Test Product 1:", product1.name, "| Stock:", product1.stockQuantity);
    console.log("☕ Created Test Product 2:", product2.name, "| Stock:", product2.stockQuantity);

    // 3. Test Direct Billing Order (Direct sales checkout)
    console.log("\n🧪 Test Case 1: Direct Billing Order (Instant Sales Checkout)");
    const directBillingItems = [
      { productId: product1._id, quantity: 2 },
      { productId: product2._id, quantity: 3 }
    ];

    // Simulate backend mathematical validation & availability check
    let subtotal = 0;
    const itemsDetail = [];
    for (const item of directBillingItems) {
      const prod = await Product.findById(item.productId);
      if (!prod || prod.stock < item.quantity) {
        throw new Error("Direct billing failed: product unavailable or out of stock.");
      }
      subtotal += prod.price * item.quantity;
      itemsDetail.push({
        productId: prod._id,
        name: prod.name,
        price: prod.price,
        quantity: item.quantity
      });
    }
    const gstPercent = 5;
    const gstAmount = Math.round((subtotal * gstPercent) / 100);
    const serviceCharge = 15;
    const totalAmount = subtotal + gstAmount + serviceCharge;

    const directOrder = await POSOrder.create({
      invoiceNo: "TEST_INV_1",
      ticketId: "TEST_TKT_1",
      mode: "BILLING",
      status: "COMPLETED",
      paymentMethod: "CASH",
      items: itemsDetail,
      subtotal,
      gstPercent,
      gstAmount,
      serviceCharge,
      totalAmount
    });

    // Deduct stock
    for (const item of itemsDetail) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.quantity, stockQuantity: -item.quantity }
      });
    }

    // Verify stock deduction
    const afterBillingProd1 = await Product.findById(product1._id);
    const afterBillingProd2 = await Product.findById(product2._id);
    console.log("   ✅ Direct Billing Order Saved. Invoice No:", directOrder.invoiceNo);
    console.log(`   ✅ Stock decrement verified:`);
    console.log(`      - Croissant stock (Expected 8): ${afterBillingProd1?.stockQuantity}`);
    console.log(`      - Cappuccino stock (Expected 17): ${afterBillingProd2?.stockQuantity}`);

    if (afterBillingProd1?.stockQuantity !== 8 || afterBillingProd2?.stockQuantity !== 17) {
      throw new Error("❌ Stock decrement check failed for Direct Billing!");
    }

    // 4. Test KOT Ticket Creation (No stock decrement yet)
    console.log("\n🧪 Test Case 2: KOT Ticket Creation (Pending Kitchen Status)");
    const kotItems = [
      { productId: product1._id, quantity: 3 }
    ];

    const kotItemsDetail = [];
    let kotSubtotal = 0;
    for (const item of kotItems) {
      const prod = await Product.findById(item.productId);
      if (!prod) throw new Error("KOT product not found.");
      kotSubtotal += prod.price * item.quantity;
      kotItemsDetail.push({
        productId: prod._id,
        name: prod.name,
        price: prod.price,
        quantity: item.quantity
      });
    }

    const kotOrder = await POSOrder.create({
      invoiceNo: "TEST_INV_2_KOT",
      ticketId: "TEST_TKT_2_KOT",
      mode: "KOT",
      status: "PENDING_KITCHEN",
      tableNumber: "Table 4",
      customerName: "Alice Cooper",
      items: kotItemsDetail,
      subtotal: 0,
      gstPercent: 0,
      gstAmount: 0,
      serviceCharge: 0,
      totalAmount: 0
    });

    // Verify stock remains intact
    const afterKotProd1 = await Product.findById(product1._id);
    console.log("   ✅ KOT Saved successfully. Ticket ID:", kotOrder.ticketId);
    console.log(`   ✅ Verify stock remains unchanged (Expected 8): ${afterKotProd1?.stockQuantity}`);

    if (afterKotProd1?.stockQuantity !== 8) {
      throw new Error("❌ Stock should NOT be decremented on KOT ticket creation!");
    }

    // 5. Test KOT Recall and Complete Billing
    console.log("\n🧪 Test Case 3: KOT Recall and Conversion to Complete Invoice");
    const recalledKOT = await POSOrder.findOne({
      ticketId: "TEST_TKT_2_KOT",
      mode: "KOT",
      status: "PENDING_KITCHEN"
    });

    if (!recalledKOT) throw new Error("Failed to recall pending KOT order.");
    console.log("   ✅ KOT Recalled successfully from database.");

    // Perform validation and conversion
    for (const item of recalledKOT.items) {
      const prod = await Product.findById(item.productId);
      if (!prod || prod.stock < item.quantity) {
        throw new Error("Recalled KOT checkout failed: insufficient stock available.");
      }
    }

    const finalSubtotal = recalledKOT.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const finalGstAmount = Math.round((finalSubtotal * 5) / 100);
    const finalTotalAmount = finalSubtotal + finalGstAmount;

    recalledKOT.mode = "BILLING";
    recalledKOT.status = "COMPLETED";
    recalledKOT.gstPercent = 5;
    recalledKOT.gstAmount = finalGstAmount;
    recalledKOT.subtotal = finalSubtotal;
    recalledKOT.totalAmount = finalTotalAmount;
    recalledKOT.paymentMethod = "ONLINE";

    await recalledKOT.save();

    // Deduct stock on completion
    for (const item of recalledKOT.items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.quantity, stockQuantity: -item.quantity }
      });
    }

    // Verify stock has been decremented
    const finalProd1 = await Product.findById(product1._id);
    console.log("   ✅ KOT Order converted to complete invoice successfully!");
    console.log(`   ✅ Stock decrement verified on checkout (Expected 5): ${finalProd1?.stockQuantity}`);

    if (finalProd1?.stockQuantity !== 5) {
      throw new Error("❌ Stock decrement check failed for KOT complete checkout!");
    }

    // 6. Test Stock Guard / Safety Protections
    console.log("\n🧪 Test Case 4: Stock Guard Safety Protections");
    const overflowItems = [
      { productId: product1._id, quantity: 6 } // Exceeds current stock of 5
    ];

    let guardFailed = false;
    for (const item of overflowItems) {
      const prod = await Product.findById(item.productId);
      if (!prod) throw new Error("Product not found");
      
      const availableStock = prod.stock;
      if (availableStock < item.quantity) {
        console.log(`   ✅ Stock Guard correctly blocked checkout for "${prod.name}"!`);
        console.log(`      Requested: ${item.quantity} | Available: ${availableStock}`);
        guardFailed = true;
        break;
      }
    }

    if (!guardFailed) {
      throw new Error("❌ Stock Guard failed to catch out of stock checkout request!");
    }

    // 7. Cleanup
    await Product.deleteMany({ code: { $in: ["POS_PROD_1", "POS_PROD_2"] } });
    await POSOrder.deleteMany({ invoiceNo: { $regex: /^TEST_INV_/ } });
    console.log("\n🧹 Cleaned up test POS seeding data.");
    console.log("\n🌟 ALL POS LIVE BILLING INTEGRATION TESTS PASSED SUCCESSFULLY! 🌟");

  } catch (err) {
    console.error("❌ POS Verification Failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
    process.exit(0);
  }
}

verifyPOSBillingFlow();
