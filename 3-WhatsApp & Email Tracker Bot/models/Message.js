// models/Message.js
const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({

  // ---------------------------------------------------------
  // SOURCE TYPE
  // ---------------------------------------------------------
  type: {
    type: String,
    enum: ["whatsapp", "email"],
    // required: true
  },

  // ---------------------------------------------------------
  // COMMON FIELDS (for BOTH WhatsApp & Email)
  // ---------------------------------------------------------
  senderName: String,
  company: String,
  originalContent: String,    // raw WhatsApp or raw email content

  // ---------------------------------------------------------
  // WHATSAPP SPECIFIC
  // ---------------------------------------------------------
  messageId: { type: String, index: true },
  groupId: String,
  groupName: String,
  senderNumber: String,

  // ---------------------------------------------------------
  // EMAIL SPECIFIC
  // ---------------------------------------------------------
  emailId: { type: String, index: true },
  senderEmail: String,

  // ---------------------------------------------------------
  // AI EXTRACTED MULTIPLE RECORDS (ARRAY)
  // ---------------------------------------------------------
  aiExtracted: [
    {
      loading_country: String,
      loading_city: String,
      loading_postcode: String,
      loading_lat: Number,
      loading_lng: Number,

      delivery_country: String,
      delivery_city: String,
      delivery_postcode: String,
      delivery_lat: Number,
      delivery_lng: Number,

      price: Number,
      comments: String
    }
  ],

  // ---------------------------------------------------------
  // EXPIRATION
  // ---------------------------------------------------------
  expirationDate: Date,

  // ---------------------------------------------------------
  // SYSTEM
  // ---------------------------------------------------------
  status: { type: String, default: "new" },

  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date, default: null }

});

module.exports = mongoose.model("Message", MessageSchema);
