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

      // ===== RETURN PRODUCT DATA =====
      return {
        id: productId,
        title: product.title,
        sku,
        regularPrice,
        proPrice,
        appliedDiscounts, // Per-type discounts
        productType: product.productType || "Uncategorized",
        vendor: product.vendor || "Unknown",
        image: product.featuredImage?.url,
        override: override || null,
        moq: moqData, // Per-type MOQ
        tiers: tiersData, // Per-type tiers
        hasPerTypeTiers, // Flag to indicate per-type mode
      };
    });

    // ---------- APPLY FILTERS ----------
    let filtered = products;
    if (productType) {
      filtered = filtered.filter((p) => p.productType === productType);
    }
    if (vendor) {
      filtered = filtered.filter((p) => p.vendor === vendor);
    }

    console.log(
      `✅ Returning ${filtered.length} products with per-type pricing`
    );

    // ---------- SEND RESPONSE ----------
    res.json({
      success: true,
      products: filtered,
      defaultDiscount: pricingRule.defaultDiscount, // Legacy
      customerTypes, // Dynamic customer types from Settings
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: productsResponse.data.data.products.pageInfo.hasNextPage,
      },
    });
  } catch (err) {
    console.error("❌ Error fetching products:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// PUT /api/pricing/default
// Update global default discount (LEGACY)
// ========================================
router.put("/default", async (req, res) => {
  try {
    const { discount } = req.body;

    const pricingRule = await PricingRule.findOneAndUpdate(
      { shopDomain: SHOPIFY_SHOP },
      { defaultDiscount: discount, updatedAt: new Date() },
      { new: true, upsert: true }
    );

    console.log(`✅ Updated default discount to ${discount}%`);
    res.json({ success: true, defaultDiscount: pricingRule.defaultDiscount });
  } catch (err) {
    console.error("❌ Error updating default discount:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// POST /api/pricing/bulk-update
// Bulk update product pricing rules
// ========================================
router.post("/bulk-update", async (req, res) => {
  try {
    const { products } = req.body;

    // ---------- LOAD PRICING RULES ----------
    let pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      pricingRule = new PricingRule({
        shopDomain: SHOPIFY_SHOP,
        productOverrides: [],
      });
    }

    // ---------- PROCESS EACH PRODUCT UPDATE ----------
    products.forEach((update) => {
      console.log("🔍 INCOMING UPDATE:", JSON.stringify(update, null, 2));

      const existingIndex = pricingRule.productOverrides.findIndex(
        (p) => p.productId === update.productId
      );

      // ===== CONVERT FRONTEND FORMATS TO SCHEMA FORMATS =====

      // Convert typeDiscounts → customerDiscounts (Map)
      if (update.typeDiscounts) {
        update.customerDiscounts = update.typeDiscounts;
        delete update.typeDiscounts;

        console.log(
          "✅ CONVERTED TO customerDiscounts:",
          JSON.stringify(update.customerDiscounts, null, 2)
        );

        // Schema requires value/type placeholders for per-type mode
        if (update.value === undefined) update.value = 0;
        if (update.type === undefined) update.type = "percentage";
      }

      // Convert moq object → customerMOQ (Map)
      if (update.moq && typeof update.moq === "object") {
        const moqMap = new Map();
        Object.entries(update.moq).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            moqMap.set(key, value);
          }
        });
        update.customerMOQ = moqMap;
      }

      // Convert typeTiers object → customerTiers (Map)
      if (update.typeTiers && typeof update.typeTiers === "object") {
        const tiersMap = new Map();
        Object.entries(update.typeTiers).forEach(([typeId, tiers]) => {
          if (tiers && Array.isArray(tiers) && tiers.length > 0) {
            tiersMap.set(typeId, tiers);
          }
        });
        update.customerTiers = tiersMap;
        delete update.typeTiers;

        console.log(
          "✅ CONVERTED TO customerTiers:",
          JSON.stringify(Object.fromEntries(tiersMap), null, 2)
        );
      }

      console.log(
        "💾 FINAL UPDATE OBJECT:",
        JSON.stringify(
          {
            productId: update.productId,
            type: update.type,
            value: update.value,
            customerDiscounts: update.customerDiscounts,
            customerMOQ: update.customerMOQ
              ? Object.fromEntries(update.customerMOQ)
              : null,
            customerTiers: update.customerTiers
              ? Object.fromEntries(update.customerTiers)
              : null,
            tiers: update.tiers, // Legacy global tiers
          },
          null,
          2
        )
      );

      // ===== UPDATE OR CREATE OVERRIDE =====
      if (existingIndex >= 0) {
        // Update existing override
        pricingRule.productOverrides[existingIndex] = {
          ...pricingRule.productOverrides[existingIndex],
          ...update,
          updatedAt: new Date(),
        };
      } else {
        // Create new override
        pricingRule.productOverrides.push({
          ...update,
          updatedAt: new Date(),
        });
      }
    });

    // ---------- SAVE TO DATABASE ----------
    pricingRule.updatedAt = new Date();
    await pricingRule.save();

    console.log(`✅ Bulk updated ${products.length} products`);
    res.json({ success: true, updated: products.length });
  } catch (err) {
    console.error("❌ Error bulk updating:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// POST /api/pricing/reset
// Reset products to Settings defaults
// ========================================
router.post("/reset", async (req, res) => {
  try {
    const { productIds } = req.body;

    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({ success: true, removed: 0 });
    }

    // Remove overrides for specified products
    pricingRule.productOverrides = pricingRule.productOverrides.filter(
      (p) => !productIds.includes(p.productId)
    );

    pricingRule.updatedAt = new Date();
    await pricingRule.save();

    console.log(`✅ Reset ${productIds.length} products to default`);
    res.json({ success: true, removed: productIds.length });
  } catch (err) {
    console.error("❌ Error resetting products:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================
// GET /api/pricing/product/:productId
// Get pricing for single product (Theme Integration)
// PATCHED: Now supports variant-specific pricing
// ========================================
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { customerId, variantId } = req.query; // PATCHED: Added variantId

    console.log(
      `🏷️ Fetching pricing for product ${productId}${
        variantId ? `, variant ${variantId}` : ""
      }, customer ${customerId || "guest"}`
    );

    // ---------- LOAD PRICING RULES ----------
    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({
        success: false,
        error: "No pricing configuration found",
      });
    }

    // ---------- FETCH PRODUCT FROM SHOPIFY ----------
    // PATCHED: Conditional query based on variantId
    let productQuery;

    if (variantId) {
      // Query specific variant price
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
      // Query product min price (original behavior)
      productQuery = `
        query {
          product(id: "gid://shopify/Product/${productId}") {
            id
            title
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      `;
    }

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

    // PATCHED: Handle both variant and product responses
    let regularPrice;
    let currencyCode = "USD"; // Default

    if (variantId) {
      // Extract variant price
      const variant = productResponse.data.data.productVariant;
      if (!variant) {
        return res.json({ success: false, error: "Variant not found" });
      }
      regularPrice = parseFloat(variant.price);
    } else {
      // Extract product price (original)
      const product = productResponse.data.data.product;
      if (!product) {
        return res.json({ success: false, error: "Product not found" });
      }
      regularPrice = parseFloat(product.priceRangeV2.minVariantPrice.amount);
      currencyCode = product.priceRangeV2.minVariantPrice.currencyCode;
    }

    // ---------- GET PRODUCT OVERRIDE ----------
    const override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );

    // ---------- CALCULATE PRO PRICE ----------
    let proPrice;
    let hasOverride = false;
    if (override) {
      hasOverride = true;
      proPrice =
        override.type === "fixed"
          ? override.value
          : regularPrice * (1 - override.value / 100);
    } else {
      proPrice = regularPrice * (1 - pricingRule.defaultDiscount / 100);
    }

    // ---------- GET CUSTOMER STATUS ----------
    let customerStatus = {
      isLoggedIn: false,
      isPending: false,
      isApproved: false,
      isRejected: false,
      accountType: "consumer",
      moq: null,
    };

    if (customerId) {
      try {
        const customerResponse = await axios.get(
          `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers/${customerId}.json`,
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        const customer = customerResponse.data.customer;
        const tags = customer.tags.split(", ");

        customerStatus.isLoggedIn = true;
        customerStatus.isPending = tags.includes("pending-approval");
        customerStatus.isApproved = tags.includes("pro-pricing");
        customerStatus.isRejected = tags.includes("rejected");

        // Determine account type from tags
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
      } catch (err) {
        console.error("Error fetching customer:", err.message);
      }
    }

    // ---------- GET QUANTITY TIERS ----------
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
              price: regularPrice * (1 - tier.discount / 100),
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
            price: regularPrice * (1 - tier.discount / 100),
            savings: tier.discount,
          }))
          .sort((a, b) => a.qty - b.qty);
      }
    }

    // ---------- SEND RESPONSE ----------
    res.json({
      success: true,
      productId,
      regularPrice,
      proPrice,
      currencyCode,
      customerStatus,
      tiers,
      moq: customerStatus.moq,
      hasOverride,
    });
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
