// models/Message.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  messageId: { type: String, index: true, unique: false }, // WhatsApp message id
  groupId: String,
  groupName: String,
  senderName: String, // ✅ new field
  senderNumber: String,
  messageContent: String,       // current content (can remain or be blanked)
  originalContent: String,      // keep original text if you want to preserve it
  hasMedia: { type: Boolean, default: false },
  mediaPath: String,
  date: { type: Date, default: Date.now },

  // AI Extraction Result
  aiExtracted: { type: Array, default: [] }, // 👈 stores structured AI results
  expirationDate: Date,  // <-- new field
  // deletion tracking
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null } // who issued deletion (if available)
});

module.exports = mongoose.model('Message', MessageSchema);
