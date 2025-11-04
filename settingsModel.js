const mongoose = require("mongoose");

/* Field Definition Schema - Represents a single form field */
const FieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // e.g., "businessName", "licenseNumber"
    type: {
      type: String,
      required: true,
      enum: ["text", "email", "tel", "password", "file", "address", "textarea"],
    },
    label: { type: String, required: true }, // e.g., "Contractor License Number"
    placeholder: { type: String, default: "" }, // e.g., "Enter your license number"
    required: { type: Boolean, default: true },
    visible: { type: Boolean, default: true },
    locked: { type: Boolean, default: false }, // Locked fields can't be removed (like password)
    order: { type: Number, default: 0 }, // Order within the step
    helpText: { type: String, default: "" }, // Help text below field
    validation: {
      minLength: { type: Number },
      maxLength: { type: Number },
      pattern: { type: String }, // Regex pattern for validation
    },
  },
  { _id: false }
);

/* Step Schema - Represents a single step in the form */
const StepSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // e.g., "step-1", "step-2"
    name: { type: String, required: true }, // e.g., "Contact Details", "Business Info"
    order: { type: Number, required: true }, // Step order (1, 2, 3, 4)
    locked: { type: Boolean, default: false }, // Step 1 is always locked
    fields: [FieldSchema], // Array of fields in this step
  },
  { _id: false }
);

/* Customer Type Schema - Main schema for customer types */
const CustomerTypeSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  tag: { type: String, required: true },
  icon: { type: String, default: "👤" },
  description: { type: String, default: "" },
  requiresApproval: { type: Boolean, default: true },
  requiresFiles: { type: Boolean, default: false },
  defaultDiscount: { type: Number, default: 0, min: 0, max: 100 },
  moqDefault: { type: Number, default: 0, min: 0 },
  displayOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },

  // NEW: Form structure configuration
  formSteps: {
    type: [StepSchema],
    default: function () {
      // Default 3-step flow if not specified
      return [
        {
          id: "step-1",
          name: "Account Type",
          order: 1,
          locked: true,
          fields: [],
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
            },
            {
              id: "email",
              type: "email",
              label: "Email Address",
              placeholder: "email@example.com",
              required: true,
              visible: true,
              locked: true,
              order: 2,
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
            },
            {
              id: "password",
              type: "password",
              label: "Password",
              placeholder: "Enter password",
              required: true,
              visible: true,
              locked: true,
              order: 4,
            },
            {
              id: "confirmPassword",
              type: "password",
              label: "Confirm Password",
              placeholder: "Re-enter password",
              required: true,
              visible: true,
              locked: true,
              order: 5,
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
            },
          ],
        },
      ];
    },
  },
});

const SettingsSchema = new mongoose.Schema(
  {
    shopDomain: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customerTypes: { type: [CustomerTypeSchema], default: [] },
    appName: { type: String, default: "Wholesale Harmony" },
    allowedFileTypes: {
      type: [String],
      default: ["business_license", "tax_id", "reseller_permit"],
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

SettingsSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Settings", SettingsSchema);
