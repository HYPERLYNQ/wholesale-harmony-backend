// ========================================
// PRICING ROUTES - WHOLESALE HARMONY
// Backend API for Product Pricing Management
// ========================================
//
// ✅ FEATURES:
// - Fetching products with pricing data
// - Per-customer-type discounts
// - Per-customer-type MOQ (Minimum Order Quantity)
// - Per-customer-type quantity discount tiers
// - Bulk updates and product resets
// - Theme integration endpoints
// - Shopify Function cart discount calculations
// - Customer-specific pricing with visual hierarchy
// - ✅ NEW: Redis caching for performance optimization
// - ✅ NEW: Retail price storage and calculation
//
// ========================================

const express = require("express");
const router = express.Router();
const axios = require("axios");
const PricingRule = require("../pricingModel");
const Settings = require("../settingsModel");
const CustomerPricing = require("../customerPricingModel");

// ========================================
// CONFIGURATION
// ========================================
const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ========================================
// ✅ REDIS CONFIGURATION & HELPERS
// ========================================

// Redis client setup (shared from main server)
const { Redis } = require("@upstash/redis");

let redisClient;
const REDIS_ENABLED =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

if (REDIS_ENABLED) {
  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log("✅ Redis enabled in pricing routes");
} else {
  console.log("⚠️ Redis not configured - caching disabled for pricing routes");
}

/**
 * Get cached result from Redis
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached data or null
 */
async function getCachedResult(key) {
  if (!REDIS_ENABLED || !redisClient) return null;

  try {
    const cached = await redisClient.get(key);
    if (cached) {
      console.log(`💾 Cache HIT: ${key}`);
      return typeof cached === "string" ? JSON.parse(cached) : cached;
    }
    console.log(`🔍 Cache MISS: ${key}`);
    return null;
  } catch (error) {
    console.error(`⚠️ Redis GET error for ${key}:`, error.message);
    return null;
  }
}

/**
 * Set cached result in Redis
 * @param {string} key - Cache key
 * @param {any} value - Data to cache
 * @param {number} ttlSeconds - Time to live in seconds
 */
async function setCachedResult(key, value, ttlSeconds = 300) {
  if (!REDIS_ENABLED || !redisClient) return;

  try {
    await redisClient.set(key, JSON.stringify(value), { ex: ttlSeconds });
    console.log(`💾 Cached: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error(`⚠️ Redis SET error for ${key}:`, error.message);
  }
}

/**
 * Invalidate customer pricing cache
 * @param {string} customerId - Customer ID
 */
async function invalidateCustomerPricingCache(customerId) {
  if (!REDIS_ENABLED || !redisClient) return;

  try {
    const cacheKey = `customer-pricing:${customerId}`;
    await redisClient.del(cacheKey);
    console.log(`🗑️ Cache invalidated for customer ${customerId}`);
  } catch (error) {
    console.error(
      `⚠️ Cache invalidation error for ${customerId}:`,
      error.message
    );
  }
}

// ========================================
// ✅ HELPER: Get Retail Price from Shopify
// ========================================

/**
 * Fetch retail price for a product/variant from Shopify
 * @param {string} productId - Shopify product ID
 * @param {string|null} variantId - Optional variant ID
 * @returns {Promise<number|null>} Retail price or null
 */
async function getRetailPriceFromShopify(productId, variantId = null) {
  try {
    const productResponse = await axios.get(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/products/${productId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const product = productResponse.data.product;
    const variant = variantId
      ? product.variants.find((v) => v.id == variantId)
      : product.variants[0];

    return parseFloat(variant.price);
  } catch (err) {
    console.error(
      `⚠️ Error fetching retail price for product ${productId}:`,
      err.message
    );
    return null;
  }
}

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
    const { customerId, variantId } = req.query;

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

    // Handle both variant and product responses
    let regularPrice;
    let currencyCode = "USD";

    if (variantId) {
      const variant = productResponse.data.data.productVariant;
      if (!variant) {
        return res.json({ success: false, error: "Variant not found" });
      }
      regularPrice = parseFloat(variant.price);
    } else {
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

    // ---------- LOAD SETTINGS (for customer types) ----------
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerTypes = settings?.customerTypes || [];

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

    // ---------- CALCULATE PRO PRICE (PER-CUSTOMER-TYPE) ----------
    let proPrice;
    let hasOverride = false;

    if (override) {
      hasOverride = true;

      if (override.customerDiscounts && override.customerDiscounts.size > 0) {
        let discountToUse;

        if (customerStatus.isApproved && customerStatus.accountType) {
          discountToUse = override.customerDiscounts.get(
            customerStatus.accountType
          );
        }

        if (!discountToUse) {
          let guestTypeId;

          if (settings?.guestPricingType) {
            const foundType = customerTypes.find(
              (t) =>
                t.tag === settings.guestPricingType ||
                t.id === settings.guestPricingType
            );
            guestTypeId = foundType?.id || customerTypes[0]?.id;
          } else {
            guestTypeId = customerTypes[0]?.id;
          }

          discountToUse = override.customerDiscounts.get(guestTypeId);
        }

        if (discountToUse) {
          proPrice =
            discountToUse.type === "fixed"
              ? discountToUse.value
              : regularPrice * (1 - discountToUse.value / 100);
        } else {
          proPrice = regularPrice;
        }
      } else if (override.value !== undefined) {
        proPrice =
          override.type === "fixed"
            ? override.value
            : regularPrice * (1 - override.value / 100);
      }
    } else {
      if (customerTypes.length > 0) {
        const firstTypeDiscount = customerTypes[0]?.defaultDiscount || 0;
        proPrice = regularPrice * (1 - firstTypeDiscount / 100);
      } else {
        proPrice = regularPrice * (1 - pricingRule.defaultDiscount / 100);
      }
    }

    // ---------- GET QUANTITY TIERS ----------
    let tiers = [];
    if (customerStatus.isApproved && override) {
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
      } else if (override.tiers && override.tiers.length > 0) {
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

    if (!customerId) {
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "Not logged in",
      });
    }

    // Fetch customer data
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

      if (!isApproved) {
        return res.json({
          success: true,
          discount: 0,
          type: "none",
          message: "Customer not approved for wholesale pricing",
        });
      }

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

    // Load pricing rules
    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "No pricing rules configured",
      });
    }

    // Get product override
    const override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );

    // Calculate base discount
    let baseDiscount = 0;
    if (override && override.type === "percentage") {
      baseDiscount = override.value;
    } else {
      baseDiscount = pricingRule.defaultDiscount;
    }

    // Check quantity tiers
    if (override) {
      let tiersToCheck = [];

      if (override.customerTiers && override.customerTiers.size > 0) {
        const typeTiers = override.customerTiers.get(accountType);
        if (typeTiers && typeTiers.length > 0) {
          tiersToCheck = typeTiers;
        }
      } else if (override.tiers && override.tiers.length > 0) {
        tiersToCheck = override.tiers;
      }

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

    // Check minimum order quantity
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
// ✅ CUSTOMER-SPECIFIC PRICING ROUTES
// ========================================

// ========================================
// GET /api/pricing/customer/:customerId
// Fetch customer pricing with visual hierarchy
// ✅ INCLUDES: Redis caching for performance
// ========================================
router.get("/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { shop } = req.query;
    const shopDomain = shop || SHOPIFY_SHOP;

    console.log(`📋 Fetching pricing for customer ${customerId}`);

    // ========================================
    // ✅ CHECK REDIS CACHE FIRST
    // ========================================
    const cacheKey = `customer-pricing:${customerId}`;
    const cachedResult = await getCachedResult(cacheKey);

    if (cachedResult) {
      console.log(`⚡ Returning cached pricing for customer ${customerId}`);
      return res.json(cachedResult);
    }

    // ========================================
    // CACHE MISS - FETCH FROM DATABASE & SHOPIFY
    // ========================================

    // Get or create pricing document
    console.log(
      `🔍 Looking for pricing with customerId: ${customerId}, shop: ${shop}`
    );
    const pricing = await CustomerPricing.getOrCreate(customerId, shop);
    console.log(`📊 Found document with ${pricing.productRules.length} rules`);
    console.log(`📋 Document _id: ${pricing._id}`);
    console.log(`📋 Document customerId: ${pricing.customerId}`);
    console.log(`📋 Document shopDomain: ${pricing.shopDomain}`);

    // Fetch customer from Shopify
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

    // Get customer types from Settings
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerTypes = settings?.customerTypes || [];

    // Find customer's type from tags
    const customerTags = customer.tags
      ? customer.tags.split(", ").map((tag) => tag.trim().toLowerCase())
      : [];

    const assignedType = customerTypes.find((type) =>
      customerTags.includes(type.tag?.toLowerCase())
    );

    // Update pricing document with customer info
    pricing.customerEmail = customer.email;
    pricing.customerType = assignedType?.tag || null;
    pricing.baseDiscount = assignedType?.defaultDiscount || 0;
    await pricing.save();

    // ========================================
    // ✅ ENRICH RULES WITH PRICE BREAKDOWN
    // ========================================
    const enrichedRules = pricing.productRules.map((rule) => {
      const retailPrice = rule.retailPrice || 0;
      const baseDiscount = assignedType?.defaultDiscount || 0;

      // Calculate type base price (retail - base discount)
      const typeBasePrice = retailPrice * (1 - baseDiscount / 100);

      // Calculate final price based on rule type
      let finalPrice;
      if (rule.ruleType === "fixed_price") {
        finalPrice = rule.value;
      } else if (rule.ruleType === "percentage") {
        finalPrice = retailPrice * (1 - rule.value / 100);
      } else if (rule.ruleType === "fixed_amount") {
        finalPrice = Math.max(0, retailPrice - rule.value);
      }

      // Calculate savings
      const savingsAmount = retailPrice - finalPrice;

      return {
        _id: rule._id,
        productId: rule.productId,
        productTitle: rule.productTitle,
        variantId: rule.variantId,
        variantTitle: rule.variantTitle,
        ruleType: rule.ruleType,
        value: rule.value,
        note: rule.note,
        expiresAt: rule.expiresAt,
        createdAt: rule.createdAt,
        // ✅ ADDED: Price breakdown for visual hierarchy
        retailPrice: retailPrice,
        typeBasePrice: typeBasePrice,
        typeProductPrice: null, // For future: type-level product rules
        savingsAmount: savingsAmount > 0 ? savingsAmount : 0,
      };
    });

    // Build response
    const response = {
      success: true,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        type: assignedType?.name || "None",
        typeIcon: assignedType?.icon || "👤",
        baseDiscount: assignedType?.defaultDiscount || 0,
      },
      productRules: enrichedRules,
      tierRules: pricing.tierRules,
      priceLists: pricing.priceLists,
    };

    // ========================================
    // ✅ CACHE THE RESULT (5 minutes)
    // ========================================
    await setCachedResult(cacheKey, response, 300);

    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching customer pricing:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ========================================
// POST /api/pricing/customer/:customerId/product-rule
// Add new product pricing rule
// ✅ INCLUDES: Retail price fetching & cache invalidation
// ========================================
router.post("/customer/:customerId/product-rule", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { shop } = req.query;
    // ✅ DEBUG: Log shop parameter
    console.log(`💾 POST: shop from query = ${shop}`);
    console.log(`💾 POST: SHOPIFY_SHOP env = ${SHOPIFY_SHOP}`);
    console.log(`💾 POST: Will save to = ${shop || SHOPIFY_SHOP}`);
    const {
      productId,
      productTitle,
      productHandle,
      variantId,
      variantTitle,
      ruleType,
      value,
      originalPrice,
      note,
      expiresAt,
      updatedBy,
    } = req.body;

    console.log(`➕ Adding product rule for customer ${customerId}`);

    // Validation
    if (!["percentage", "fixed_amount", "fixed_price"].includes(ruleType)) {
      return res.status(400).json({ error: "Invalid rule type" });
    }

    if (!value || value <= 0) {
      return res.status(400).json({ error: "Invalid value" });
    }

    if (ruleType === "percentage" && value > 100) {
      return res.status(400).json({ error: "Percentage cannot exceed 100%" });
    }

    // ========================================
    // ✅ FETCH RETAIL PRICE FROM SHOPIFY
    // ========================================
    let retailPrice = 0;
    try {
      retailPrice = await getRetailPriceFromShopify(productId, variantId);
      if (retailPrice) {
        console.log(`📊 Retail price for ${productTitle}: $${retailPrice}`);
      }
    } catch (priceErr) {
      console.error("⚠️ Could not fetch retail price:", priceErr.message);
      // Continue anyway - retailPrice will be 0
    }

    const pricing = await CustomerPricing.getOrCreate(
      customerId,
      shop || SHOPIFY_SHOP
    );

    const ruleData = {
      productId,
      productTitle,
      productHandle,
      variantId: variantId || null,
      variantTitle: variantTitle || null,
      ruleType,
      value: parseFloat(value),
      originalPrice: originalPrice ? parseFloat(originalPrice) : null,
      retailPrice, // ✅ STORE RETAIL PRICE
      note: note || "",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdAt: new Date(),
      updatedBy: updatedBy || "admin",
    };

    console.log("💾 About to save rule:", JSON.stringify(ruleData, null, 2));
    const savedPricing = await pricing.addProductRule(ruleData);
    console.log("📊 Rule count after save:", savedPricing.productRules.length);
    console.log(
      "📋 Saved rules:",
      JSON.stringify(savedPricing.productRules, null, 2)
    );

    // ========================================
    // ✅ INVALIDATE CACHE
    // ========================================
    await invalidateCustomerPricingCache(customerId);

    console.log(`✅ Product rule added for customer ${customerId}`);

    res.json({
      success: true,
      message: "Product rule added successfully",
      rule: ruleData,
    });
  } catch (error) {
    console.error("❌ Error adding product rule:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// PUT /api/pricing/customer/:customerId/product-rule/:ruleId
// Update existing product pricing rule
// ✅ INCLUDES: Retail price refresh & cache invalidation
// ========================================
router.put("/customer/:customerId/product-rule/:ruleId", async (req, res) => {
  try {
    const { customerId, ruleId } = req.params;
    const { shop } = req.query;
    const updates = req.body;

    console.log(
      `✏️ Updating product rule ${ruleId} for customer ${customerId}`
    );

    const pricing = await CustomerPricing.findOne({
      customerId,
      shopDomain: shop || SHOPIFY_SHOP,
    });

    if (!pricing) {
      return res.status(404).json({ error: "Customer pricing not found" });
    }

    // Validation
    if (updates.ruleType) {
      if (
        !["percentage", "fixed_amount", "fixed_price"].includes(
          updates.ruleType
        )
      ) {
        return res.status(400).json({ error: "Invalid rule type" });
      }
    }

    if (updates.value !== undefined) {
      if (updates.value <= 0) {
        return res.status(400).json({ error: "Invalid value" });
      }
    }

    // ========================================
    // ✅ REFRESH RETAIL PRICE FROM SHOPIFY
    // ========================================
    const rule = pricing.productRules.id(ruleId);
    if (rule) {
      try {
        const freshRetailPrice = await getRetailPriceFromShopify(
          rule.productId,
          rule.variantId
        );
        if (freshRetailPrice !== null) {
          updates.retailPrice = freshRetailPrice;
          console.log(
            `📊 Updated retail price for ${rule.productTitle}: $${freshRetailPrice}`
          );
        }
      } catch (priceErr) {
        console.error("⚠️ Could not refresh retail price:", priceErr.message);
        // Keep existing retailPrice
      }
    }

    await pricing.updateProductRule(ruleId, updates);

    // ========================================
    // ✅ INVALIDATE CACHE
    // ========================================
    await invalidateCustomerPricingCache(customerId);

    console.log(`✅ Product rule updated for customer ${customerId}`);

    res.json({
      success: true,
      message: "Product rule updated successfully",
    });
  } catch (error) {
    console.error("❌ Error updating product rule:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// DELETE /api/pricing/customer/:customerId/product-rule/:ruleId
// Delete product pricing rule
// ✅ INCLUDES: Cache invalidation
// ========================================
router.delete(
  "/customer/:customerId/product-rule/:ruleId",
  async (req, res) => {
    try {
      const { customerId, ruleId } = req.params;
      const { shop } = req.query;

      console.log(
        `🗑️ Deleting product rule ${ruleId} for customer ${customerId}`
      );

      const pricing = await CustomerPricing.findOne({
        customerId,
        shopDomain: shop || SHOPIFY_SHOP,
      });

      if (!pricing) {
        return res.status(404).json({ error: "Customer pricing not found" });
      }

      await pricing.removeProductRule(ruleId);

      // ========================================
      // ✅ INVALIDATE CACHE
      // ========================================
      await invalidateCustomerPricingCache(customerId);

      console.log(`✅ Product rule deleted for customer ${customerId}`);

      res.json({
        success: true,
        message: "Product rule deleted successfully",
      });
    } catch (error) {
      console.error("❌ Error deleting product rule:", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

// ========================================
// POST /api/pricing/customer/:customerId/tier-rule
// Add tier pricing rule
// ========================================
router.post("/customer/:customerId/tier-rule", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { shop } = req.query;
    const { appliesTo, productId, productTitle, tiers, updatedBy } = req.body;

    console.log(`➕ Adding tier rule for customer ${customerId}`);

    if (!tiers || !Array.isArray(tiers) || tiers.length === 0) {
      return res.status(400).json({ error: "Invalid tiers data" });
    }

    for (const tier of tiers) {
      if (!tier.quantity || tier.quantity <= 0) {
        return res.status(400).json({ error: "Invalid tier quantity" });
      }
      if (!tier.discount || tier.discount <= 0) {
        return res.status(400).json({ error: "Invalid tier discount" });
      }
      if (
        tier.discountType === "percentage" &&
        (tier.discount > 100 || tier.discount < 0)
      ) {
        return res
          .status(400)
          .json({ error: "Percentage must be between 0-100" });
      }
    }

    const pricing = await CustomerPricing.getOrCreate(
      customerId,
      shop || SHOPIFY_SHOP
    );

    const tierData = {
      appliesTo: appliesTo || "all_products",
      productId: appliesTo === "specific_product" ? productId : null,
      productTitle: appliesTo === "specific_product" ? productTitle : null,
      tiers: tiers.map((tier) => ({
        quantity: parseInt(tier.quantity),
        discount: parseFloat(tier.discount),
        discountType: tier.discountType || "percentage",
      })),
      createdAt: new Date(),
      updatedBy: updatedBy || "admin",
    };

    await pricing.addTierRule(tierData);

    console.log(`✅ Tier rule added for customer ${customerId}`);

    res.json({
      success: true,
      message: "Tier rule added successfully",
      rule: tierData,
    });
  } catch (error) {
    console.error("❌ Error adding tier rule:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// DELETE /api/pricing/customer/:customerId/tier-rule/:ruleId
// Delete tier pricing rule
// ========================================
router.delete("/customer/:customerId/tier-rule/:ruleId", async (req, res) => {
  try {
    const { customerId, ruleId } = req.params;
    const { shop } = req.query;

    console.log(`🗑️ Deleting tier rule ${ruleId} for customer ${customerId}`);

    const pricing = await CustomerPricing.findOne({
      customerId,
      shopDomain: shop || SHOPIFY_SHOP,
    });

    if (!pricing) {
      return res.status(404).json({ error: "Customer pricing not found" });
    }

    await pricing.removeTierRule(ruleId);

    console.log(`✅ Tier rule deleted for customer ${customerId}`);

    res.json({
      success: true,
      message: "Tier rule deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting tier rule:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// POST /api/pricing/customer/:customerId/calculate
// Calculate effective price for a product
// ========================================
router.post("/customer/:customerId/calculate", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { shop } = req.query;
    const { productId, variantId, regularPrice, quantity } = req.body;

    console.log(`🧮 Calculating price for customer ${customerId}`);

    const pricing = await CustomerPricing.findOne({
      customerId,
      shopDomain: shop || SHOPIFY_SHOP,
    });

    if (!pricing) {
      return res.json({
        success: true,
        finalPrice: regularPrice,
        appliedRule: null,
        message: "No custom pricing rules found",
      });
    }

    const result = pricing.calculatePrice(
      productId,
      variantId || null,
      parseFloat(regularPrice),
      parseInt(quantity) || 1
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("❌ Error calculating price:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// EXPORT ROUTER
// ========================================
module.exports = router;
