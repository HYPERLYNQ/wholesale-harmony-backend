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
      // ===== CHANGED: Not required when using customerDiscounts =====
      type: {
        type: String,
        enum: ["fixed", "percentage"],
        required: false, // Changed from true
        default: "percentage",
      },
      // ===== CHANGED: Not required when using customerDiscounts =====
      value: {
        type: Number,
        required: false, // Changed from true
        min: 0,
        default: 0,
      },

      // ===== NEW: Dynamic customer types support =====
      enabledTypes: {
        type: [String],
        default: [],
      },

      // ===== FIXED: Changed schema to match what backend sends =====
      customerDiscounts: {
        type: Map,
        of: new mongoose.Schema(
          {
            value: { type: Number, required: true },
            type: {
              type: String,
              enum: ["percentage", "fixed"],
              default: "percentage",
            },
          },
          { _id: false }
        ),
        default: new Map(),
      },

      // ===== NEW: Dynamic per-type MOQ =====
      customerMOQ: {
        type: Map,
        of: Number,
        default: new Map(),
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
        default: new Map(),
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
