/* ========================================
   MIGRATION: Convert Hardcoded MOQ to Dynamic Types
   Run this ONCE after deploying new schema
   ======================================== */

require("dotenv").config();
const mongoose = require("mongoose");
const PricingRule = require("./pricingModel");

async function migrate() {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 MIGRATION: Convert to Dynamic Customer Types");
    console.log("=".repeat(60) + "\n");

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    const pricingRules = await PricingRule.find();
    console.log(`📦 Found ${pricingRules.length} pricing rule documents\n`);

    let totalUpdated = 0;

    for (const rule of pricingRules) {
      console.log(`\n📋 Processing shop: ${rule.shopDomain}`);
      console.log(`   ${rule.productOverrides.length} product overrides`);

      let updated = 0;

      for (const override of rule.productOverrides) {
        // Skip if already migrated
        if (override.enabledTypes && override.enabledTypes.length > 0) {
          console.log(
            `   ⏭️  SKIP: Product ${override.productId} (already migrated)`
          );
          continue;
        }

        // Auto-detect enabled types from existing moq data
        const enabledTypes = [];
        const customerMOQ = {};

        // Convert old moq structure to new dynamic structure
        if (override.moq) {
          if (override.moq.student != null && override.moq.student > 0) {
            enabledTypes.push("student");
            customerMOQ["student"] = override.moq.student;
          }
          if (
            override.moq.esthetician != null &&
            override.moq.esthetician > 0
          ) {
            enabledTypes.push("esthetician");
            customerMOQ["esthetician"] = override.moq.esthetician;
          }
          if (override.moq.salon != null && override.moq.salon > 0) {
            enabledTypes.push("salon");
            customerMOQ["salon"] = override.moq.salon;
          }
        }

        // Set enabledTypes
        override.enabledTypes = enabledTypes;

        // Convert to Map format
        override.customerMOQ = new Map(Object.entries(customerMOQ));

        // Initialize empty customerDiscounts if not exists
        if (!override.customerDiscounts) {
          override.customerDiscounts = new Map();
        }

        // Initialize empty quantityTiers if not exists
        if (!override.quantityTiers) {
          override.quantityTiers = new Map();
        }

        updated++;
        console.log(`   ✅ Product ${override.productId}`);
        console.log(
          `      Enabled types: ${enabledTypes.join(", ") || "none"}`
        );
        console.log(`      MOQ: ${JSON.stringify(customerMOQ)}`);
      }

      if (updated > 0) {
        await rule.save();
        totalUpdated += updated;
        console.log(`   💾 Saved ${updated} updates`);
      } else {
        console.log(`   ⏭️  No updates needed`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Migration Complete!");
    console.log("=".repeat(60));
    console.log(`✅ Total products updated: ${totalUpdated}`);
    console.log(`📊 Total shops processed: ${pricingRules.length}`);
    console.log("=".repeat(60) + "\n");

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

migrate();
