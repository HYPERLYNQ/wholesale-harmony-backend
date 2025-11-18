// ========================================
// SHOPIFY API ROUTES - WHOLESALE HARMONY
// Customer management, discount codes, and product search
// ========================================

const express = require("express");
const router = express.Router();
const axios = require("axios");

// ========================================
// CONFIGURATION
// ========================================
const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const Settings = require("../settingsModel");

// ========================================
// ✅ HELPER FUNCTIONS
// ========================================

/**
 * Normalize strings to ignore accents and special characters
 * Used for search functionality to match "monoi" with "Monoï"
 */
const normalizeString = (str) => {
  if (!str) return "";
  return str
    .normalize("NFD") // Decompose combined characters
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .toLowerCase()
    .trim();
};

// ========================================
// CUSTOMER ROUTES
// ========================================

/**
 * GET /api/shopify/customers
 * Fetch all customers with their assigned customer types
 */
router.get("/customers", async (req, res) => {
  try {
    console.log("📋 Fetching all customers with types...");

    // Paginate through all customers
    let allCustomers = [];
    let hasMore = true;
    let since_id = null;

    while (hasMore) {
      let url = `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers.json?limit=250`;
      if (since_id) url += `&since_id=${since_id}`;

      const response = await axios.get(url, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      });

      const customers = response.data.customers;
      allCustomers = allCustomers.concat(customers);

      if (customers.length === 250) {
        since_id = customers[customers.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Fetched ${allCustomers.length} total customers`);

    // Load customer types from settings
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerTypes = settings?.customerTypes || [];

    console.log(`✅ Found ${customerTypes.length} customer types`);
    customerTypes.forEach((t) => {
      console.log(`   - ${t.name} (tag: ${t.tag})`);
    });

    // Map customers with their types
    const customersWithTypes = allCustomers.map((customer) => {
      const customerTags = customer.tags
        ? customer.tags.split(", ").map((tag) => tag.trim().toLowerCase())
        : [];

      const assignedType = customerTypes.find((type) => {
        if (!type.tag) return false;
        return customerTags.includes(type.tag.toLowerCase());
      });

      return {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        tags: customer.tags ? customer.tags.split(", ") : [],
        createdAt: customer.created_at,
        orders_count: customer.orders_count,
        total_spent: customer.total_spent,
        last_order_date: customer.last_order_date,
        updated_at: customer.updated_at,
        state: customer.state,
        status: customerTags.includes("pro-pricing")
          ? "approved"
          : customerTags.includes("rejected")
          ? "rejected"
          : customerTags.includes("archived")
          ? "archived"
          : "pending",
        customerType: assignedType
          ? {
              id: assignedType._id.toString(),
              name: assignedType.name,
              tag: assignedType.tag,
              icon: assignedType.icon,
              defaultDiscount: assignedType.defaultDiscount,
            }
          : null,
      };
    });

    res.json({
      success: true,
      customers: customersWithTypes,
      customerTypes: customerTypes.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        tag: t.tag,
        color: t.color || "#a78bfa",
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching customers:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/shopify/customers/assign-type
 * Assign a customer type to a single customer via tags
 */
router.post("/customers/assign-type", async (req, res) => {
  try {
    const { customerId, customerTypeId } = req.body;

    console.log(
      `🏷️ Assigning type ${customerTypeId} to customer ${customerId}`
    );

    // Find the customer type
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerType = settings?.customerTypes?.find(
      (t) => t._id.toString() === customerTypeId
    );

    if (!customerType) {
      return res.status(404).json({ error: "Customer type not found" });
    }

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
    const currentTags = customer.tags
      ? customer.tags.split(", ").filter((t) => t)
      : [];

    // Remove existing customer type tags
    const allCustomerTypes = settings?.customerTypes || [];
    const customerTypeTags = allCustomerTypes
      .map((t) => t.tag)
      .filter((t) => t);
    const nonTypeTags = currentTags.filter(
      (tag) => !customerTypeTags.includes(tag)
    );

    // Add new customer type tag
    const newTags = [...nonTypeTags, customerType.tag];

    // Update customer in Shopify
    await axios.put(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers/${customerId}.json`,
      {
        customer: {
          id: customerId,
          tags: newTags.join(", "),
        },
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Customer ${customerId} tagged with: ${customerType.tag}`);

    res.json({
      success: true,
      customer: {
        id: customerId,
        tags: newTags,
      },
    });
  } catch (error) {
    console.error("❌ Error assigning customer type:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/shopify/customers/bulk-assign
 * Assign a customer type to multiple customers at once
 */
router.post("/customers/bulk-assign", async (req, res) => {
  try {
    const { customerIds, customerTypeId } = req.body;

    console.log(
      `🏷️ Bulk assigning type ${customerTypeId} to ${customerIds.length} customers`
    );

    // Find the customer type
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerType = settings?.customerTypes?.find(
      (t) => t._id.toString() === customerTypeId
    );

    if (!customerType) {
      return res.status(404).json({ error: "Customer type not found" });
    }

    const results = { success: 0, errors: [] };

    // Process each customer
    for (const customerId of customerIds) {
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
        const currentTags = customer.tags
          ? customer.tags.split(", ").filter((t) => t)
          : [];

        // Remove existing customer type tags
        const allCustomerTypes = settings?.customerTypes || [];
        const customerTypeTags = allCustomerTypes
          .map((t) => t.tag)
          .filter((t) => t);
        const nonTypeTags = currentTags.filter(
          (tag) => !customerTypeTags.includes(tag)
        );
        const newTags = [...nonTypeTags, customerType.tag];

        // Update customer
        await axios.put(
          `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers/${customerId}.json`,
          {
            customer: {
              id: customerId,
              tags: newTags.join(", "),
            },
          },
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        results.success++;
      } catch (error) {
        results.errors.push({ customerId, error: error.message });
      }
    }

    console.log(`✅ Bulk assign complete: ${results.success} successful`);

    res.json({
      success: true,
      updated: results.success,
      total: customerIds.length,
      errors: results.errors,
    });
  } catch (error) {
    console.error("❌ Bulk assign error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// DISCOUNT CODE ROUTES
// ========================================

/**
 * POST /api/shopify/customers/generate-code
 * Generate a customer-specific discount code
 */
router.post("/customers/generate-code", async (req, res) => {
  try {
    const {
      customerId,
      customerEmail,
      discountType,
      discountValue,
      expiresAt,
      usageLimit,
    } = req.body;

    console.log(`🎫 Generating code for ${customerEmail}`);

    // Create Price Rule
    const priceRuleData = {
      price_rule: {
        title: `Custom discount for ${customerEmail}`,
        target_type: "line_item",
        target_selection: "all",
        allocation_method: "across",
        value_type: discountType,
        value:
          discountType === "percentage"
            ? `-${discountValue}`
            : `-${discountValue}`,
        customer_selection: "prerequisite",
        prerequisite_customer_ids: [customerId],
        starts_at: new Date().toISOString(),
        ...(expiresAt && { ends_at: new Date(expiresAt).toISOString() }),
        ...(usageLimit && { usage_limit: parseInt(usageLimit) }),
      },
    };

    const priceRuleResponse = await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/price_rules.json`,
      priceRuleData,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const priceRuleId = priceRuleResponse.data.price_rule.id;

    // Create Discount Code
    const code = `CUSTOM-${customerEmail
      .split("@")[0]
      .toUpperCase()}-${Date.now().toString().slice(-6)}`;

    await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/price_rules/${priceRuleId}/discount_codes.json`,
      {
        discount_code: { code },
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Generated code: ${code}`);

    res.json({
      success: true,
      code,
      customerEmail,
    });
  } catch (error) {
    console.error(
      "❌ Error generating code:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/shopify/customers/bulk-generate-codes
 * Generate discount codes for multiple customers at once
 */
router.post("/customers/bulk-generate-codes", async (req, res) => {
  try {
    const { customers, discountType, discountValue, expiresAt, usageLimit } =
      req.body;

    console.log(`🎫 Generating codes for ${customers.length} customers`);

    const results = { success: [], errors: [] };

    for (const customer of customers) {
      try {
        // Create Price Rule
        const priceRuleData = {
          price_rule: {
            title: `Custom discount for ${customer.email}`,
            target_type: "line_item",
            target_selection: "all",
            allocation_method: "across",
            value_type: discountType,
            value:
              discountType === "percentage"
                ? `-${discountValue}`
                : `-${discountValue}`,
            customer_selection: "prerequisite",
            prerequisite_customer_ids: [customer.id],
            starts_at: new Date().toISOString(),
            ...(expiresAt && { ends_at: new Date(expiresAt).toISOString() }),
            ...(usageLimit && { usage_limit: parseInt(usageLimit) }),
          },
        };

        const priceRuleResponse = await axios.post(
          `https://${SHOPIFY_SHOP}/admin/api/2024-10/price_rules.json`,
          priceRuleData,
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        const priceRuleId = priceRuleResponse.data.price_rule.id;

        // Create Discount Code
        const code = `CUSTOM-${customer.email
          .split("@")[0]
          .toUpperCase()}-${Date.now().toString().slice(-6)}`;

        await axios.post(
          `https://${SHOPIFY_SHOP}/admin/api/2024-10/price_rules/${priceRuleId}/discount_codes.json`,
          {
            discount_code: { code },
          },
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        results.success.push({
          customerId: customer.id,
          customerEmail: customer.email,
          code,
        });

        console.log(`✅ Generated code for ${customer.email}: ${code}`);

        // Small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        results.errors.push({
          customerId: customer.id,
          customerEmail: customer.email,
          error: error.message,
        });
      }
    }

    console.log(
      `✅ Bulk generation complete: ${results.success.length}/${customers.length} successful`
    );

    res.json({
      success: true,
      generated: results.success,
      errors: results.errors,
      total: customers.length,
    });
  } catch (error) {
    console.error("❌ Bulk code generation error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/shopify/discount-codes
 * Fetch all custom discount codes
 */
router.get("/discount-codes", async (req, res) => {
  try {
    console.log("📋 Fetching all discount codes...");

    // Fetch all price rules
    let allPriceRules = [];
    let hasMore = true;
    let since_id = null;

    while (hasMore) {
      let url = `https://${SHOPIFY_SHOP}/admin/api/2024-10/price_rules.json?limit=250`;
      if (since_id) url += `&since_id=${since_id}`;

      const response = await axios.get(url, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      });

      const priceRules = response.data.price_rules;
      allPriceRules = allPriceRules.concat(priceRules);

      if (priceRules.length === 250) {
        since_id = priceRules[priceRules.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Fetched ${allPriceRules.length} price rules`);

    // Fetch discount codes for each price rule (only for custom codes)
    const customPriceRules = allPriceRules.filter((pr) =>
      pr.title.includes("Custom discount for")
    );

    const codesWithDetails = [];

    for (const priceRule of customPriceRules) {
      try {
        const codesResponse = await axios.get(
          `https://${SHOPIFY_SHOP}/admin/api/2024-10/price_rules/${priceRule.id}/discount_codes.json`,
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        const codes = codesResponse.data.discount_codes;

        for (const code of codes) {
          // Extract customer email from title
          const emailMatch = priceRule.title.match(/Custom discount for (.+)/);
          const customerEmail = emailMatch ? emailMatch[1] : "Unknown";

          codesWithDetails.push({
            id: code.id,
            code: code.code,
            priceRuleId: priceRule.id,
            customerEmail: customerEmail,
            customerId: priceRule.prerequisite_customer_ids?.[0] || null,
            discountType: priceRule.value_type,
            discountValue: Math.abs(priceRule.value),
            usageCount: code.usage_count,
            usageLimit: priceRule.usage_limit,
            startsAt: priceRule.starts_at,
            endsAt: priceRule.ends_at,
            createdAt: code.created_at,
          });
        }
      } catch (error) {
        console.error(
          `Error fetching codes for price rule ${priceRule.id}:`,
          error.message
        );
      }
    }

    console.log(`✅ Found ${codesWithDetails.length} custom discount codes`);

    res.json({
      success: true,
      codes: codesWithDetails,
    });
  } catch (error) {
    console.error("❌ Error fetching discount codes:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/shopify/discount-codes/:priceRuleId
 * Delete a discount code by deleting its price rule
 */
router.delete("/discount-codes/:priceRuleId", async (req, res) => {
  try {
    const { priceRuleId } = req.params;

    console.log(`🗑️ Deleting price rule ${priceRuleId}`);

    await axios.delete(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/price_rules/${priceRuleId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Deleted price rule ${priceRuleId}`);

    res.json({
      success: true,
      message: "Discount code deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting discount code:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// ✅ PRODUCT SEARCH ROUTE (NEW!)
// Search products with special character normalization
// ========================================

/**
 * GET /api/shopify/products/search
 * Search products by title or SKU with special character support
 * Handles searches like "monoi" matching "Monoï of Tahiti"
 */
router.get("/products/search", async (req, res) => {
  try {
    const { query } = req.query; // Removed shop from query params

    // Validate query
    if (!query || query.length < 2) {
      return res.json({
        success: true,
        products: [],
        message: "Query too short",
      });
    }

    console.log(`🔍 Searching products for: "${query}"`);

    // ✅ ALWAYS use backend's configured shop (where products actually are)
    const shopDomain = SHOPIFY_SHOP;
    const normalizedQuery = normalizeString(query);

    // ✅ Smart search strategy:
    // 1. Use first few chars for broad Shopify search (catches products with special chars)
    // 2. Then filter aggressively client-side with normalization
    const shopifySearchTerm = query.length >= 4 ? query.substring(0, 4) : query;
    console.log(
      `   Shopify query: "${shopifySearchTerm}" | Client filter: "${normalizedQuery}"`
    );

    // GraphQL query to fetch products with variants
    const graphqlQuery = `
      query {
        products(first: 50, query: "title:*${shopifySearchTerm}*") {
          edges {
            node {
              id
              title
              priceRangeV2 {
                minVariantPrice {
                  amount
                }
              }
              featuredImage {
                url
              }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    price
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await axios.post(
      `https://${shopDomain}/admin/api/2024-10/graphql.json`,
      { query: graphqlQuery },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    // Process products
    const products = response.data.data.products.edges.map((edge) => {
      const product = edge.node;
      const productId = product.id.split("/").pop();

      // Get first variant's SKU
      const firstVariant = product.variants.edges[0]?.node;
      const sku = firstVariant?.sku || "";

      return {
        id: productId,
        title: product.title,
        price: parseFloat(product.priceRangeV2.minVariantPrice.amount),
        image: product.featuredImage?.url,
        sku: sku,
        variants: product.variants.edges.map((v) => ({
          id: v.node.id.split("/").pop(),
          title: v.node.title,
          price: parseFloat(v.node.price),
          sku: v.node.sku,
        })),
      };
    });

    // ========================================
    // ✅ NORMALIZE & FILTER RESULTS
    // Shopify's search doesn't handle special characters well,
    // so we filter results here with normalization
    // This allows "monoi" to match "Monoï"
    // ========================================
    const filteredProducts = products.filter((product) => {
      const normalizedTitle = normalizeString(product.title);
      const normalizedSku = normalizeString(product.sku);

      return (
        normalizedTitle.includes(normalizedQuery) ||
        normalizedSku.includes(normalizedQuery)
      );
    });

    console.log(
      `✅ Found ${filteredProducts.length} products matching "${query}"`
    );

    res.json({
      success: true,
      products: filteredProducts,
    });
  } catch (error) {
    console.error("❌ Error searching products:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ========================================
// EXPORT ROUTER
// ========================================
module.exports = router;
