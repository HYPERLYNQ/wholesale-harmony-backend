const express = require("express");
const router = express.Router();
const {
  shopifyApi,
  ApiVersion,
  LATEST_API_VERSION,
} = require("@shopify/shopify-api");
const { restResources } = require("@shopify/shopify-api/rest/admin/2024-10");
require("@shopify/shopify-api/adapters/node");
const Session = require("../sessionModel");

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(","),
  hostName: process.env.SHOPIFY_APP_URL.replace(/https?:\/\//, ""),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false,
  restResources,
});

// ========== OAUTH START ==========
router.get("/auth", async (req, res) => {
  try {
    const { shop } = req.query;

    if (!shop) {
      return res.status(400).send("Missing shop parameter");
    }

    // Validate shop format
    const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
    if (!shopRegex.test(shop)) {
      return res.status(400).send("Invalid shop parameter");
    }

    const authRoute = await shopify.auth.begin({
      shop,
      callbackPath: "/api/auth/callback",
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });

    res.redirect(authRoute);
  } catch (error) {
    console.error("OAuth start error:", error);
    res.status(500).send("OAuth initialization failed");
  }
});

// ========== OAUTH CALLBACK ==========
router.get("/auth/callback", async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;

    // Save session to MongoDB
    await Session.findOneAndUpdate(
      { shop: session.shop },
      {
        shop: session.shop,
        accessToken: session.accessToken,
        scope: session.scope,
        isOnline: session.isOnline,
        expiresAt: session.expires,
      },
      { upsert: true, new: true }
    );

    console.log(`✅ OAuth successful for shop: ${session.shop}`);

    // Redirect to app (you can change this to your admin dashboard)
    res.redirect(`https://${session.shop}/admin/apps`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send("OAuth failed");
  }
});

// ========== GET ACCESS TOKEN FOR SHOP ==========
async function getAccessToken(shop) {
  const session = await Session.findOne({ shop });
  if (!session) {
    throw new Error(`No session found for shop: ${shop}`);
  }
  return session.accessToken;
}

module.exports = { router, getAccessToken, shopify };
