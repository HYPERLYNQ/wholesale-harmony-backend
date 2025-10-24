require("dotenv").config();
const cors = require("cors");
const express = require("express");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const multer = require("multer");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const emailTemplates = require("./emailTemplates");

// File compression libraries
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

// ========== FILE COMPRESSION FUNCTION ==========
async function compressFile(filePath, filename) {
  try {
    const ext = path.extname(filename).toLowerCase();
    const compressedPath = filePath + ".compressed";

    // Compress images (JPG, PNG) to 70% quality
    if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
      console.log(`🗜️ Compressing image: ${filename}`);
      await sharp(filePath)
        .jpeg({ quality: 70, mozjpeg: true })
        .toFile(compressedPath);

      const originalSize = fs.statSync(filePath).size;
      const compressedSize = fs.statSync(compressedPath).size;
      const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      console.log(
        `✅ Image compressed: ${(originalSize / 1024).toFixed(0)} KB → ${(
          compressedSize / 1024
        ).toFixed(0)} KB (${savings}% smaller)`
      );

      return compressedPath;
    }

    // Compress PDFs
    if (ext === ".pdf") {
      console.log(`🗜️ Compressing PDF: ${filename}`);
      const pdfBytes = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // Save with compression
      const compressedPdfBytes = await pdfDoc.save({
        useObjectStreams: true,
      });

      fs.writeFileSync(compressedPath, compressedPdfBytes);

      const originalSize = fs.statSync(filePath).size;
      const compressedSize = compressedPdfBytes.length;
      const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      console.log(
        `✅ PDF compressed: ${(originalSize / 1024).toFixed(0)} KB → ${(
          compressedSize / 1024
        ).toFixed(0)} KB (${savings}% smaller)`
      );

      return compressedPath;
    }

    // No compression for other file types
    console.log(`⚠️ No compression available for ${ext} files`);
    return filePath;
  } catch (error) {
    console.error(`❌ Compression failed for ${filename}:`, error.message);
    return filePath; // Return original if compression fails
  }
}

// SendGrid setup
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Email helper function
async function sendEmail({ to, subject, html }) {
  try {
    await sgMail.send({
      to,
      from: {
        email: process.env.SENDER_EMAIL,
        name: "Depileve USA",
      },
      subject,
      html,
    });
    console.log(`✅ Email sent to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
    if (error.response) {
      console.error("SendGrid Error:", error.response.body);
    }
    return false;
  }
}

// Configure multer for file uploads
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG, and PNG files are allowed"));
    }
  },
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const app = express();
const PORT = process.env.PORT || 3000;

// Shopify configuration
const SHOPIFY_SHOP = `${process.env.SHOPIFY_SHOP_NAME}.myshopify.com`;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Redis client setup
let redisClient;
const REDIS_ENABLED =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

if (REDIS_ENABLED) {
  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log("✅ Upstash Redis connected");
} else {
  console.log("⚠️ Redis not configured - caching disabled");
}

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// Test route
app.get("/", (req, res) => {
  res.send("Shopify Registration Server is running!");
});

// Cache helper functions
async function getCachedResult(key) {
  if (!REDIS_ENABLED) return null;

  try {
    const cached = await redisClient.get(key);
    if (cached) {
      console.log(`💾 Cache HIT: ${key}`);
      return JSON.parse(cached);
    }
    console.log(`🔍 Cache MISS: ${key}`);
    return null;
  } catch (error) {
    console.error("Redis GET error:", error);
    return null;
  }
}

async function setCachedResult(key, value, ttlSeconds = 300) {
  if (!REDIS_ENABLED) return;

  try {
    await redisClient.set(key, JSON.stringify(value), { ex: ttlSeconds });
    console.log(`💾 Cached: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error("Redis SET error:", error);
  }
}

async function invalidateCustomerCache(email, phone) {
  if (!REDIS_ENABLED) return;

  try {
    const phoneDigits = phone.replace(/\D/g, "");
    await redisClient.del(`email:${email.toLowerCase()}`);
    await redisClient.del(`phone:${phoneDigits}`);
    await redisClient.del(`duplicate:${email.toLowerCase()}:${phoneDigits}`);
    console.log(`🗑️ Cache invalidated for: ${email}, ${phone}`);
  } catch (error) {
    console.error("Redis DEL error:", error);
  }
}

// Helper function to upload file to Shopify
// ========== UPLOAD FILE TO SHOPIFY (PERMANENT STORAGE WITH COMPRESSION) ==========
// ========== UPLOAD FILE TO SHOPIFY (PERMANENT STORAGE WITH COMPRESSION) ==========
async function uploadFileToShopify(filePath, filename) {
  try {
    console.log(`\n📤 Starting upload process for: ${filename}`);

    // Step 1: Compress the file first
    const compressedPath = await compressFile(filePath, filename);

    // Step 2: Read compressed file
    const fileBuffer = fs.readFileSync(compressedPath);
    const mimeType = getMimeType(filename);

    console.log(
      `📊 File size: ${(fileBuffer.length / 1024).toFixed(
        0
      )} KB, Type: ${mimeType}`
    );

    // Step 3: Create staged upload
    const stagedUploadMutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const stagedResponse = await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
      {
        query: stagedUploadMutation,
        variables: {
          input: [
            {
              filename: filename,
              mimeType: mimeType,
              resource: "FILE",
              httpMethod: "POST",
            },
          ],
        },
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const stagedTarget =
      stagedResponse.data.data.stagedUploadsCreate.stagedTargets[0];
    console.log(`✅ Staged upload created`);

    // Step 4: Upload file to staged URL using FormData
    const formData = new FormData();
    stagedTarget.parameters.forEach((param) => {
      formData.append(param.name, param.value);
    });
    formData.append("file", fs.createReadStream(compressedPath));

    await axios.post(stagedTarget.url, formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    console.log(`✅ File uploaded to staged storage`);

    // Step 5: Create permanent file from staged upload
    const fileCreateMutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            ... on GenericFile {
              id
              url
              alt
              fileStatus
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const fileCreateResponse = await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
      {
        query: fileCreateMutation,
        variables: {
          files: [
            {
              alt: filename,
              contentType: "FILE",
              originalSource: stagedTarget.resourceUrl,
              filename: filename, // CRITICAL: Include filename!
            },
          ],
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
      "🔍 Full fileCreate response:",
      JSON.stringify(fileCreateResponse.data, null, 2)
    );

    // Check for GraphQL errors
    if (fileCreateResponse.data.errors) {
      console.error("❌ GraphQL Errors:", fileCreateResponse.data.errors);
      return stagedTarget.resourceUrl; // Fallback to staged URL
    }

    const fileCreateData = fileCreateResponse.data.data?.fileCreate;

    if (!fileCreateData) {
      console.error("❌ No fileCreate data in response");
      return stagedTarget.resourceUrl; // Fallback to staged URL
    }

    if (fileCreateData.userErrors && fileCreateData.userErrors.length > 0) {
      console.error("❌ User Errors:", fileCreateData.userErrors);
      return stagedTarget.resourceUrl; // Fallback to staged URL
    }

    const permanentFile = fileCreateData.files?.[0];

    if (!permanentFile) {
      console.error("❌ No file returned");
      console.error(
        "FileCreate response:",
        JSON.stringify(fileCreateData, null, 2)
      );
      return stagedTarget.resourceUrl; // Fallback to staged URL
    }

    // Check file status
    // Check file status
    console.log(`📝 File Status: ${permanentFile.fileStatus}`);
    console.log(`🎉 File created with ID: ${permanentFile.id}`);

    // Step 6: If URL is not ready, poll for it
    let fileUrl = permanentFile.url;

    if (!fileUrl && permanentFile.id) {
      console.log(`⏳ URL not ready yet, polling for file URL...`);
      fileUrl = await pollForFileUrl(permanentFile.id);
    }

    if (!fileUrl) {
      console.error(`❌ Could not get file URL after polling`);
      return null;
    }

    console.log(`✅ Final file URL: ${fileUrl}\n`);

    // Step 7: Clean up compressed file
    if (compressedPath !== filePath && fs.existsSync(compressedPath)) {
      fs.unlinkSync(compressedPath);
    }

    return fileUrl; // Return permanent URL!
  } catch (error) {
    console.error(`❌ File upload error for ${filename}:`, error.message);
    if (error.response?.data) {
      console.error("Response:", JSON.stringify(error.response.data, null, 2));
    }
    return null;
  }
}

// ========== POLL FOR FILE URL (Wait for Shopify to process the file) ==========
async function pollForFileUrl(fileId, maxAttempts = 10, delayMs = 2000) {
  console.log(`⏳ Polling for file URL (ID: ${fileId})...`);

  const query = `
    query getFile($id: ID!) {
      node(id: $id) {
        ... on GenericFile {
          id
          url
          fileStatus
        }
      }
    }
  `;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post(
        `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
        {
          query: query,
          variables: { id: fileId },
        },
        {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      const file = response.data.data?.node;

      if (file && file.url) {
        console.log(`✅ File ready! URL: ${file.url}`);
        return file.url;
      }

      console.log(
        `⏳ Attempt ${attempt}/${maxAttempts}: File status = ${
          file?.fileStatus || "UNKNOWN"
        }, URL not ready yet...`
      );

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error(
        `❌ Error polling for file URL (attempt ${attempt}):`,
        error.message
      );
    }
  }

  console.error(`❌ Failed to get file URL after ${maxAttempts} attempts`);
  return null;
}

// Helper to get MIME type
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// OPTIMIZED: Parallel search for email and phone
async function checkDuplicates(email, phoneDigits) {
  console.log("🔍 Starting parallel duplicate check...");
  const startTime = Date.now();

  // Check cache first
  const cacheKey = `duplicate:${email.toLowerCase()}:${phoneDigits}`;
  const cached = await getCachedResult(cacheKey);

  if (cached !== null) {
    const duration = Date.now() - startTime;
    console.log(`⚡ Returned from cache in ${duration}ms`);
    return cached;
  }

  // Run email and phone checks in parallel
  const [emailExists, phoneCustomer] = await Promise.all([
    checkEmailExists(email),
    searchPhoneOptimized(phoneDigits),
  ]);

  const result = { emailExists, phoneCustomer };

  // Cache the result for 5 minutes
  await setCachedResult(cacheKey, result, 300);

  const duration = Date.now() - startTime;
  console.log(`⏱️ Duplicate check completed in ${duration}ms`);

  return result;
}

// Check email using GraphQL (very fast)
async function checkEmailExists(email) {
  // Check cache first
  const cacheKey = `email:${email.toLowerCase()}`;
  const cached = await getCachedResult(cacheKey);
  if (cached !== null) return cached;

  const query = `
    query {
      customers(first: 1, query: "email:${email}") {
        edges {
          node {
            id
            email
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
      { query },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const exists = response.data.data.customers.edges.length > 0;

    // Cache result
    await setCachedResult(cacheKey, exists, 300);

    return exists;
  } catch (error) {
    console.error("Email check error:", error.response?.data || error.message);
    return false;
  }
}

// OPTIMIZED: Search phone with batching and early exit
async function searchPhoneOptimized(phoneDigits) {
  // Check cache first
  const cacheKey = `phone:${phoneDigits}`;
  const cached = await getCachedResult(cacheKey);
  if (cached !== null) return cached;

  let hasNextPage = true;
  let cursor = null;
  let batchCount = 0;
  const maxBatches = 40; // Stop after 10,000 customers (40 * 250)

  while (hasNextPage && batchCount < maxBatches) {
    batchCount++;

    const query = `
      query {
        customers(first: 250${cursor ? `, after: "${cursor}"` : ""}) {
          edges {
            node {
              id
              phone
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    try {
      const response = await axios.post(
        `https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`,
        { query },
        {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      const data = response.data.data.customers;
      const customers = data.edges.map((edge) => edge.node);

      // Check current batch for phone match
      for (const customer of customers) {
        if (customer.phone) {
          const customerPhoneDigits = customer.phone.replace(/\D/g, "");
          if (customerPhoneDigits === phoneDigits) {
            console.log(
              `📱 Phone match found in batch ${batchCount}:`,
              customer.phone
            );

            // Cache the result
            await setCachedResult(cacheKey, customer, 300);

            return customer; // Early exit - found a match!
          }
        }
      }

      // Prepare for next batch
      hasNextPage = data.pageInfo.hasNextPage;
      if (hasNextPage && data.edges.length > 0) {
        cursor = data.edges[data.edges.length - 1].cursor;
      }
    } catch (error) {
      console.error(
        "Phone search error:",
        error.response?.data || error.message
      );
      hasNextPage = false;
    }
  }

  if (batchCount >= maxBatches) {
    console.log(`⚠️ Reached max search limit (${maxBatches * 250} customers)`);
  }

  // Cache "not found" result
  await setCachedResult(cacheKey, null, 300);

  return null; // No match found
}

// Check email only (FAST - for real-time validation)
app.post("/api/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    console.log("📧 Checking email:", email);

    const emailExists = await checkEmailExists(email);

    if (emailExists) {
      return res.json({
        available: false,
        message: "This email address is already registered.",
      });
    }

    res.json({ available: true });
  } catch (error) {
    console.error("Email check error:", error);
    res.json({ available: true });
  }
});

// Check phone only (for real-time validation)
app.post("/api/check-phone", async (req, res) => {
  try {
    const { phone } = req.body;
    const phoneDigits = phone.replace(/\D/g, "");
    console.log("📱 Checking phone:", phoneDigits);

    const phoneCustomer = await searchPhoneOptimized(phoneDigits);

    if (phoneCustomer) {
      return res.json({
        available: false,
        message: "This phone number is already registered.",
      });
    }

    res.json({ available: true });
  } catch (error) {
    console.error("Phone check error:", error);
    res.json({ available: true });
  }
});

// Check for duplicate email/phone (COMBINED - for final validation)
app.post("/api/check-duplicate", async (req, res) => {
  try {
    const { email, phone } = req.body;

    console.log("🔍 Checking duplicates for:", { email, phone });

    // Normalize phone number
    const phoneDigits = phone.replace(/\D/g, "");

    // Run parallel duplicate check (with caching)
    const { emailExists, phoneCustomer } = await checkDuplicates(
      email,
      phoneDigits
    );

    if (emailExists) {
      console.log("❌ Email already exists");
      return res.json({
        available: false,
        message: "This email address is already registered.",
      });
    }

    if (phoneCustomer) {
      console.log("❌ Phone already exists:", phoneCustomer.phone);
      return res.json({
        available: false,
        message: "This phone number is already registered.",
      });
    }

    console.log("✅ Email and phone are available");
    res.json({ available: true });
  } catch (error) {
    console.error(
      "Duplicate check error:",
      error.response?.data || error.message
    );
    res.json({ available: true });
  }
});

// Registration endpoint with file upload
app.post(
  "/api/register",
  upload.fields([
    { name: "taxCertificate", maxCount: 1 },
    { name: "licenseFile", maxCount: 1 },
    { name: "studentProof", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        email,
        phone,
        password,
        accountType,
        schoolName,
        businessName,
        businessStreet,
        businessCity,
        businessState,
        businessZip,
        businessCountry,
        taxId,
        licenseNumber,
      } = req.body;

      console.log("Registration request received:", {
        firstName,
        lastName,
        email,
        phone,
        accountType,
        files: req.files,
      });

      // Upload files to Shopify and build notes
      let notes = "";
      let fileUrls = {};

      const { agreeTerms, agreeMarketing } = req.body;

      notes += `Terms Accepted: ${agreeTerms === "true" ? "Yes" : "No"}\n`;
      notes += `Marketing Consent: ${
        agreeMarketing === "true" ? "Yes" : "No"
      }\n\n`;

      if (accountType === "student") {
        notes += `School: ${schoolName || ""}\n\n`;

        if (req.files?.studentProof) {
          const file = req.files.studentProof[0];
          const fileUrl = await uploadFileToShopify(
            file.path,
            file.originalname
          );
          if (fileUrl) {
            fileUrls.studentProof = fileUrl;
            // File URL will be stored in metafields instead
          }
        }
      } else if (accountType === "esthetician" || accountType === "salon") {
        notes += `License Number: ${licenseNumber}\n`;
        notes += `Business: ${businessName || ""}\n`;
        notes += `Address: ${businessStreet || ""}, ${businessCity || ""}, ${
          businessState || ""
        } ${businessZip || ""}\n`;
        notes += `Tax ID: ${taxId || ""}\n\n`;

        // Upload license file FIRST
        if (req.files?.licenseFile) {
          const file = req.files.licenseFile[0];
          console.log(`📤 Uploading LICENSE file: ${file.originalname}`);
          const fileUrl = await uploadFileToShopify(
            file.path,
            file.originalname
          );
          if (fileUrl) {
            fileUrls.licenseFile = fileUrl;
            console.log(`✅ License file URL stored: ${fileUrl}`);
          } else {
            console.error(`❌ License file upload FAILED`);
          }
        }

        // Upload tax certificate SECOND
        if (req.files?.taxCertificate) {
          const file = req.files.taxCertificate[0];
          console.log(`📤 Uploading TAX CERTIFICATE: ${file.originalname}`);
          const fileUrl = await uploadFileToShopify(
            file.path,
            file.originalname
          );
          if (fileUrl) {
            fileUrls.taxCertificate = fileUrl;
            console.log(`✅ Tax certificate URL stored: ${fileUrl}`);
          } else {
            console.error(`❌ Tax certificate upload FAILED`);
          }
        }
      }

      // Log all file URLs before creating customer
      console.log("📋 File URLs collected:", fileUrls);

      // Determine customer tags based on account type
      let tags = [];

      if (accountType === "consumer") {
        // Consumers pay full price
        tags = ["consumer"];
      } else if (accountType === "esthetician") {
        // Estheticians get 15% off (pending approval)
        tags = ["pending-approval", "esthetician"];
      } else if (accountType === "salon") {
        // Salons get 20% off (pending approval)
        tags = ["pending-approval", "salon"];
      } else if (accountType === "student") {
        // Students get 10% off (pending approval)
        tags = ["pending-approval", "student"];
      }

      // Create customer in Shopify
      const customerData = {
        customer: {
          first_name: firstName,
          last_name: lastName,
          email: email,
          phone: phone,
          password: password,
          password_confirmation: password,
          send_email_welcome: false,
          send_email_invite: false,
          tags: tags.join(", "),
          note: notes.trim(),
          email_marketing_consent: {
            state: agreeMarketing === "true" ? "subscribed" : "not_subscribed",
            opt_in_level: "single_opt_in",
            consent_updated_at: new Date().toISOString(),
          },
        },
      };

      const shopifyResponse = await axios.post(
        `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers.json`,
        customerData,
        {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        "Customer created successfully:",
        shopifyResponse.data.customer.id
      );

      const customerId = shopifyResponse.data.customer.id;

      // Send emails AFTER customer is created
      try {
        // Send different emails based on account type
        if (accountType !== "consumer") {
          // PROFESSIONALS: Send pending approval email
          await sendEmail({
            to: email,
            subject: "✋ Registration Received - Pending Approval",
            html: emailTemplates.getPendingApprovalEmail(
              firstName,
              accountType
            ),
          });

          console.log(
            `📧 Pending approval email sent to professional: ${email}`
          );

          // Notify store owner of new professional registration
          await sendEmail({
            to: process.env.STORE_OWNER_EMAIL || "depileveusa@gmail.com",
            subject: `🔔 New ${
              accountType.charAt(0).toUpperCase() + accountType.slice(1)
            } Registration - Action Required`,
            html: emailTemplates.getOwnerNotificationEmail(
              {
                firstName,
                lastName,
                email,
                phone,
                accountType,
                customerId,
              },
              fileUrls,
              process.env.SHOPIFY_SHOP_NAME || process.env.SHOPIFY_SHOP
            ),
          });

          console.log(`📧 Owner notification sent for new ${accountType}`);
        } else {
          // CONSUMERS: Send welcome email (immediate access)
          await sendEmail({
            to: email,
            subject: "🎉 Welcome to Depileve USA!",
            html: emailTemplates.getApprovalEmail(
              firstName,
              accountType,
              process.env.SHOPIFY_SHOP_NAME || process.env.SHOPIFY_SHOP
            ),
          });

          console.log(`📧 Welcome email sent to consumer: ${email}`);
        }

        console.log("✅ Registration emails sent successfully");
      } catch (emailError) {
        console.error(
          "❌ Failed to send registration emails:",
          emailError.message
        );
        // Don't fail registration if emails fail
      }

      // Add metafields for file URLs
      // customerId already defined above

      if (Object.keys(fileUrls).length > 0) {
        console.log(
          `\n🔧 Starting metafield creation for ${
            Object.keys(fileUrls).length
          } files...`
        );

        const metafieldPromises = [];

        if (fileUrls.studentProof) {
          console.log(`\n📝 Preparing student_proof_file metafield...`);
          const metafield = {
            namespace: "custom",
            key: "student_proof_file",
            value: fileUrls.studentProof,
            type: "url",
          };
          console.log(`   URL: ${metafield.value}`);
          metafieldPromises.push(
            addMetafieldWithLogging(customerId, metafield, "student_proof_file")
          );
        }

        if (fileUrls.licenseFile) {
          console.log(`\n📝 Preparing license_file metafield...`);
          const metafield = {
            namespace: "custom",
            key: "license_file",
            value: fileUrls.licenseFile,
            type: "url",
          };
          console.log(`   URL: ${metafield.value}`);
          metafieldPromises.push(
            addMetafieldWithLogging(customerId, metafield, "license_file")
          );
        }

        if (fileUrls.taxCertificate) {
          console.log(`\n📝 Preparing tax_certificate_file metafield...`);
          const metafield = {
            namespace: "custom",
            key: "tax_certificate",
            value: fileUrls.taxCertificate,
            type: "url",
          };
          console.log(`   URL: ${metafield.value}`);
          metafieldPromises.push(
            addMetafieldWithLogging(customerId, metafield, "tax_certificate")
          );
        }

        // Wait for all metafields to be added
        const results = await Promise.allSettled(metafieldPromises);

        console.log("\n📊 Metafield Creation Results:");
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            console.log(`   ✅ Metafield ${index + 1}: SUCCESS`);
          } else {
            console.log(
              `   ❌ Metafield ${index + 1}: FAILED - ${result.reason}`
            );
          }
        });
      }

      // Invalidate cache for this email/phone
      await invalidateCustomerCache(email, phone);

      // Clean up uploaded files (optional - or keep them for admin review)
      if (req.files) {
        Object.values(req.files).forEach((fileArray) => {
          fileArray.forEach((file) => {
            fs.unlinkSync(file.path);
          });
        });
      }

      res.json({
        success: true,
        message: "Registration successful! Your account is pending approval.",
        customerId: shopifyResponse.data.customer.id,
      });
    } catch (error) {
      console.error(
        "Registration error:",
        error.response?.data || error.message
      );

      let errorMessage = "Registration failed. Please try again.";

      if (error.response?.data?.errors) {
        const errors = error.response.data.errors;
        if (errors.phone) {
          errorMessage = "This phone number is already registered.";
        } else if (errors.email) {
          errorMessage = "This email address is already registered.";
        } else {
          errorMessage = Object.values(errors).flat().join(", ");
        }
      }

      res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }
  }
);
// Helper function to add metafield with detailed logging
async function addMetafieldWithLogging(customerId, metafield, displayName) {
  try {
    console.log(`\n🚀 Attempting to add ${displayName}...`);
    console.log(`   Customer ID: ${customerId}`);
    console.log(`   Namespace: ${metafield.namespace}`);
    console.log(`   Key: ${metafield.key}`);
    console.log(`   Type: ${metafield.type}`);
    console.log(`   Value: ${metafield.value}`);

    const response = await axios.post(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers/${customerId}/metafields.json`,
      { metafield },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ ${displayName} metafield added successfully!`);
    console.log(`   Response ID: ${response.data.metafield?.id}`);
    console.log(`   Response Value: ${response.data.metafield?.value}`);

    return response.data;
  } catch (error) {
    console.error(`❌ FAILED to add ${displayName} metafield:`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Status: ${error.response?.status}`);
    console.error(
      `   Response:`,
      JSON.stringify(error.response?.data, null, 2)
    );
    throw new Error(`Failed to add ${displayName}: ${error.message}`);
  }
}

// TEST ENDPOINT - Remove after testing
app.get("/test-email", async (req, res) => {
  const success = await sendEmail({
    to: "depileveusa@gmail.com",
    subject: "🎉 SendGrid Test - It Works!",
    html: "<h1>Success!</h1><p>SendGrid is configured correctly and ready to send emails.</p>",
  });

  res.json({
    success,
    message: success
      ? "Email sent! Check your inbox."
      : "Email failed. Check console.",
  });
});

// ========== ADMIN DASHBOARD ENDPOINTS ==========

// Serve admin dashboard HTML
app.use(express.static("public"));

app.get("/admin", (req, res) => {
  res.sendFile(__dirname + "/public/admin-dashboard.html");
});

// ========== CHECK LOGIN STATUS (Block Pending Customers) ==========
app.post("/api/check-login-status", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    // Search for customer by email
    const response = await axios.get(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(
        email
      )}`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.customers.length === 0) {
      return res.json({
        canLogin: false,
        reason: "no_account",
        message: "No account found with this email.",
      });
    }

    const customer = response.data.customers[0];
    const tags = customer.tags.split(", ");

    // Check if pending approval
    if (tags.includes("pending-approval")) {
      return res.json({
        canLogin: false,
        reason: "pending_approval",
        message:
          "Your account is pending approval. You'll receive an email once your account has been reviewed.",
        customerName: customer.first_name,
      });
    }

    // Check if rejected
    if (tags.includes("rejected")) {
      return res.json({
        canLogin: false,
        reason: "rejected",
        message:
          "Your application was not approved. Please contact support for more information.",
      });
    }

    // Can login
    return res.json({
      canLogin: true,
      message: "Login allowed",
      customerType: tags.includes("pro-pricing") ? "professional" : "consumer",
    });
  } catch (error) {
    console.error("❌ Error checking login status:", error.message);
    res.status(500).json({
      error: "Failed to check status",
      canLogin: false,
    });
  }
});

// ========== GET ALL PENDING APPROVALS ==========

// ========== OPTIMIZED: GET PENDING CUSTOMERS WITH PAGINATION (REST API) ==========
app.get("/api/admin/pending-approvals", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const filter = req.query.filter || "pending";

    const cacheKey = `admin:pending-approvals:${page}:${limit}:${filter}`;

    if (REDIS_ENABLED && redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          console.log(`💾 Returning cached page ${page} (filter: ${filter})`);
          return res.json(cached);
        }
      } catch (cacheError) {
        console.error("⚠️ Redis cache read error:", cacheError.message);
      }
    }

    console.log(
      `🔄 Fetching customers from Shopify (page ${page}, filter ${filter})`
    );

    let tagFilter;
    switch (filter) {
      case "pending":
        tagFilter = "pending-approval";
        break;
      case "approved":
        tagFilter = "pro-pricing";
        break;
      case "rejected":
        tagFilter = "rejected";
        break;
      default:
        tagFilter = null;
    }

    let allCustomers = [];
    let hasMore = true;
    let since_id = null;
    let pageCount = 0;

    while (hasMore && pageCount < 5) {
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
      pageCount++;

      if (customers.length === 250) {
        since_id = customers[customers.length - 1].id;
      } else {
        hasMore = false;
      }

      if (allCustomers.length >= 250) hasMore = false;
    }

    let filteredCustomers = allCustomers;
    if (tagFilter) {
      filteredCustomers = allCustomers.filter((c) =>
        c.tags.split(", ").includes(tagFilter)
      );
    }

    const totalCount = filteredCustomers.length;
    const totalPages = Math.ceil(totalCount / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

    console.log(
      `📄 Page ${page}/${totalPages}: ${paginatedCustomers.length} customers`
    );

    // Fetch metafields using REST API (proven method)
    const customersWithDetails = [];

    for (let i = 0; i < paginatedCustomers.length; i++) {
      const customer = paginatedCustomers[i];

      try {
        // Add delay to respect rate limits
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }

        const metafieldsResponse = await axios.get(
          `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers/${customer.id}/metafields.json`,
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        const metafields = metafieldsResponse.data.metafields;
        const licenseUrl = metafields.find(
          (m) => m.key === "license_file"
        )?.value;
        const studentProofUrl = metafields.find(
          (m) => m.key === "student_proof_file"
        )?.value;
        const taxCertUrl = metafields.find(
          (m) => m.key === "tax_certificate"
        )?.value;

        customersWithDetails.push({
          id: customer.id,
          firstName: customer.first_name,
          lastName: customer.last_name,
          email: customer.email,
          phone: customer.phone,
          createdAt: customer.created_at,
          tags: customer.tags.split(", "),
          note: customer.note,
          accountType: customer.tags.includes("esthetician")
            ? "esthetician"
            : customer.tags.includes("salon")
            ? "salon"
            : customer.tags.includes("student")
            ? "student"
            : customer.tags.includes("consumer")
            ? "consumer"
            : "unknown",
          files: {
            license: licenseUrl,
            studentProof: studentProofUrl,
            taxCertificate: taxCertUrl,
          },
        });

        console.log(
          `✅ Fetched metafields ${i + 1}/${paginatedCustomers.length}: ${
            customer.email
          }`
        );
      } catch (err) {
        console.error(
          `⚠️ Error fetching metafields for customer ${customer.id}:`,
          err.message
        );

        customersWithDetails.push({
          id: customer.id,
          firstName: customer.first_name,
          lastName: customer.last_name,
          email: customer.email,
          phone: customer.phone,
          createdAt: customer.created_at,
          tags: customer.tags.split(", "),
          note: customer.note,
          accountType: customer.tags.includes("esthetician")
            ? "esthetician"
            : customer.tags.includes("salon")
            ? "salon"
            : customer.tags.includes("student")
            ? "student"
            : customer.tags.includes("consumer")
            ? "consumer"
            : "unknown",
          files: {},
        });
      }
    }

    const result = {
      success: true,
      customers: customersWithDetails,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };

    if (REDIS_ENABLED && redisClient) {
      try {
        await redisClient.set(cacheKey, result, { ex: 120 });
        console.log(`✅ Cached page ${page} for 2 minutes`);
      } catch (cacheError) {
        console.error("⚠️ Cache write error:", cacheError.message);
      }
    }

    console.log(
      `🎉 Successfully returned page ${page} with ${customersWithDetails.length} customers`
    );
    res.json(result);
  } catch (error) {
    console.error("❌ Error fetching customers:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customers",
      details: error.message,
    });
  }
});

// ========== APPROVE/REJECT CUSTOMER ==========
app.post("/api/admin/update-customer-status", async (req, res) => {
  try {
    const { customerId, action, reason } = req.body;

    if (!customerId || !action) {
      return res.status(400).json({ error: "Customer ID and action required" });
    }

    // Get current customer
    const getCustomer = await axios.get(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers/${customerId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const customer = getCustomer.data.customer;
    const currentTags = customer.tags.split(", ").filter((tag) => tag !== "");

    let newTags;
    let emailHtml;
    let emailSubject;

    // Determine account type
    const accountType = currentTags.includes("esthetician")
      ? "esthetician"
      : currentTags.includes("salon")
      ? "salon"
      : currentTags.includes("student")
      ? "student"
      : "consumer";

    if (action === "approve") {
      // Remove pending-approval, add pro-pricing
      newTags = currentTags
        .filter((tag) => tag !== "pending-approval")
        .concat(["pro-pricing"]);

      console.log(`✅ Approving customer: ${customer.email}`);

      // Use your beautiful approval email template
      emailHtml = emailTemplates.getApprovalEmail(
        customer.first_name,
        accountType,
        SHOPIFY_SHOP
      );
    } else if (action === "reject") {
      // Remove pending-approval, add rejected
      newTags = currentTags
        .filter((tag) => tag !== "pending-approval")
        .concat(["rejected"]);

      console.log(`❌ Rejecting customer: ${customer.email}`);

      // Use your beautiful rejection email template
      emailHtml = emailTemplates.getRejectionEmail(
        customer.first_name,
        reason,
        "depileveusa@gmail.com"
      );
    }

    // Update customer tags in Shopify
    const updateResponse = await axios.put(
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

    // Send email using your template
    await sendEmail({
      to: customer.email,
      subject: emailSubject,
      html: emailHtml,
    });

    // OPTIMIZATION: Clear all cached pages
    if (REDIS_ENABLED && redisClient) {
      try {
        const keys = await redisClient.keys("admin:pending-approvals:*");
        if (keys && keys.length > 0) {
          await Promise.all(keys.map((key) => redisClient.del(key)));
          console.log(`🗑️ Cleared ${keys.length} cached pages`);
        }
      } catch (cacheError) {
        console.error("⚠️ Error clearing cache:", cacheError.message);
      }
    }

    res.json({
      success: true,
      message: action === "approve" ? "Customer approved" : "Customer rejected",
      customer: updateResponse.data.customer,
    });
  } catch (error) {
    console.error("❌ Error updating customer:", error.message);
    res.status(500).json({
      error: "Failed to update customer",
      details: error.message,
    });
  }
});

// ========== GET ADMIN STATS ==========
app.get("/api/admin/stats", async (req, res) => {
  try {
    const response = await axios.get(
      `https://${SHOPIFY_SHOP}/admin/api/2024-10/customers.json?limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const customers = response.data.customers;

    const stats = {
      total: customers.length,
      pending: customers.filter((c) => c.tags.includes("pending-approval"))
        .length,
      approved: customers.filter((c) => c.tags.includes("pro-pricing")).length,
      rejected: customers.filter((c) => c.tags.includes("rejected")).length,
      consumers: customers.filter((c) => c.tags.includes("consumer")).length,
      estheticians: customers.filter(
        (c) => c.tags.includes("esthetician") && c.tags.includes("pro-pricing")
      ).length,
      salons: customers.filter(
        (c) => c.tags.includes("salon") && c.tags.includes("pro-pricing")
      ).length,
      students: customers.filter(
        (c) => c.tags.includes("student") && c.tags.includes("pro-pricing")
      ).length,
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error("❌ Error fetching stats:", error.message);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Redis caching: ${REDIS_ENABLED ? "ENABLED ✅" : "DISABLED ⚠️"}`);
});
