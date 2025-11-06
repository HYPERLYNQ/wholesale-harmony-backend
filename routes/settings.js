/* ========================================
   SETTINGS API ROUTES
   Handles customer type configuration and form builder settings
   WITH ADDRESS BUNDLE SUPPORT
   ======================================== */

const express = require("express");
const router = express.Router();
const Settings = require("../settingsModel");

/* ========================================
   GET SETTINGS
   Returns current settings or creates defaults
   ======================================== */
router.get("/", async (req, res) => {
  try {
    const shop =
      req.query.shop || `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;

    let settings = await Settings.findOne({ shopDomain: shop });

    // Create default settings if none exist
    if (!settings) {
      console.log(`📝 No settings found for ${shop}, creating defaults...`);
      settings = await Settings.create({
        shopDomain: shop,
        customerTypes: [],
      });
    }

    res.json({
      success: true,
      settings: settings,
    });
  } catch (error) {
    console.error("❌ Get settings error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* ========================================
   UPDATE SETTINGS
   Saves customer types with form structure
   ======================================== */
router.put("/", async (req, res) => {
  try {
    const { customerTypes, shop } = req.body;
    const shopDomain = shop || `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;

    let settings = await Settings.findOne({ shopDomain });

    if (!settings) {
      console.log(`📝 Creating new settings for ${shopDomain}...`);
      settings = await Settings.create({
        shopDomain,
        customerTypes,
      });
    } else {
      console.log(
        `📝 Updating settings for ${shopDomain} with ${customerTypes.length} customer types...`
      );
      settings.customerTypes = customerTypes;
      settings.updatedAt = Date.now();
      await settings.save();
    }

    res.json({
      success: true,
      settings: settings,
    });
  } catch (error) {
    console.error("❌ Update settings error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* ========================================
   GET FIELD LIBRARY - WITH ADDRESS BUNDLES
   Returns all available preset fields for form builder
   ======================================== */
router.get("/field-library", (req, res) => {
  try {
    const fieldLibrary = {
      /* ===== CONTACT FIELDS ===== */
      contactFields: [
        /* ===== ADDRESS BUNDLE - Home Address ===== */
        {
          id: "address-bundle-home",
          type: "bundle",
          bundleType: "address",
          label: "Address (Home)",
          baseId: "home",
          category: "Contact",
          required: false,
          locked: false,
          icon: "🏠",
          helpText:
            "Complete home address with Google Places - creates 5 fields",
          bundleFields: [
            {
              suffix: "Address",
              type: "text",
              label: "Street Address",
              placeholder: "123 Main Street",
              required: true,
              icon: "📍",
            },
            {
              suffix: "City",
              type: "text",
              label: "City",
              placeholder: "City",
              required: true,
              icon: "🏙️",
            },
            {
              suffix: "State",
              type: "text",
              label: "State",
              placeholder: "State",
              required: true,
              icon: "📍",
            },
            {
              suffix: "Zip",
              type: "text",
              label: "ZIP Code",
              placeholder: "ZIP Code",
              required: true,
              icon: "📮",
            },
            {
              suffix: "Country",
              type: "text",
              label: "Country",
              placeholder: "United States",
              required: true,
              icon: "🌍",
            },
          ],
        },
        {
          id: "firstName",
          type: "text",
          label: "First Name",
          placeholder: "Enter first name",
          category: "Contact",
          required: true,
          locked: false,
          icon: "👤",
          helpText: "",
        },
        {
          id: "lastName",
          type: "text",
          label: "Last Name",
          placeholder: "Enter last name",
          category: "Contact",
          required: true,
          locked: false,
          icon: "👤",
          helpText: "",
        },
        {
          id: "email",
          type: "email",
          label: "Email Address",
          placeholder: "email@example.com",
          category: "Contact",
          required: true,
          locked: true, // Can't be removed - required for Shopify
          icon: "📧",
          helpText: "Required for account creation",
        },
        {
          id: "phone",
          type: "tel",
          label: "Phone Number",
          placeholder: "Enter phone number",
          category: "Contact",
          required: true,
          locked: false,
          icon: "📱",
          helpText: "International phone number with country code",
        },

        {
          id: "apartment",
          type: "text",
          label: "Apartment / Unit",
          placeholder: "Apt 4B",
          category: "Contact",
          required: false,
          locked: false,
          icon: "🚪",
          helpText: "Apartment, suite, or unit number (optional)",
        },
        /* ===== SOCIAL MEDIA FIELDS ===== */
        {
          id: "instagram",
          type: "text",
          label: "Instagram",
          placeholder: "@username",
          category: "Contact",
          required: false,
          locked: false,
          icon: "📸",
          helpText: "Optional social media handle",
        },
        {
          id: "tiktok",
          type: "text",
          label: "TikTok",
          placeholder: "@username",
          category: "Contact",
          required: false,
          locked: false,
          icon: "🎵",
          helpText: "Optional social media handle",
        },
      ],

      /* ===== BUSINESS FIELDS ===== */
      businessFields: [
        /* ===== ADDRESS BUNDLE - Business Address ===== */
        {
          id: "address-bundle-business",
          type: "bundle",
          bundleType: "address",
          label: "Address (Business)",
          baseId: "business",
          category: "Business",
          required: false,
          locked: false,
          icon: "🏢",
          helpText:
            "Complete business address with Google Places - creates 5 fields",
          bundleFields: [
            {
              suffix: "Address",
              type: "address",
              label: "Business Address",
              placeholder: "123 Business St",
              required: true,
              icon: "📍",
            },
            {
              suffix: "City",
              type: "text",
              label: "City",
              placeholder: "City",
              required: true,
              icon: "🏙️",
            },
            {
              suffix: "State",
              type: "text",
              label: "State",
              placeholder: "State",
              required: true,
              icon: "📍",
            },
            {
              suffix: "Zip",
              type: "text",
              label: "ZIP Code",
              placeholder: "ZIP Code",
              required: true,
              icon: "📮",
            },
            {
              suffix: "Country",
              type: "text",
              label: "Country",
              placeholder: "United States",
              required: true,
              icon: "🌎",
            },
          ],
        },
        {
          id: "businessName",
          type: "text",
          label: "Business Name",
          placeholder: "Enter business name",
          category: "Business",
          required: true,
          locked: false,
          icon: "🏢",
          helpText: "Legal business name or DBA",
        },
        {
          id: "taxId",
          type: "text",
          label: "Tax ID / EIN",
          placeholder: "Enter tax ID or EIN",
          category: "Business",
          required: false,
          locked: false,
          icon: "📋",
          helpText: "Federal Employer Identification Number or Tax ID",
        },
      ],

      /* ===== VERIFICATION FIELDS ===== */
      verificationFields: [
        {
          id: "licenseNumber",
          type: "text",
          label: "License Number",
          placeholder: "Enter license number",
          category: "Verification",
          required: true,
          locked: false,
          icon: "🎫",
          helpText: "Professional or business license number",
        },
        {
          id: "licenseFile",
          type: "file",
          label: "Upload License",
          placeholder: "",
          category: "Verification",
          required: true,
          locked: false,
          icon: "📄",
          helpText: "Accepted formats: PDF, JPG, PNG. Max size: 5MB",
        },
        {
          id: "taxCertificate",
          type: "file",
          label: "Tax Certificate",
          placeholder: "",
          category: "Verification",
          required: false,
          locked: false,
          icon: "📋",
          helpText: "Upload resale certificate or tax exemption",
        },
        {
          id: "insuranceFile",
          type: "file",
          label: "Insurance Certificate",
          placeholder: "",
          category: "Verification",
          required: false,
          locked: false,
          icon: "🛡️",
          helpText: "Proof of business liability insurance",
        },
        {
          id: "permitFile",
          type: "file",
          label: "Business Permit",
          placeholder: "",
          category: "Verification",
          required: false,
          locked: false,
          icon: "📜",
          helpText: "Upload business permit or registration",
        },
      ],

      /* ===== STUDENT FIELDS ===== */
      studentFields: [
        {
          id: "schoolName",
          type: "text",
          label: "School/Institution Name",
          placeholder: "Enter school name",
          category: "Student",
          required: true,
          locked: false,
          icon: "🎓",
          helpText: "Name of educational institution",
        },
        {
          id: "studentProof",
          type: "file",
          label: "Student ID / Class Schedule",
          placeholder: "",
          category: "Student",
          required: true,
          locked: false,
          icon: "📚",
          helpText: "Upload student ID or current class schedule",
        },
        {
          id: "graduationYear",
          type: "text",
          label: "Expected Graduation Year",
          placeholder: "e.g., 2025",
          category: "Student",
          required: false,
          locked: false,
          icon: "📅",
          helpText: "",
        },
        {
          id: "major",
          type: "text",
          label: "Major/Field of Study",
          placeholder: "Enter major",
          category: "Student",
          required: false,
          locked: false,
          icon: "📖",
          helpText: "",
        },
      ],
    };

    res.json({
      success: true,
      fieldLibrary,
    });
  } catch (error) {
    console.error("❌ Error loading field library:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load field library",
    });
  }
});

/* ========================================
   DELETE/RESET SETTINGS
   Development only - clears all settings
   ======================================== */
router.delete("/", async (req, res) => {
  try {
    await Settings.deleteMany({});
    console.log("🗑️ All settings deleted");

    // Create fresh empty settings
    const settings = await Settings.create({
      customerTypes: [],
    });

    res.json({
      success: true,
      message: "Settings reset successfully",
      settings: settings,
    });
  } catch (error) {
    console.error("❌ Reset settings error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* ========================================
   DEBUG ENDPOINT
   Returns all settings documents (dev only)
   ======================================== */
router.get("/debug/all", async (req, res) => {
  try {
    const allSettings = await Settings.find({});
    res.json({
      success: true,
      count: allSettings.length,
      documents: allSettings,
    });
  } catch (error) {
    console.error("❌ Debug endpoint error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* DROP OLD INDEX - Run once to fix duplicate key error */
router.post("/fix-index", async (req, res) => {
  try {
    await Settings.collection.dropIndex("shop_1");
    console.log("🗑️ Dropped old shop_1 index");

    await Settings.deleteMany({});
    console.log("🗑️ Deleted all old documents");

    res.json({
      success: true,
      message: "Index dropped and documents cleared",
    });
  } catch (error) {
    console.error("❌ Fix index error:", error);
    res.json({
      success: true,
      message: "Index might not exist or already dropped: " + error.message,
    });
  }
});

module.exports = router;
