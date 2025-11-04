/* ========================================
   SETTINGS API ROUTES
   Handles customer type configuration and form builder settings
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
   GET FIELD LIBRARY
   Returns all available preset fields for form builder
   ======================================== */
router.get("/field-library", (req, res) => {
  try {
    const fieldLibrary = {
      /* ===== CONTACT FIELDS ===== */
      contactFields: [
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
          id: "password",
          type: "password",
          label: "Password",
          placeholder: "Enter password",
          category: "Contact",
          required: true,
          locked: true, // Can't be removed - required for Shopify
          icon: "🔒",
          helpText: "Minimum 6 characters",
        },
        {
          id: "confirmPassword",
          type: "password",
          label: "Confirm Password",
          placeholder: "Re-enter password",
          category: "Contact",
          required: true,
          locked: true, // Can't be removed - required for validation
          icon: "🔒",
          helpText: "Must match password",
        },
        /* ===== PERSONAL ADDRESS FIELDS (NEW) ===== */
        {
          id: "homeAddress",
          type: "text",
          label: "Home Address",
          placeholder: "123 Main Street",
          category: "Contact",
          required: false,
          locked: false,
          icon: "🏠",
          helpText: "Street address with Google Places autocomplete",
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
        {
          id: "homeCity",
          type: "text",
          label: "City",
          placeholder: "New York",
          category: "Contact",
          required: false,
          locked: false,
          icon: "🏙️",
          helpText: "Your city",
        },
        {
          id: "homeState",
          type: "text",
          label: "State / Province",
          placeholder: "NY",
          category: "Contact",
          required: false,
          locked: false,
          icon: "📍",
          helpText: "State or province",
        },
        {
          id: "homeZip",
          type: "text",
          label: "ZIP / Postal Code",
          placeholder: "10001",
          category: "Contact",
          required: false,
          locked: false,
          icon: "📮",
          helpText: "ZIP or postal code",
        },
        {
          id: "homeCountry",
          type: "text",
          label: "Country",
          placeholder: "United States",
          category: "Contact",
          required: false,
          locked: false,
          icon: "🌍",
          helpText: "Your country",
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
          id: "businessAddress",
          type: "address",
          label: "Business Address",
          placeholder: "Enter street address",
          category: "Business",
          required: true,
          locked: false,
          icon: "📍",
          helpText: "Street address with Google Places autocomplete",
        },
        {
          id: "businessCity",
          type: "text",
          label: "City",
          placeholder: "Enter city",
          category: "Business",
          required: true,
          locked: false,
          icon: "🏙️",
          helpText: "",
        },
        {
          id: "businessState",
          type: "text",
          label: "State",
          placeholder: "Enter state",
          category: "Business",
          required: true,
          locked: false,
          icon: "📍",
          helpText: "",
        },
        {
          id: "businessZip",
          type: "text",
          label: "ZIP Code",
          placeholder: "Enter ZIP code",
          category: "Business",
          required: true,
          locked: false,
          icon: "📮",
          helpText: "",
        },
        {
          id: "businessCountry",
          type: "text",
          label: "Country",
          placeholder: "United States",
          category: "Business",
          required: false,
          locked: false,
          icon: "🌎",
          helpText: "",
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

module.exports = router;
