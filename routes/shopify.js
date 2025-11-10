const express = require("express");
const router = express.Router();
const axios = require("axios");

const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Import Settings model
const Settings = require("../settingsModel");

// GET /api/shopify/customers - Fetch all customers with their assigned types
router.get("/customers", async (req, res) => {
  try {
    console.log("📋 Fetching all customers with types...");

    // Fetch ALL customers from Shopify (using pagination)
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

    // Get all customer types from Settings - WITH SHOP DOMAIN
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerTypes = settings?.customerTypes || [];

    console.log(`✅ Found ${customerTypes.length} customer types`);
    customerTypes.forEach((t) =>
      console.log(`   - ${t.typeName} (tag: ${t.tagName})`)
    );

    // Match customers with their assigned types based on tags
    const customersWithTypes = allCustomers.map((customer) => {
      // Handle null tags and make case-insensitive
      const customerTags = customer.tags
        ? customer.tags.split(", ").map((tag) => tag.toLowerCase())
        : [];

      // Find which customer type tag this customer has (case-insensitive)
      const assignedType = customerTypes.find((type) =>
        customerTags.includes(type.tagName.toLowerCase())
      );

      return {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        tags: customer.tags ? customer.tags.split(", ") : [],
        createdAt: customer.created_at,
        numberOfOrders: customer.orders_count,
        amountSpent: customer.total_spent,
        customerType: assignedType
          ? {
              id: assignedType._id.toString(),
              name: assignedType.typeName,
              tag: assignedType.tagName,
            }
          : null,
      };
    });

    res.json({
      success: true,
      customers: customersWithTypes,
      customerTypes: customerTypes.map((t) => ({
        id: t._id.toString(),
        name: t.typeName,
        tag: t.tagName,
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching customers:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/shopify/customers/assign-type - Assign customer type to a customer
router.post("/customers/assign-type", async (req, res) => {
  try {
    const { customerId, customerTypeId } = req.body;

    console.log(
      `🏷️ Assigning type ${customerTypeId} to customer ${customerId}`
    );

    // Get customer type from Settings - WITH SHOP DOMAIN
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerType = settings?.customerTypes?.find(
      (t) => t._id.toString() === customerTypeId
    );

    if (!customerType) {
      return res.status(404).json({ error: "Customer type not found" });
    }

    // Get current customer from Shopify
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

    // Remove all existing customer type tags
    const allCustomerTypes = settings?.customerTypes || [];
    const customerTypeTags = allCustomerTypes.map((t) => t.tagName);
    const nonTypeTags = currentTags.filter(
      (tag) => !customerTypeTags.includes(tag)
    );

    // Add new customer type tag
    const newTags = [...nonTypeTags, customerType.tagName];

    // Update customer tags in Shopify
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

    console.log(
      `✅ Customer ${customerId} tagged with: ${customerType.tagName}`
    );

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

// POST /api/shopify/customers/bulk-assign - Bulk assign customer types
router.post("/customers/bulk-assign", async (req, res) => {
  try {
    const { customerIds, customerTypeId } = req.body;

    console.log(
      `🏷️ Bulk assigning type ${customerTypeId} to ${customerIds.length} customers`
    );

    // Get customer type from Settings - WITH SHOP DOMAIN
    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerType = settings?.customerTypes?.find(
      (t) => t._id.toString() === customerTypeId
    );

    if (!customerType) {
      return res.status(404).json({ error: "Customer type not found" });
    }

    const results = { success: 0, errors: [] };

    for (const customerId of customerIds) {
      try {
        // Get current customer
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

        // Remove existing type tags, add new one
        const allCustomerTypes = settings?.customerTypes || [];
        const customerTypeTags = allCustomerTypes.map((t) => t.tagName);
        const nonTypeTags = currentTags.filter(
          (tag) => !customerTypeTags.includes(tag)
        );
        const newTags = [...nonTypeTags, customerType.tagName];

        // Update tags
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

module.exports = router;
