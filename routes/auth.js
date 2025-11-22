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
    res.status(500).send("OAuth initialization failed: " + error.message);
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

    console.log(`✅ OAuth successful for shop: ${session.shop}`);

    // Redirect to app
    res.send(`
      <html>
        <head><title>Installation Successful</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>✅ App Installed Successfully!</h1>
          <p>Wholesale Harmony has been installed on ${session.shop}</p>
          <p><a href="https://${session.shop}/admin/apps">Return to your store</a></p>
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
