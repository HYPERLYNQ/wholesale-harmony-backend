const mongoose = require("mongoose");

const pricingRuleSchema = new mongoose.Schema({
  shopDomain: {
    type: String,
    required: true,
    index: true, // Fast queries by shop
  },

  defaultDiscount: {
    type: Number,
    default: 0, // Default percentage discount for all products
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
