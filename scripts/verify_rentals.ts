import "dotenv/config";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../src/config/database";
import { Product, Category, RentalBooking } from "../src/models";

// Mock Express Request & Response for controller testing
const makeMockRes = () => {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.jsonData = data;
    return res;
  };
  return res;
};

async function runTests() {
  console.log("=== STARTING RENTAL MODULE VERIFICATION ===");

  // Connect to DB
  await connectDB();

  let testCategory: any = null;
  let testProduct: any = null;
  let testBookingId: string | null = null;

  try {
    // 1. Setup clean test data
    console.log("\n1. Setting up test category and product...");
    testCategory = await Category.create({
      code: "TEST_RENT_CAT",
      name: "Test Rental Category",
      description: "Temp category for testing",
      isActive: true
    });

    testProduct = await Product.create({
      code: "TEST_RENT_PROD",
      name: "Test Rental Dress",
      price: 500,
      stock: 10,
      stockQuantity: 10,
      rentalStock: 5, // initial rental stock is 5
      categoryId: testCategory._id,
      isActive: true
    });
    console.log(`Created product "${testProduct.name}" with rentalStock: ${testProduct.rentalStock}`);

    // Import controllers
    const { createRentalBooking, returnRentalBooking } = require("../src/controllers/rental.controller");

    // 2. Test Input Validation
    console.log("\n2. Testing creation validation rules...");
    const mockReq1: any = {
      body: {
        customerName: "", // missing/empty
        phone: "1234567890",
        fromDate: new Date().toISOString(),
        toDate: new Date().toISOString(),
        items: [{ productId: testProduct._id, quantity: 2 }]
      }
    };
    const mockRes1 = makeMockRes();
    await createRentalBooking(mockReq1, mockRes1);
    if (mockRes1.statusCode === 400) {
      console.log("✅ Successfully rejected empty customerName with 400 Bad Request");
    } else {
      console.error("❌ Failed to reject empty customerName, status code:", mockRes1.statusCode);
    }

    // Invalid dates check: toDate < fromDate
    const mockReq2: any = {
      body: {
        customerName: "Alice Miller",
        phone: "9876543210",
        fromDate: new Date(Date.now() + 86400000).toISOString(), // tomorrow
        toDate: new Date().toISOString(), // today (before tomorrow)
        items: [{ productId: testProduct._id, quantity: 2 }]
      }
    };
    const mockRes2 = makeMockRes();
    await createRentalBooking(mockReq2, mockRes2);
    if (mockRes2.statusCode === 400 && mockRes2.jsonData.message.includes("toDate")) {
      console.log("✅ Successfully rejected toDate < fromDate with 400 Bad Request");
    } else {
      console.error("❌ Failed to validate that toDate is greater or equal to fromDate", mockRes2.jsonData);
    }

    // 3. Test Stock Check (Insufficient Stock)
    console.log("\n3. Testing stock check and atomic rollback behavior...");
    const mockReq3: any = {
      body: {
        customerName: "Bob Smith",
        phone: "9988776655",
        fromDate: new Date().toISOString(),
        toDate: new Date(Date.now() + 86400000 * 3).toISOString(), // 3 days
        items: [{ productId: testProduct._id, quantity: 10 }] // requests 10, but only 5 available
      }
    };
    const mockRes3 = makeMockRes();
    await createRentalBooking(mockReq3, mockRes3);
    if (mockRes3.statusCode === 400 && mockRes3.jsonData.message.includes("Insufficient rental stock")) {
      console.log("✅ Successfully rejected booking due to insufficient stock");
      // Double check product stock remains unaffected
      const reloadedProd = await Product.findById(testProduct._id);
      if (reloadedProd?.rentalStock === 5) {
        console.log("✅ Verified product rentalStock remained exactly 5 (ACID atomic rollback verified)");
      } else {
        console.error("❌ Product rentalStock was modified unexpectedly:", reloadedProd?.rentalStock);
      }
    } else {
      console.error("❌ Failed to reject booking of excessive quantity", mockRes3.jsonData);
    }

    // 4. Test Successful Booking Creation
    console.log("\n4. Testing successful rental booking creation...");
    const mockReq4: any = {
      body: {
        customerName: "Charlie Brown",
        phone: "9900990099",
        fromDate: new Date().toISOString(),
        toDate: new Date(Date.now() + 86400000 * 4).toISOString(), // 4 days rental
        items: [{ productId: testProduct._id, quantity: 2 }], // requests 2
        advancePaid: 200,
        paymentMethod: "UPI"
      }
    };
    const mockRes4 = makeMockRes();
    await createRentalBooking(mockReq4, mockRes4);
    if (mockRes4.statusCode === 201) {
      const booking = mockRes4.jsonData.booking;
      testBookingId = booking._id;
      console.log("✅ Successfully created rental booking! ID:", testBookingId);
      console.log(`   Calculated duration days: ${booking.totalDurationDays} (Expected: 4)`);
      
      const reloadedProd = await Product.findById(testProduct._id);
      if (reloadedProd?.rentalStock === 3) {
        console.log("✅ Verified product rentalStock correctly decremented by 2 to:", reloadedProd.rentalStock);
      } else {
        console.error("❌ Product rentalStock was not correctly decremented:", reloadedProd?.rentalStock);
      }
    } else {
      console.error("❌ Failed to create valid booking:", mockRes4.jsonData);
    }

    // 5. Test Return Fulfill and Stock Restoration
    console.log("\n5. Testing rental returns and stock restocking...");
    if (!testBookingId) throw new Error("Skipping return test, booking not created");
    const mockReq5: any = {
      params: { id: testBookingId }
    };
    const mockRes5 = makeMockRes();
    await returnRentalBooking(mockReq5, mockRes5);
    if (mockRes5.statusCode === 200) {
      console.log("✅ Successfully returned rental booking! Status set to Returned.");
      const reloadedProd = await Product.findById(testProduct._id);
      if (reloadedProd?.rentalStock === 5) {
        console.log("✅ Verified product rentalStock restored back to original value:", reloadedProd.rentalStock);
      } else {
        console.error("❌ Product rentalStock was not correctly restored:", reloadedProd?.rentalStock);
      }
    } else {
      console.error("❌ Failed to return rental:", mockRes5.jsonData);
    }

    // 6. Test Double-Return Prevention (Accidental Duplicate Restocking Safety)
    console.log("\n6. Testing double-return safety rules...");
    const mockRes6 = makeMockRes();
    await returnRentalBooking(mockReq5, mockRes6);
    if (mockRes6.statusCode === 400 && mockRes6.jsonData.message.includes("already been returned")) {
      console.log("✅ Successfully rejected double return request and prevented duplicate restocking!");
      const reloadedProd = await Product.findById(testProduct._id);
      if (reloadedProd?.rentalStock === 5) {
        console.log("✅ Verified product rentalStock remained stable at:", reloadedProd.rentalStock);
      } else {
        console.error("❌ Stock was incorrectly modified on second return attempt:", reloadedProd?.rentalStock);
      }
    } else {
      console.error("❌ Failed to block duplicate return:", mockRes6.jsonData);
    }

  } catch (err: any) {
    console.error("❌ TEST RUN ENCOUNTERED AN EXCEPTION:", err);
  } finally {
    // 7. Cleanup DB
    console.log("\n7. Cleaning up test data from DB...");
    if (testBookingId) {
      await RentalBooking.deleteOne({ _id: testBookingId });
      console.log("   Removed test RentalBooking document.");
    }
    if (testProduct) {
      await Product.deleteOne({ _id: testProduct._id });
      console.log("   Removed test Product document.");
    }
    if (testCategory) {
      await Category.deleteOne({ _id: testCategory._id });
      console.log("   Removed test Category document.");
    }

    await disconnectDB();
    console.log("\n=== COMPLETED RENTAL MODULE VERIFICATION ===");
  }
}

runTests();
