const express = require("express");
const router = express.Router();
const axios = require("axios");

const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const Settings = require("../settingsModel");

// GET /api/shopify/customers
router.get("/customers", async (req, res) => {
  try {
    console.log("📋 Fetching all customers with types...");

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

    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerTypes = settings?.customerTypes || [];

    console.log(`✅ Found ${customerTypes.length} customer types`);
    customerTypes.forEach((t) => {
      console.log(`   - ${t.name} (tag: ${t.tag})`);
    });

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
        numberOfOrders: customer.orders_count,
        amountSpent: customer.total_spent,
        customerType: assignedType
          ? {
              id: assignedType._id.toString(),
              name: assignedType.name,
              tag: assignedType.tag,
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
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching customers:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/shopify/customers/assign-type
router.post("/customers/assign-type", async (req, res) => {
  try {
    const { customerId, customerTypeId } = req.body;

    console.log(
      `🏷️ Assigning type ${customerTypeId} to customer ${customerId}`
    );

    const settings = await Settings.findOne({ shopDomain: SHOPIFY_SHOP });
    const customerType = settings?.customerTypes?.find(
      (t) => t._id.toString() === customerTypeId
    );

    if (!customerType) {
      return res.status(404).json({ error: "Customer type not found" });
    }

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

    const allCustomerTypes = settings?.customerTypes || [];
    const customerTypeTags = allCustomerTypes
      .map((t) => t.tag)
      .filter((t) => t);
    const nonTypeTags = currentTags.filter(
      (tag) => !customerTypeTags.includes(tag)
    );

    const newTags = [...nonTypeTags, customerType.tag];

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

// POST /api/shopify/customers/bulk-assign
router.post("/customers/bulk-assign", async (req, res) => {
  try {
    const { customerIds, customerTypeId } = req.body;

    console.log(
      `🏷️ Bulk assigning type ${customerTypeId} to ${customerIds.length} customers`
    );

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

        const allCustomerTypes = settings?.customerTypes || [];
        const customerTypeTags = allCustomerTypes
          .map((t) => t.tag)
          .filter((t) => t);
        const nonTypeTags = currentTags.filter(
          (tag) => !customerTypeTags.includes(tag)
        );
        const newTags = [...nonTypeTags, customerType.tag];

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
