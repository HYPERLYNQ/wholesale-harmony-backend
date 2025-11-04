// ========================================
// PRICING ROUTES - WHOLESALE HARMONY
// Per-customer-type default discounts
// ========================================

const express = require("express");
const router = express.Router();
const axios = require("axios");
const PricingRule = require("../pricingModel");
const Settings = require("../settingsModel");

const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ========================================
// GET PRODUCTS WITH PRICING
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

    // Get pricing rules
    let pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      pricingRule = await PricingRule.create({
        shopDomain: SHOPIFY_SHOP,
        defaultDiscount: 0,
        productOverrides: [],
      });
    }

    // ⭐ Fetch customer types from Settings
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerTypes = settings?.customerTypes || [];

    console.log(
      `✅ Loaded ${customerTypes.length} customer types from Settings`
    );
    customerTypes.forEach((type) => {
      console.log(`   ${type.icon} ${type.name}: ${type.defaultDiscount}%`);
    });

    // Fetch products from Shopify
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

      // ⭐ Calculate appliedDiscounts per customer type
      let appliedDiscounts = {};

      if (override && override.value !== undefined) {
        // Product has override - check if it matches customer type default
        customerTypes.forEach((type) => {
          const typeDefault = type.defaultDiscount || 0;
          const overrideValue = override.value;

          // If override matches the customer type's default, treat as default
          const isActuallyCustom =
            (override.type === "percentage" && overrideValue !== typeDefault) ||
            override.type === "fixed";

          appliedDiscounts[type.id] = {
            value: override.value,
            type: override.type || "percentage",
            isCustom: isActuallyCustom,
          };
        });
      } else if (override && override.customerDiscounts) {
        // NEW: Per-customer-type discounts
        customerTypes.forEach((type) => {
          const typeDiscount = override.customerDiscounts[type.id];
          if (typeDiscount) {
            appliedDiscounts[type.id] = {
              value: typeDiscount.value,
              type: typeDiscount.type || "percentage",
              isCustom: true,
            };
          } else {
            // Use customer type's default
            appliedDiscounts[type.id] = {
              value: type.defaultDiscount || 0,
              type: "percentage",
              isCustom: false,
            };
          }
        });
      } else {
        // No override - use each customer type's default from Settings
        customerTypes.forEach((type) => {
          appliedDiscounts[type.id] = {
            value: type.defaultDiscount || 0,
            type: "percentage",
            isCustom: false,
          };
        });
      }

      // Calculate main proPrice (use first customer type's discount)
      let proPrice;
      if (override && override.customerDiscounts) {
        // Per-type discounts: use first type's discount
        const firstType = customerTypes[0];
        const firstTypeDiscount = override.customerDiscounts[firstType.id];
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
        // Global discount
        proPrice =
          override.type === "fixed"
            ? override.value
            : regularPrice * (1 - override.value / 100);
      } else {
        // No override: use first customer type's default
        const firstTypeDiscount = customerTypes[0]?.defaultDiscount || 0;
        proPrice = regularPrice * (1 - firstTypeDiscount / 100);
      }

      // ⭐ Build MOQ object with default/custom distinction
      const moqData = {};
      customerTypes.forEach((type) => {
        let moqValue = null;
        let isDefault = true;

        // Check product-specific override
        if (override?.customerMOQ && override.customerMOQ.has(type.id)) {
          moqValue = override.customerMOQ.get(type.id);
          isDefault = false;
        } else if (override?.moq && override.moq[type.id] !== undefined) {
          moqValue = override.moq[type.id];
          isDefault = false;
        } else {
          // Use default from Settings
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

      // Extract SKU from first variant
      const sku = product.variants?.edges[0]?.node?.sku || null;

      return {
        id: productId,
        title: product.title,
        sku, // ⭐ Product SKU
        regularPrice,
        proPrice,
        appliedDiscounts, // ⭐ Per customer type discounts
        productType: product.productType || "Uncategorized",
        vendor: product.vendor || "Unknown",
        image: product.featuredImage?.url,
        override: override || null,
        moq: moqData, // ⭐ Per customer type MOQ with default/custom flag
      };
    });

    // Apply filters
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

    res.json({
      success: true,
      products: filtered,
      defaultDiscount: pricingRule.defaultDiscount, // Legacy
      customerTypes, // ⭐ Include customer types array
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
// UPDATE DEFAULT DISCOUNT (LEGACY)
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
// BULK UPDATE PRODUCTS
// ========================================
router.post("/bulk-update", async (req, res) => {
  try {
    const { products } = req.body;

    let pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      pricingRule = new PricingRule({
        shopDomain: SHOPIFY_SHOP,
        productOverrides: [],
      });
    }

    products.forEach((update) => {
      const existingIndex = pricingRule.productOverrides.findIndex(
        (p) => p.productId === update.productId
      );

      // Convert typeDiscounts to customerDiscounts if present
      if (update.typeDiscounts) {
        update.customerDiscounts = update.typeDiscounts;
        delete update.typeDiscounts;
        // Remove old value/type since we're using per-type now
        delete update.value;
        delete update.type;
      }

      // Convert moq object to Map for customerMOQ
      if (update.moq && typeof update.moq === "object") {
        const moqMap = new Map();
        Object.entries(update.moq).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            moqMap.set(key, value);
          }
        });
        update.customerMOQ = moqMap;
      }

      if (existingIndex >= 0) {
        pricingRule.productOverrides[existingIndex] = {
          ...pricingRule.productOverrides[existingIndex],
          ...update,
          updatedAt: new Date(),
        };
      } else {
        pricingRule.productOverrides.push({
          ...update,
          updatedAt: new Date(),
        });
      }
    });

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
// RESET PRODUCTS TO DEFAULT
// ========================================
router.post("/reset", async (req, res) => {
  try {
    const { productIds } = req.body;

    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({ success: true, removed: 0 });
    }

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
// GET SINGLE PRODUCT PRICING (Theme)
// ========================================
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { customerId } = req.query;

    console.log(
      `🏷️ Fetching pricing for product ${productId}, customer ${
        customerId || "guest"
      }`
    );

    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({
        success: false,
        error: "No pricing configuration found",
      });
    }

    const productQuery = `
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

    const product = productResponse.data.data.product;
    if (!product) {
      return res.json({ success: false, error: "Product not found" });
    }

    const regularPrice = parseFloat(
      product.priceRangeV2.minVariantPrice.amount
    );
    const currencyCode = product.priceRangeV2.minVariantPrice.currencyCode;

    const override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );

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

        if (tags.includes("student")) customerStatus.accountType = "student";
        else if (tags.includes("esthetician"))
          customerStatus.accountType = "esthetician";
        else if (tags.includes("salon")) customerStatus.accountType = "salon";
        else customerStatus.accountType = "consumer";

        // Check dynamic MOQ
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

    let tiers = [];
    if (
      customerStatus.isApproved &&
      override &&
      override.tiers &&
      override.tiers.length > 0
    ) {
      tiers = override.tiers
        .map((tier) => ({
          qty: tier.qty,
          discount: tier.discount,
          price: regularPrice * (1 - tier.discount / 100),
          savings: tier.discount,
        }))
        .sort((a, b) => a.qty - b.qty);
    }

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
// GET CART DISCOUNT (Shopify Function)
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

    const pricingRule = await PricingRule.findOne({ shopDomain: SHOPIFY_SHOP });
    if (!pricingRule) {
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "No pricing rules configured",
      });
    }

    const override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );

    let baseDiscount = 0;
    if (override && override.type === "percentage") {
      baseDiscount = override.value;
    } else {
      baseDiscount = pricingRule.defaultDiscount;
    }

    if (override && override.tiers && override.tiers.length > 0) {
      const sortedTiers = override.tiers
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
    } else if (override) {
      discountPercent = baseDiscount;
      discountType = "override";
    } else {
      discountPercent = pricingRule.defaultDiscount;
      discountType = "default";
    }

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

module.exports = router;
