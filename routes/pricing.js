// ========================================
// PRICING ROUTES - WHOLESALE HARMONY
// Backend API for Product Pricing Management
// ========================================
//
// This router handles:
// - Fetching products with pricing data
// - Per-customer-type discounts
// - Per-customer-type MOQ (Minimum Order Quantity)
// - Per-customer-type quantity discount tiers
// - Bulk updates and product resets
// - Theme integration endpoints
// - Shopify Function cart discount calculations
//
// ========================================

const express = require("express");
const router = express.Router();
const axios = require("axios");
const PricingRule = require("../pricingModel");
const Settings = require("../settingsModel");

// ========================================
// CONFIGURATION
// ========================================
const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ========================================
// GET /api/pricing/products
// Fetch all products with pricing rules
// ========================================
router.get("/products", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      productType = "",
      vendor = "",
    } = req.query;

    console.log("📊 Fetching products for pricing...");

    // ---------- LOAD PRICING RULES ----------
    let pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      pricingRule = await PricingRule.create({
        shopDomain: SHOPIFY_SHOP,
        defaultDiscount: 0,
        productOverrides: [],
      });
    }

    // ---------- LOAD CUSTOMER TYPES FROM SETTINGS ----------
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerTypes = settings?.customerTypes || [];

    console.log(
      `✅ Loaded ${customerTypes.length} customer types from Settings`
    );
    customerTypes.forEach((type) => {
      console.log(`   ${type.icon} ${type.name}: ${type.defaultDiscount}%`);
    });

    // ---------- BUILD SHOPIFY GRAPHQL QUERY ----------
    let query = `first: ${limit}`;
    if (search) {
      query += `, query: "title:*${search}*"`;
    }

    const productsQuery = `
      query {
        products(${query}) {
          edges {
            node {
              id
              title
              priceRangeV2 {
                minVariantPrice {
                  amount
                }
              }
              productType
              vendor
              featuredImage {
                url
              }
              variants(first: 1) {
                edges {
                  node {
                    sku
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    // ---------- FETCH PRODUCTS FROM SHOPIFY ----------
    const productsResponse = await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
      { query: productsQuery },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    // ---------- PROCESS PRODUCTS WITH PRICING ----------
    const products = productsResponse.data.data.products.edges.map((edge) => {
      const product = edge.node;
      const productId = product.id.split("/").pop();
      const regularPrice = parseFloat(
        product.priceRangeV2.minVariantPrice.amount
      );

      // Find product-specific override
      const override = pricingRule.productOverrides.find(
        (p) => p.productId === productId
      );

      // ===== CALCULATE PER-TYPE DISCOUNTS =====
      let appliedDiscounts = {};

      if (
        override &&
        override.customerDiscounts &&
        override.customerDiscounts.size > 0
      ) {
        // Mode: Per-customer-type discounts
        customerTypes.forEach((type) => {
          const typeDiscount = override.customerDiscounts.get(type.id);
          if (typeDiscount) {
            appliedDiscounts[type.id] = {
              value: typeDiscount.value,
              type: typeDiscount.type || "percentage",
              isCustom: true,
            };
          } else {
            appliedDiscounts[type.id] = {
              value: type.defaultDiscount || 0,
              type: "percentage",
              isCustom: false,
            };
          }
        });
      } else if (override && override.value !== undefined) {
        // Mode: Global discount (same for all types)
        customerTypes.forEach((type) => {
          const typeDefault = type.defaultDiscount || 0;
          const overrideValue = override.value;

          const isActuallyCustom =
            (override.type === "percentage" && overrideValue !== typeDefault) ||
            override.type === "fixed";

          appliedDiscounts[type.id] = {
            value: override.value,
            type: override.type || "percentage",
            isCustom: isActuallyCustom,
          };
        });
      } else {
        // Mode: No override - use Settings defaults
        customerTypes.forEach((type) => {
          appliedDiscounts[type.id] = {
            value: type.defaultDiscount || 0,
            type: "percentage",
            isCustom: false,
          };
        });
      }

      // ===== CALCULATE DISPLAY PRO PRICE (first customer type) =====
      let proPrice;
      if (
        override &&
        override.customerDiscounts &&
        override.customerDiscounts.size > 0
      ) {
        const firstType = customerTypes[0];
        const firstTypeDiscount = override.customerDiscounts.get(firstType.id);
        if (firstTypeDiscount) {
          proPrice =
            firstTypeDiscount.type === "fixed"
              ? firstTypeDiscount.value
              : regularPrice * (1 - firstTypeDiscount.value / 100);
        } else {
          proPrice =
            regularPrice * (1 - (firstType.defaultDiscount || 0) / 100);
        }
      } else if (override && override.value !== undefined) {
        proPrice =
          override.type === "fixed"
            ? override.value
            : regularPrice * (1 - override.value / 100);
      } else {
        const firstTypeDiscount = customerTypes[0]?.defaultDiscount || 0;
        proPrice = regularPrice * (1 - firstTypeDiscount / 100);
      }

      // ===== BUILD PER-TYPE MOQ DATA =====
      const moqData = {};
      customerTypes.forEach((type) => {
        let moqValue = null;
        let isDefault = true;

        // Check dynamic MOQ first (new Map structure)
        if (override?.customerMOQ && override.customerMOQ.has(type.id)) {
          moqValue = override.customerMOQ.get(type.id);
          isDefault = false;
        }
        // Check legacy MOQ structure
        else if (override?.moq && override.moq[type.id] !== undefined) {
          moqValue = override.moq[type.id];
          isDefault = false;
        }
        // Fallback to Settings default
        else {
          moqValue = type.moqDefault || 0;
          isDefault = true;
        }

        if (moqValue > 0) {
          moqData[type.id] = {
            value: moqValue,
            isDefault: isDefault,
          };
        }
      });

      // ===== BUILD PER-TYPE TIERS DATA =====
      const tiersData = {};
      let hasPerTypeTiers = false;

      if (override?.customerTiers && override.customerTiers.size > 0) {
        // Per-type tiers exist
        hasPerTypeTiers = true;
        customerTypes.forEach((type) => {
          const typeTiers = override.customerTiers.get(type.id);
          if (typeTiers && typeTiers.length > 0) {
            tiersData[type.id] = typeTiers;
          }
        });
      }

      // ===== EXTRACT SKU =====
      const sku = product.variants?.edges[0]?.node?.sku || null;

      // ===== RETURN PRODUCT WITH PRICING =====
      return {
        productId,
        title: product.title,
        image: product.featuredImage?.url,
        productType: product.productType,
        vendor: product.vendor,
        regularPrice,
        proPrice,
        sku,
        appliedDiscounts,
        moqData,
        tiersData,
        hasPerTypeTiers,
        hasOverride: !!override,
      };
    });

    console.log(`✅ Processed ${products.length} products with pricing`);

    // ---------- SEND RESPONSE ----------
    res.json({
      success: true,
      products,
      customerTypes,
      hasNextPage: productsResponse.data.data.products.pageInfo.hasNextPage,
    });
  } catch (err) {
    console.error("❌ Error fetching products:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// PUT /api/pricing/product/:productId
// Update pricing for a specific product
// ========================================
router.put("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { discount, moqUpdates, tierUpdates } = req.body;

    console.log(`💾 Updating pricing for Product ${productId}`);

    // ---------- LOAD PRICING RULES ----------
    let pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      pricingRule = await PricingRule.create({
        shopDomain: SHOPIFY_SHOP,
        defaultDiscount: 0,
        productOverrides: [],
      });
    }

    // ---------- FIND OR CREATE PRODUCT OVERRIDE ----------
    let override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );

    if (!override) {
      override = {
        productId,
        value: 0,
        type: "percentage",
        customerDiscounts: new Map(),
        customerMOQ: new Map(),
        customerTiers: new Map(),
      };
      pricingRule.productOverrides.push(override);
    }

    // ---------- UPDATE DISCOUNT ----------
    if (discount) {
      if (discount.perType && Object.keys(discount.perType).length > 0) {
        // Per-customer-type discounts
        if (!override.customerDiscounts) {
          override.customerDiscounts = new Map();
        }
        Object.entries(discount.perType).forEach(([typeId, data]) => {
          override.customerDiscounts.set(typeId, {
            value: data.value,
            type: data.type || "percentage",
          });
        });
        console.log(
          `   ✅ Set per-type discounts for ${
            Object.keys(discount.perType).length
          } customer types`
        );
      } else {
        // Global discount
        override.value = discount.value;
        override.type = discount.type || "percentage";
        console.log(`   ✅ Set global discount: ${discount.value}%`);
      }
    }

    // ---------- UPDATE MOQ ----------
    if (moqUpdates) {
      if (!override.customerMOQ) {
        override.customerMOQ = new Map();
      }
      Object.entries(moqUpdates).forEach(([typeId, moqValue]) => {
        if (moqValue > 0) {
          override.customerMOQ.set(typeId, moqValue);
        } else {
          override.customerMOQ.delete(typeId);
        }
      });
      console.log(
        `   ✅ Updated MOQ for ${Object.keys(moqUpdates).length} customer types`
      );
    }

    // ---------- UPDATE TIERS ----------
    if (tierUpdates) {
      if (!override.customerTiers) {
        override.customerTiers = new Map();
      }
      Object.entries(tierUpdates).forEach(([typeId, tiers]) => {
        if (tiers && tiers.length > 0) {
          override.customerTiers.set(typeId, tiers);
        } else {
          override.customerTiers.delete(typeId);
        }
      });
      console.log(
        `   ✅ Updated tiers for ${
          Object.keys(tierUpdates).length
        } customer types`
      );
    }

    // ---------- SAVE ----------
    await pricingRule.save();
    console.log(`✅ Pricing saved for Product ${productId}`);

    res.json({ success: true, override });
  } catch (err) {
    console.error("❌ Error updating pricing:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// DELETE /api/pricing/product/:productId
// Reset product to default pricing
// ========================================
router.delete("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    console.log(`🗑️ Resetting pricing for Product ${productId}`);

    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({ success: true, message: "No pricing rules to reset" });
    }

    // Remove override
    pricingRule.productOverrides = pricingRule.productOverrides.filter(
      (p) => p.productId !== productId
    );

    await pricingRule.save();
    console.log(`✅ Pricing reset for Product ${productId}`);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error resetting pricing:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// GET /api/pricing/product/:productId
// PATCHED: Now supports variant-specific pricing
// ========================================
//
// WHAT'S NEW:
// - Accepts optional ?variantId= query parameter
// - Fetches variant-specific price when variantId provided
// - Falls back to product min price when no variantId
// - All discount/tier/MOQ logic remains the same
//
// USAGE:
// - Product level: /api/pricing/product/123?customerId=456
// - Variant level: /api/pricing/product/123?customerId=456&variantId=789
//
// ========================================

router.get("/product/:productId", async (req, res) => {
  try {
    // ========================================
    // EXTRACT PARAMETERS
    // ========================================
    const { productId } = req.params;
    const { customerId, variantId } = req.query; // NEW: variantId support

    console.log(
      `💰 Fetching pricing for Product ${productId}${
        variantId ? ` / Variant ${variantId}` : ""
      }`
    );

    // ========================================
    // LOAD PRICING RULES
    // ========================================
    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.status(404).json({
        success: false,
        error: "No pricing rules configured",
      });
    }

    // ========================================
    // LOAD SETTINGS (for currency)
    // ========================================
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const currencyCode = settings?.currencyCode || "USD";

    // ========================================
    // BUILD SHOPIFY GRAPHQL QUERY
    // ========================================
    // NEW: Two different queries based on whether variantId is provided
    let productQuery;

    if (variantId) {
      // VARIANT-SPECIFIC QUERY
      // Fetches exact price for the selected variant
      productQuery = `
        query {
          productVariant(id: "gid://shopify/ProductVariant/${variantId}") {
            id
            price
            product {
              id
              title
            }
          }
        }
      `;
    } else {
      // PRODUCT-LEVEL QUERY (original behavior)
      // Uses minimum variant price as fallback
      productQuery = `
        query {
          product(id: "gid://shopify/Product/${productId}") {
            id
            title
            priceRangeV2 {
              minVariantPrice {
                amount
              }
            }
          }
        }
      `;
    }

    // ========================================
    // FETCH FROM SHOPIFY
    // ========================================
    const productResponse = await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
      { query: productQuery },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    // ========================================
    // EXTRACT PRODUCT DATA & PRICE
    // ========================================
    // NEW: Handle both variant-specific and product-level responses
    let productData;
    let regularPrice;

    if (variantId) {
      // Extract from variant query response
      const variantData = productResponse.data.data.productVariant;
      if (!variantData) {
        return res.status(404).json({
          success: false,
          error: "Variant not found",
        });
      }
      productData = variantData.product; // Parent product info
      regularPrice = parseFloat(variantData.price); // Variant's specific price
      console.log(`   📦 Variant price: $${regularPrice.toFixed(2)}`);
    } else {
      // Extract from product query response (original behavior)
      productData = productResponse.data.data.product;
      if (!productData) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }
      regularPrice = parseFloat(
        productData.priceRangeV2.minVariantPrice.amount
      );
      console.log(`   📦 Product min price: $${regularPrice.toFixed(2)}`);
    }

    // ========================================
    // GET PRODUCT OVERRIDE
    // ========================================
    const override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );
    const hasOverride = !!override;

    // ========================================
    // CALCULATE PRO PRICE
    // ========================================
    // Same logic as before, just applied to regularPrice
    // (which now might be variant-specific or product-level)
    let proPrice;

    if (
      override &&
      override.customerDiscounts &&
      override.customerDiscounts.size > 0
    ) {
      // Per-customer-type discount
      const customerTypes = settings?.customerTypes || [];
      const firstType = customerTypes[0];
      if (firstType) {
        const firstTypeDiscount = override.customerDiscounts.get(firstType.id);
        if (firstTypeDiscount) {
          proPrice =
            firstTypeDiscount.type === "fixed"
              ? firstTypeDiscount.value
              : regularPrice * (1 - firstTypeDiscount.value / 100);
        } else {
          proPrice =
            regularPrice * (1 - (firstType.defaultDiscount || 0) / 100);
        }
      } else {
        proPrice = regularPrice;
      }
    } else if (override && override.value !== undefined) {
      // Global override
      proPrice =
        override.type === "fixed"
          ? override.value
          : regularPrice * (1 - override.value / 100);
    } else {
      // Default discount
      proPrice = regularPrice * (1 - pricingRule.defaultDiscount / 100);
    }

    console.log(`   💰 Pro price: $${proPrice.toFixed(2)}`);

    // ========================================
    // DETERMINE CUSTOMER STATUS
    // ========================================
    const customerStatus = {
      isLoggedIn: false,
      isApproved: false,
      isPending: false,
      isRejected: false,
      accountType: "consumer",
      moq: null,
    };

    // Fetch customer data if logged in
    if (customerId) {
      try {
        const customerQuery = `
          query {
            customer(id: "gid://shopify/Customer/${customerId}") {
              id
              tags
            }
          }
        `;

        const customerResponse = await axios.post(
          `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
          { query: customerQuery },
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        const customerData = customerResponse.data.data.customer;
        if (customerData) {
          customerStatus.isLoggedIn = true;
          const tags = customerData.tags;

          // Check approval status
          if (tags.includes("pro-pricing")) {
            customerStatus.isApproved = true;
          } else if (tags.includes("pending")) {
            customerStatus.isPending = true;
          } else if (tags.includes("rejected")) {
            customerStatus.isRejected = true;
          }

          // Determine account type
          if (tags.includes("student")) customerStatus.accountType = "student";
          else if (tags.includes("esthetician"))
            customerStatus.accountType = "esthetician";
          else if (tags.includes("salon")) customerStatus.accountType = "salon";
          else customerStatus.accountType = "consumer";

          // Get MOQ for this customer type
          if (override?.customerMOQ) {
            customerStatus.moq =
              override.customerMOQ.get(customerStatus.accountType) || null;
          } else if (override?.moq) {
            customerStatus.moq = override.moq[customerStatus.accountType];
          }
        }
      } catch (err) {
        console.error("Error fetching customer:", err.message);
      }
    }

    // ========================================
    // GET QUANTITY TIERS
    // ========================================
    let tiers = [];
    if (customerStatus.isApproved && override) {
      // Check per-type tiers first
      if (override.customerTiers && override.customerTiers.size > 0) {
        const typeTiers = override.customerTiers.get(
          customerStatus.accountType
        );
        if (typeTiers && typeTiers.length > 0) {
          tiers = typeTiers
            .map((tier) => ({
              qty: tier.qty,
              discount: tier.discount,
              price: regularPrice * (1 - tier.discount / 100), // Applied to variant price
              savings: tier.discount,
            }))
            .sort((a, b) => a.qty - b.qty);
        }
      }
      // Fallback to global tiers
      else if (override.tiers && override.tiers.length > 0) {
        tiers = override.tiers
          .map((tier) => ({
            qty: tier.qty,
            discount: tier.discount,
            price: regularPrice * (1 - tier.discount / 100), // Applied to variant price
            savings: tier.discount,
          }))
          .sort((a, b) => a.qty - b.qty);
      }
    }

    // ========================================
    // SEND RESPONSE
    // ========================================
    res.json({
      success: true,
      productId,
      variantId: variantId || null, // NEW: Include variant ID in response
      regularPrice,
      proPrice,
      currencyCode,
      customerStatus,
      tiers,
      moq: customerStatus.moq,
      hasOverride,
    });

    console.log(`✅ Pricing response sent successfully`);
  } catch (err) {
    console.error("❌ Error fetching product pricing:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// GET /api/pricing/cart-discount
// Calculate discount for cart (Shopify Function)
// ========================================
router.get("/cart-discount", async (req, res) => {
  try {
    const { customerId, productId, quantity = 1 } = req.query;

    console.log(
      `🛒 Cart discount check: Product ${productId}, Customer ${
        customerId || "guest"
      }, Qty ${quantity}`
    );

    let discountPercent = 0;
    let discountType = "none";
    let accountType = "consumer";

    // ---------- CHECK IF CUSTOMER IS LOGGED IN ----------
    if (!customerId) {
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "Not logged in",
      });
    }

    // ---------- FETCH CUSTOMER DATA ----------
    try {
      const customerQuery = `
        query {
          customer(id: "gid://shopify/Customer/${customerId}") {
            id
            tags
          }
        }
      `;

      const customerResponse = await axios.post(
        `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
        { query: customerQuery },
        {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      const customerData = customerResponse.data.data.customer;
      if (!customerData) {
        return res.json({
          success: true,
          discount: 0,
          type: "none",
          message: "Customer not found",
        });
      }

      const customerTags = customerData.tags;
      const isApproved = customerTags.includes("pro-pricing");

      // Check if customer is approved
      if (!isApproved) {
        return res.json({
          success: true,
          discount: 0,
          type: "none",
          message: "Customer not approved for wholesale pricing",
        });
      }

      // Determine account type
      if (customerTags.includes("student")) accountType = "student";
      else if (customerTags.includes("esthetician"))
        accountType = "esthetician";
      else if (customerTags.includes("salon")) accountType = "salon";
    } catch (err) {
      console.error("Error fetching customer:", err.message);
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "Error fetching customer data",
      });
    }

    // ---------- LOAD PRICING RULES ----------
    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "No pricing rules configured",
      });
    }

    // ---------- GET PRODUCT OVERRIDE ----------
    const override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );

    // ---------- CALCULATE BASE DISCOUNT ----------
    let baseDiscount = 0;
    if (override && override.type === "percentage") {
      baseDiscount = override.value;
    } else {
      baseDiscount = pricingRule.defaultDiscount;
    }

    // ---------- CHECK QUANTITY TIERS ----------
    if (override) {
      let tiersToCheck = [];

      // Check per-type tiers first
      if (override.customerTiers && override.customerTiers.size > 0) {
        const typeTiers = override.customerTiers.get(accountType);
        if (typeTiers && typeTiers.length > 0) {
          tiersToCheck = typeTiers;
        }
      }
      // Fallback to global tiers
      else if (override.tiers && override.tiers.length > 0) {
        tiersToCheck = override.tiers;
      }

      // Apply tier discount if quantity qualifies
      if (tiersToCheck.length > 0) {
        const sortedTiers = tiersToCheck
          .filter((tier) => parseInt(quantity) >= tier.qty)
          .sort((a, b) => b.qty - a.qty);

        if (sortedTiers.length > 0) {
          const additionalDiscount = sortedTiers[0].discount;
          const combinedMultiplier =
            (1 - baseDiscount / 100) * (1 - additionalDiscount / 100);
          discountPercent = (1 - combinedMultiplier) * 100;
          discountType = "tier";
        } else {
          discountPercent = baseDiscount;
          discountType = "base";
        }
      } else {
        discountPercent = baseDiscount;
        discountType = "override";
      }
    } else {
      discountPercent = pricingRule.defaultDiscount;
      discountType = "default";
    }

    // ---------- CHECK MINIMUM ORDER QUANTITY ----------
    let meetsMinimum = true;
    if (override?.customerMOQ) {
      const moq = override.customerMOQ.get(accountType);
      if (moq && parseInt(quantity) < moq) {
        meetsMinimum = false;
      }
    } else if (override?.moq?.[accountType]) {
      const moq = override.moq[accountType];
      if (moq && parseInt(quantity) < moq) {
        meetsMinimum = false;
      }
    }

    // ---------- SEND RESPONSE ----------
    res.json({
      success: true,
      discount: meetsMinimum ? discountPercent : 0,
      type: discountType,
      accountType,
      quantity: parseInt(quantity),
      meetsMinimum,
      message: meetsMinimum
        ? `${discountPercent}% discount applied`
        : `Below minimum order quantity`,
    });
  } catch (err) {
    console.error("❌ Error calculating cart discount:", err);
    res.status(500).json({
      success: false,
      discount: 0,
      error: err.message,
    });
  }
});

// ========================================
// EXPORT ROUTER
// ========================================
module.exports = router;
