const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    unique: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  scope: String,
  isOnline: {
    type: Boolean,
    default: false,
  },
  expiresAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
sessionSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Session", sessionSchema);
