const mongoose = require("mongoose");

// CustomerPricing Schema - Individual customer pricing exceptions
const customerPricingSchema = new mongoose.Schema(
  {
    // Customer identification
    customerId: {
      type: String,
      required: true,
      index: true, // For fast lookups
    },
    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
    },
    customerType: {
      type: String, // wholesale, salon, student, etc.
    },
    baseDiscount: {
      type: Number, // From customer type default
      default: 0,
    },

    // Product-specific pricing rules
    productRules: [
      {
        productId: {
          type: String,
          required: true,
        },
        productTitle: String,
        productHandle: String,
        variantId: String, // Optional: for variant-specific pricing
        variantTitle: String,

        // Rule configuration
        ruleType: {
          type: String,
          enum: ["percentage", "fixed_amount", "fixed_price"],
          required: true,
        },
        value: {
          type: Number,
          required: true,
        },
        originalPrice: Number, // Store for reference

        // Metadata
        note: String, // e.g., "Contract pricing - Renewal 2025-12-31"
        expiresAt: Date,
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedBy: String, // Admin user who created/updated
      },
    ],

    // Tier/Volume pricing rules
    tierRules: [
      {
        appliesTo: {
          type: String,
          enum: ["all_products", "specific_product"],
          default: "all_products",
        },
        productId: String, // Only if appliesTo = "specific_product"
        productTitle: String,

        tiers: [
          {
            quantity: {
              type: Number,
              required: true,
            },
            discount: {
              type: Number,
              required: true,
            },
            discountType: {
              type: String,
              enum: ["percentage", "fixed_amount"],
              default: "percentage",
            },
          },
        ],

        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedBy: String,
      },
    ],

    // Price list assignments
    priceLists: [
      {
        listId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "PriceList", // Reference to PriceList model (future)
        },
        listName: String,
        assignedAt: {
          type: Date,
          default: Date.now,
        },
        expiresAt: Date,
        assignedBy: String, // Admin user
      },
    ],

    // Shop domain (multi-store support)
    shopDomain: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Indexes for performance
customerPricingSchema.index({ customerId: 1, shopDomain: 1 });
customerPricingSchema.index({ customerEmail: 1, shopDomain: 1 });

// Static method: Get or create customer pricing document
customerPricingSchema.statics.getOrCreate = async function (
  customerId,
  shopDomain
) {
  let pricing = await this.findOne({ customerId, shopDomain });

  if (!pricing) {
    pricing = await this.create({
      customerId,
      customerEmail: "", // Will be filled in when needed
      shopDomain,
      productRules: [],
      tierRules: [],
      priceLists: [],
    });
  }

  return pricing;
};

// Instance method: Add product rule
customerPricingSchema.methods.addProductRule = function (ruleData) {
  // Remove existing rule for same product/variant if exists
  this.productRules = this.productRules.filter(
    (rule) =>
      !(
        rule.productId === ruleData.productId &&
        rule.variantId === ruleData.variantId
      )
  );

  // Add new rule
  this.productRules.push(ruleData);
  return this.save();
};

// Instance method: Remove product rule
customerPricingSchema.methods.removeProductRule = function (ruleId) {
  this.productRules = this.productRules.filter(
    (rule) => rule._id.toString() !== ruleId
  );
  return this.save();
};

// Instance method: Update product rule
customerPricingSchema.methods.updateProductRule = function (ruleId, updates) {
  const rule = this.productRules.id(ruleId);
  if (!rule) throw new Error("Rule not found");

  Object.assign(rule, updates);
  return this.save();
};

// Instance method: Add tier rule
customerPricingSchema.methods.addTierRule = function (tierData) {
  this.tierRules.push(tierData);
  return this.save();
};

// Instance method: Remove tier rule
customerPricingSchema.methods.removeTierRule = function (ruleId) {
  this.tierRules = this.tierRules.filter(
    (rule) => rule._id.toString() !== ruleId
  );
  return this.save();
};

// Instance method: Calculate effective price for a product
customerPricingSchema.methods.calculatePrice = function (
  productId,
  variantId,
  regularPrice,
  quantity = 1
) {
  let finalPrice = regularPrice;
  let appliedRule = null;

  // Step 1: Check for product-specific fixed price (highest priority)
  const fixedPriceRule = this.productRules.find(
    (rule) =>
      rule.productId === productId &&
      rule.ruleType === "fixed_price" &&
      (!rule.variantId || rule.variantId === variantId) &&
      (!rule.expiresAt || new Date(rule.expiresAt) > new Date())
  );

  if (fixedPriceRule) {
    return {
      finalPrice: fixedPriceRule.value,
      appliedRule: "fixed_price",
      ruleDetails: fixedPriceRule,
    };
  }

  // Step 2: Check for product-specific percentage/fixed_amount
  const productRule = this.productRules.find(
    (rule) =>
      rule.productId === productId &&
      (!rule.variantId || rule.variantId === variantId) &&
      (!rule.expiresAt || new Date(rule.expiresAt) > new Date())
  );

  if (productRule) {
    if (productRule.ruleType === "percentage") {
      finalPrice = regularPrice * (1 - productRule.value / 100);
    } else if (productRule.ruleType === "fixed_amount") {
      finalPrice = Math.max(0, regularPrice - productRule.value);
    }
    appliedRule = productRule;
  } else if (this.baseDiscount > 0) {
    // Step 3: Apply customer type base discount
    finalPrice = regularPrice * (1 - this.baseDiscount / 100);
    appliedRule = { type: "base_discount", value: this.baseDiscount };
  }

  // Step 4: Check for tier pricing (additional discount)
  const tierRule = this.tierRules.find(
    (rule) =>
      (rule.appliesTo === "all_products" || rule.productId === productId) &&
      rule.tiers.some((tier) => quantity >= tier.quantity)
  );

  if (tierRule) {
    // Find applicable tier (highest quantity threshold met)
    const applicableTier = tierRule.tiers
      .filter((tier) => quantity >= tier.quantity)
      .sort((a, b) => b.quantity - a.quantity)[0];

    if (applicableTier) {
      if (applicableTier.discountType === "percentage") {
        finalPrice = finalPrice * (1 - applicableTier.discount / 100);
      } else {
        finalPrice = Math.max(0, finalPrice - applicableTier.discount);
      }
    }
  }

  return {
    finalPrice: Math.max(0, finalPrice),
    appliedRule: appliedRule ? appliedRule.type || appliedRule.ruleType : null,
    ruleDetails: appliedRule,
  };
};

const CustomerPricing = mongoose.model(
  "CustomerPricing",
  customerPricingSchema
);

module.exports = CustomerPricing;
