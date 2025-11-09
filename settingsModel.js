/* ========================================
   WHOLESALE HARMONY - SETTINGS MODEL
   MongoDB schema for customer types and form builder configuration
   WITH COMPLETE ADDRESS BUNDLE SUPPORT
   ======================================== */

const mongoose = require("mongoose");

/* ========================================
   FIELD SCHEMA
   Represents a single form field with bundle support
   ======================================== */
const FieldSchema = new mongoose.Schema(
  {
    /* ===== BASIC FIELD PROPERTIES ===== */
    id: {
      type: String,
      required: true,
    }, // Unique field ID (e.g., "firstName", "homeAddress", "homeCity")

    type: {
      type: String,
      required: true,
      enum: ["text", "email", "tel", "password", "file", "address", "textarea"],
    }, // Field input type

    label: {
      type: String,
      required: true,
    }, // Display label (e.g., "First Name", "Home Street Address")

    placeholder: {
      type: String,
      default: "",
    }, // Placeholder text (e.g., "Enter your name")

    required: {
      type: Boolean,
      default: true,
    }, // Is this field required?

    visible: {
      type: Boolean,
      default: true,
    }, // Is this field visible?

    locked: {
      type: Boolean,
      default: false,
    }, // Locked fields can't be removed (e.g., email, password)

    order: {
      type: Number,
      default: 0,
    }, // Order within the step

    icon: {
      type: String,
      default: "",
    }, // Emoji icon displayed with the field (e.g., "📧", "🏠", "📱")

    helpText: {
      type: String,
      default: "",
    }, // Help text displayed below the field

    /* ===== ADDRESS BUNDLE SUPPORT ===== */
    /* These properties link related address fields together
       for Google Places autocomplete functionality */

    bundleGroup: {
      type: String,
    }, // Bundle identifier (e.g., "home" or "business")
    // All fields with the same bundleGroup are part of one address bundle
    // Example: homeAddress, homeCity, homeState, homeZip, homeCountry
    //          all have bundleGroup: "home"

    bundleIndex: {
      type: Number,
    }, // Order within the bundle (0-4)
    // 0 = Street Address (the main field with Google Places)
    // 1 = City
    // 2 = State
    // 3 = ZIP Code
    // 4 = Country

    bundleType: {
      type: String,
    }, // Type of bundle (currently only "address")
    // Future: Could support other bundle types like "name" or "phone"

    /* ===== VALIDATION RULES ===== */
    validation: {
      minLength: { type: Number }, // Minimum character length
      maxLength: { type: Number }, // Maximum character length
      pattern: { type: String }, // Regex pattern for validation
    },
  },
  { _id: false } // Don't create separate _id for nested documents
);

/* ========================================
   STEP SCHEMA
   Represents a single step in the registration form
   ======================================== */
const StepSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    }, // Step identifier (e.g., "step-1", "step-2")

    name: {
      type: String,
      required: true,
    }, // Display name (e.g., "Contact Details", "Business Info")

    order: {
      type: Number,
      required: true,
    }, // Step order (1, 2, 3, 4) - determines sequence

    locked: {
      type: Boolean,
      default: false,
    }, // Step 1 is always locked (Account Type selection)

    fields: [FieldSchema], // Array of fields in this step
  },
  { _id: false }
);

/* ========================================
   CUSTOMER TYPE SCHEMA
   Main schema for each customer type (e.g., Student, Esthetician)
   ======================================== */
const CustomerTypeSchema = new mongoose.Schema({
  /* ===== BASIC SETTINGS ===== */
  id: {
    type: String,
    required: true,
  }, // Unique ID (e.g., "type_abc123")

  name: {
    type: String,
    required: true,
  }, // Display name (e.g., "Student", "Esthetician")

  tag: {
    type: String,
    required: true,
  }, // Shopify customer tag (e.g., "student", "esthetician")

  icon: {
    type: String,
    default: "👤",
  }, // Emoji icon for this customer type

  color: {
    type: String,
    default: "#A0AEC0",
  }, // ← ADD THIS ENTIRE BLOCK

  description: {
    type: String,
    default: "",
  }, // Customer-facing description (e.g., "Save on every order")

  /* ===== APPROVAL & VERIFICATION ===== */
  requiresApproval: {
    type: Boolean,
    default: true,
  }, // Does this type require admin approval?

  requiresFiles: {
    type: Boolean,
    default: false,
  }, // Does this type require file uploads?

  /* ===== PRICING SETTINGS ===== */
  defaultDiscount: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  }, // Default discount percentage (0-100)

  moqDefault: {
    type: Number,
    default: 0,
    min: 0,
  }, // Minimum Order Quantity default

  /* ===== DISPLAY & STATUS ===== */
  displayOrder: {
    type: Number,
    default: 0,
  }, // Order in which this type appears in the list

  isActive: {
    type: Boolean,
    default: true,
  }, // Is this customer type currently active?

  /* ===== FORM BUILDER CONFIGURATION ===== */
  formSteps: {
    type: [StepSchema],
    default: function () {
      // Default 3-step flow if not specified
      return [
        {
          id: "step-1",
          name: "Account Type",
          order: 1,
          locked: true, // Step 1 is always locked (account type selection)
          fields: [], // No fields - this step just shows account type cards
        },
        {
          id: "step-2",
          name: "Contact Details",
          order: 2,
          locked: false,
          fields: [
            {
              id: "firstName",
              type: "text",
              label: "First Name",
              placeholder: "Enter first name",
              required: true,
              visible: true,
              locked: false,
              order: 0,
              icon: "👤",
            },
            {
              id: "lastName",
              type: "text",
              label: "Last Name",
              placeholder: "Enter last name",
              required: true,
              visible: true,
              locked: false,
              order: 1,
              icon: "👤",
            },
            {
              id: "email",
              type: "email",
              label: "Email Address",
              placeholder: "email@example.com",
              required: true,
              visible: true,
              locked: true, // Email is locked - required for Shopify customer creation
              order: 2,
              icon: "📧",
            },
            {
              id: "phone",
              type: "tel",
              label: "Phone Number",
              placeholder: "Enter phone number",
              required: true,
              visible: true,
              locked: false,
              order: 3,
              icon: "📱",
            },
            {
              id: "password",
              type: "password",
              label: "Password",
              placeholder: "Enter password",
              required: true,
              visible: true,
              locked: true, // Password is locked - required for Shopify customer creation
              order: 4,
              icon: "🔒",
            },
            {
              id: "confirmPassword",
              type: "password",
              label: "Confirm Password",
              placeholder: "Re-enter password",
              required: true,
              visible: true,
              locked: true, // Confirm password is locked - required for validation
              order: 5,
              icon: "🔒",
            },
          ],
        },
        {
          id: "step-3",
          name: "Business Information",
          order: 3,
          locked: false,
          fields: [
            {
              id: "businessName",
              type: "text",
              label: "Business Name",
              placeholder: "Enter business name",
              required: true,
              visible: true,
              locked: false,
              order: 0,
              icon: "🏢",
            },
            {
              id: "businessAddress",
              type: "address",
              label: "Business Address",
              placeholder: "Enter street address",
              required: true,
              visible: true,
              locked: false,
              order: 1,
              icon: "📍",
            },
            {
              id: "taxId",
              type: "text",
              label: "Tax ID / EIN",
              placeholder: "Enter tax ID",
              required: false,
              visible: true,
              locked: false,
              order: 2,
              icon: "📋",
            },
          ],
        },
      ];
    },
  },
});

/* ========================================
   SETTINGS SCHEMA
   Main settings document for the entire app
   ======================================== */
const SettingsSchema = new mongoose.Schema(
  {
    /* ===== SHOP IDENTIFICATION ===== */
    shopDomain: {
      type: String,
      required: true,
      unique: true, // One settings document per shop
      index: true, // Index for fast lookups
    }, // Shopify shop domain (e.g., "example.myshopify.com")

    /* ===== CUSTOMER TYPES ===== */
    customerTypes: {
      type: [CustomerTypeSchema],
      default: [],
    }, // Array of all customer types for this shop

    /* ===== APP CONFIGURATION ===== */
    appName: {
      type: String,
      default: "Wholesale Harmony",
    }, // Application name

    allowedFileTypes: {
      type: [String],
      default: ["business_license", "tax_id", "reseller_permit"],
    }, // Allowed file upload types

    /* ===== TIMESTAMPS ===== */
    updatedAt: {
      type: Date,
      default: Date.now,
    }, // Last update timestamp
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
  }
);

/* ========================================
   PRE-SAVE MIDDLEWARE
   Updates the updatedAt timestamp before saving
   ======================================== */
SettingsSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

/* ========================================
   EXPORT MODEL
   ======================================== */
module.exports = mongoose.model("Settings", SettingsSchema);

/* ========================================
   USAGE EXAMPLES & NOTES
   ======================================== */

/*
  ADDRESS BUNDLE STRUCTURE:
  -------------------------
  When a user checks "Address (Home)" in the Form Builder,
  the JSX creates 5 fields with these properties:
  
  Field 1 - Street Address:
  {
    id: "homeAddress",
    type: "text",
    label: "Home Street Address",
    bundleGroup: "home",      ← Links all fields together
    bundleIndex: 0,            ← First field in bundle
    bundleType: "address",     ← Type of bundle
    icon: "📍",
    ...
  }
  
  Field 2 - City:
  {
    id: "homeCity",
    type: "text",
    label: "Home City",
    bundleGroup: "home",      ← Same group as homeAddress
    bundleIndex: 1,            ← Second field in bundle
    bundleType: "address",
    icon: "🏙️",
    ...
  }
  
  Field 3 - State:
  {
    id: "homeState",
    type: "text",
    label: "Home State",
    bundleGroup: "home",
    bundleIndex: 2,
    bundleType: "address",
    icon: "🗺️",
    ...
  }
  
  Field 4 - ZIP Code:
  {
    id: "homeZip",
    type: "text",
    label: "Home ZIP Code",
    bundleGroup: "home",
    bundleIndex: 3,
    bundleType: "address",
    icon: "📮",
    ...
  }
  
  Field 5 - Country:
  {
    id: "homeCountry",
    type: "text",
    label: "Home Country",
    bundleGroup: "home",
    bundleIndex: 4,
    bundleType: "address",
    icon: "🌍",
    ...
  }
  
  HOW IT WORKS:
  -------------
  1. Form Builder (JSX) checks for "Address (Home)" checkbox
  2. JSX calls handleBundleToggle() which creates all 5 fields
  3. Each field gets bundleGroup: "home" property
  4. MongoDB saves all fields with bundleGroup property intact
  5. Theme JavaScript detects fields with same bundleGroup
  6. Theme initializes Google Places autocomplete ONCE per bundle
  7. When user selects address, all 5 fields auto-fill
  
  BUSINESS ADDRESS BUNDLE:
  -----------------------
  Same structure, but with:
  - bundleGroup: "business"
  - Field IDs: businessAddress, businessCity, businessState, etc.
  
  DEBUGGING:
  ----------
  If auto-fill doesn't work, check console logs for:
  - "bundleGroup: undefined" ← Schema is missing properties
  - "bundleGroup: home" ← Schema is correct ✓
  
  If you see undefined, make sure this file has:
  - icon: { type: String }
  - bundleGroup: { type: String }
  - bundleIndex: { type: Number }
  - bundleType: { type: String }
*/
