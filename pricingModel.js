const mongoose = require("mongoose");

const pricingRuleSchema = new mongoose.Schema({
  shopDomain: {
    type: String,
    required: true,
  },

  defaultDiscount: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },

  productOverrides: [
    {
      productId: {
        type: String,
        required: true,
      },
      type: {
        type: String,
        enum: ["fixed", "percentage"],
        required: true,
      },
      value: {
        type: Number,
        required: true,
        min: 0,
      },

      // ===== NEW: Dynamic customer types support =====
      enabledTypes: {
        type: [String],
        default: [],
        // Example: ["student", "esthetician", "salon", "wholesale_partner"]
      },

      // ===== NEW: Dynamic per-type discounts =====
      customerDiscounts: {
        type: Map,
        of: {
          value: Number,
          isPercentage: Boolean,
        },
        default: {},
        // Example: { "student": { value: 15, isPercentage: true } }
      },

      // ===== NEW: Dynamic per-type MOQ =====
      customerMOQ: {
        type: Map,
        of: Number,
        default: {},
        // Example: { "student": 1, "esthetician": 2, "salon": 5 }
      },

      // ===== NEW: Dynamic per-type quantity tiers =====
      quantityTiers: {
        type: Map,
        of: [
          {
            id: String,
            quantity: Number,
            discountPercent: Number,
          },
        ],
        default: {},
        // Example: { "student": [{ id: "tier_1", quantity: 10, discountPercent: 5 }] }
      },

      // ===== LEGACY: Keep old fields for backward compatibility =====
      moq: {
        student: {
          type: Number,
          default: null,
          min: 0,
        },
        esthetician: {
          type: Number,
          default: null,
          min: 0,
        },
        salon: {
          type: Number,
          default: null,
          min: 0,
        },
      },
      tiers: [
        {
          qty: {
            type: Number,
            required: true,
            min: 1,
          },
          discount: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
          },
        },
      ],

      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure one document per shop
pricingRuleSchema.index({ shopDomain: 1 }, { unique: true });

const PricingRule = mongoose.model("PricingRule", pricingRuleSchema);

module.exports = PricingRule;
