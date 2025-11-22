const express = require("express");
const router = express.Router();
const { shopifyApi, ApiVersion } = require("@shopify/shopify-api");
const { restResources } = require("@shopify/shopify-api/rest/admin/2024-10");
require("@shopify/shopify-api/adapters/node");
const Session = require("../sessionModel");

// Configure session storage
const sessionStorage = {
  async storeSession(session) {
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
    return true;
  },

  async loadSession(id) {
    const session = await Session.findOne({ shop: id });
    if (!session) return undefined;

    return {
      id: session.shop,
      shop: session.shop,
      state: session.shop,
      isOnline: session.isOnline,
      scope: session.scope,
      expires: session.expiresAt,
      accessToken: session.accessToken,
    };
  },

  async deleteSession(id) {
    await Session.deleteOne({ shop: id });
    return true;
  },
};

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(","),
  hostName: process.env.SHOPIFY_APP_URL.replace(/https?:\/\//, ""),
  hostScheme: "https",
  apiVersion: ApiVersion.October24,
  isEmbeddedApp: false,
  restResources,
  sessionStorage,
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

    // Build auth URL manually to avoid cookie issues
    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${
      process.env.SHOPIFY_API_KEY
    }&scope=${process.env.SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(
      process.env.SHOPIFY_APP_URL + "/api/auth/callback"
    )}&state=${shop}`;

    console.log(`🔐 Starting OAuth for ${shop}`);
    console.log(`Redirect URL: ${authUrl}`);

    res.redirect(authUrl);
  } catch (error) {
    console.error("OAuth start error:", error);
    res.status(500).send("OAuth initialization failed: " + error.message);
  }
});

// ========== OAUTH CALLBACK ==========
router.get("/auth/callback", async (req, res) => {
  try {
    const { code, shop, state } = req.query;

    if (!code || !shop) {
      throw new Error("Missing required OAuth parameters");
    }

    console.log(`✅ OAuth callback received for ${shop}`);

    // Exchange code for access token manually
    const axios = require("axios");
    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code: code,
      }
    );

    const { access_token, scope } = tokenResponse.data;

    // Save to database
    await Session.findOneAndUpdate(
      { shop },
      {
        shop,
        accessToken: access_token,
        scope: scope,
        isOnline: false,
      },
      { upsert: true, new: true }
    );

    console.log(`✅ OAuth successful! Token saved for ${shop}`);

    res.send(`
      <html>
        <head><title>Installation Successful</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>✅ OAuth Token Updated Successfully!</h1>
          <p>Your new access token has been saved for ${shop}</p>
          <p><strong>You can now close this window and check your customers page.</strong></p>
          <p><a href="https://${shop}/admin">Return to Shopify Admin</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send("OAuth failed: " + error.message);
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
