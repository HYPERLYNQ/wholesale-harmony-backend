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
        required: false,
        default: "percentage",
      },
      value: {
        type: Number,
        required: false,
        min: 0,
        default: 0,
      },

      // ===== Dynamic customer types support =====
      enabledTypes: {
        type: [String],
        default: [],
      },

      // ===== Per-type discounts =====
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

      // ===== Per-type MOQ =====
      customerMOQ: {
        type: Map,
        of: Number,
        default: new Map(),
      },

      // ===== NEW: Per-type quantity tiers =====
      customerTiers: {
        type: Map,
        of: [
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
