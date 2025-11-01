// routes/pricing.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const PricingRule = require("../pricingModel");

const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Get products with pricing data
router.get("/products", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      productType = "",
      vendor = "",
    } = req.query;
    const shopDomain = process.env.SHOPIFY_SHOP_NAME + ".myshopify.com";

    console.log("📊 Fetching products for pricing...");

    // Get pricing rules from MongoDB
    let pricingRule = await PricingRule.findOne({ shopDomain });
    if (!pricingRule) {
      pricingRule = await PricingRule.create({
        shopDomain,
        defaultDiscount: 0,
        productOverrides: [],
      });
    }

    // Fetch products from Shopify with filters
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
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    const productsResponse = await axios.post(
      `https://${shopDomain}/admin/api/2024-10/graphql.json`,
      { query: productsQuery },
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
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

      // Find override in MongoDB
      const override = pricingRule.productOverrides.find(
        (p) => p.productId === productId
      );

      let proPrice;
      if (override) {
        proPrice =
          override.type === "fixed"
            ? override.value
            : regularPrice * (1 - override.value / 100);
      } else {
        proPrice = regularPrice * (1 - pricingRule.defaultDiscount / 100);
      }

      return {
        id: productId,
        title: product.title,
        regularPrice,
        proPrice,
        productType: product.productType || "Uncategorized",
        vendor: product.vendor || "Unknown",
        image: product.featuredImage?.url,
        override: override || null,
        moq: override?.moq || { student: null, esthetician: null, salon: null },
      };
    });

    // Apply frontend filters
    let filtered = products;
    if (productType) {
      filtered = filtered.filter((p) => p.productType === productType);
    }
    if (vendor) {
      filtered = filtered.filter((p) => p.vendor === vendor);
    }

    res.json({
      success: true,
      products: filtered,
      defaultDiscount: pricingRule.defaultDiscount,
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

// Update default discount
router.put("/default", async (req, res) => {
  try {
    const { discount } = req.body;
    const shopDomain = process.env.SHOPIFY_SHOP_NAME + ".myshopify.com";

    const pricingRule = await PricingRule.findOneAndUpdate(
      { shopDomain },
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

// Bulk update product pricing
router.post("/bulk-update", async (req, res) => {
  try {
    const { products } = req.body;
    const shopDomain = process.env.SHOPIFY_SHOP_NAME + ".myshopify.com";

    let pricingRule = await PricingRule.findOne({ shopDomain });
    if (!pricingRule) {
      pricingRule = new PricingRule({ shopDomain, productOverrides: [] });
    }

    products.forEach((update) => {
      const existingIndex = pricingRule.productOverrides.findIndex(
        (p) => p.productId === update.productId
      );

      if (existingIndex >= 0) {
        pricingRule.productOverrides[existingIndex] = {
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

// Reset product pricing
router.post("/reset", async (req, res) => {
  try {
    const { productIds } = req.body;
    const shopDomain = process.env.SHOPIFY_SHOP_NAME + ".myshopify.com";

    const pricingRule = await PricingRule.findOne({ shopDomain });
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

// Get product pricing for theme (NEW ENDPOINT)
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { customerId } = req.query;
    const shopDomain = process.env.SHOPIFY_SHOP_NAME + ".myshopify.com";

    console.log(
      `🏷️ Fetching pricing for product ${productId}, customer ${
        customerId || "guest"
      }`
    );

    const pricingRule = await PricingRule.findOne({ shopDomain });
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
      `https://${shopDomain}/admin/api/2024-10/graphql.json`,
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
          `https://${shopDomain}/admin/api/2024-10/customers/${customerId}.json`,
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

        if (override && override.moq) {
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

// Get cart discount for Shopify Function (NEW)
router.get("/cart-discount", async (req, res) => {
  try {
    const { customerId, productId, quantity = 1 } = req.query;
    const shopDomain = process.env.SHOPIFY_SHOP_NAME + ".myshopify.com";

    console.log(
      `🛒 Cart discount check: Product ${productId}, Customer ${
        customerId || "guest"
      }, Qty ${quantity}`
    );

    // Default: no discount
    let discountPercent = 0;
    let discountType = "none";
    let accountType = "consumer";

    // Step 1: Check customer status
    if (!customerId) {
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "Not logged in",
      });
    }

    // Fetch customer from Shopify

    // Fetch customer from Shopify using GraphQL
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
        `https://${shopDomain}/admin/api/2024-10/graphql.json`,
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

      // Check if approved
      const isApproved = customerTags.includes("pro-pricing");
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

    // Step 2: Get pricing rules
    const pricingRule = await PricingRule.findOne({ shopDomain });
    if (!pricingRule) {
      return res.json({
        success: true,
        discount: 0,
        type: "none",
        message: "No pricing rules configured",
      });
    }

    // Step 3: Check for product override
    const override = pricingRule.productOverrides.find(
      (p) => p.productId === productId
    );

    // Step 4: Calculate discount based on quantity and tiers
    // Tiers are ADDITIONAL % off the pro price, not total discount

    // Get base discount first
    let baseDiscount = 0;
    if (override && override.type === "percentage") {
      baseDiscount = override.value;
    } else {
      baseDiscount = pricingRule.defaultDiscount;
    }

    if (override && override.tiers && override.tiers.length > 0) {
      // Find applicable tier based on quantity
      const sortedTiers = override.tiers
        .filter((tier) => parseInt(quantity) >= tier.qty)
        .sort((a, b) => b.qty - a.qty);

      if (sortedTiers.length > 0) {
        // Tier discount is ADDITIONAL % off the pro price
        // Example: Base 27% off regular = $21.17
        //          Then tier 10% off $21.17 = $19.05
        //          Total discount from regular: 34.3%
        const additionalDiscount = sortedTiers[0].discount;

        // Calculate combined discount
        const combinedMultiplier =
          (1 - baseDiscount / 100) * (1 - additionalDiscount / 100);
        discountPercent = (1 - combinedMultiplier) * 100;

        discountType = "tier";
      } else {
        // Below all tiers, use base discount only
        discountPercent = baseDiscount;
        discountType = "base";
      }
    } else if (override) {
      // Product override without tiers
      discountPercent = baseDiscount;
      discountType = "override";
    } else {
      // Default discount
      discountPercent = pricingRule.defaultDiscount;
      discountType = "default";
    }

    // Step 5: Check MOQ
    let meetsMinimum = true;
    if (override && override.moq && override.moq[accountType]) {
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
