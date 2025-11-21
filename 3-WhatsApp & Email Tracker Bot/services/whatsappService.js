// services/whatsappService.js (updated to align with new Message model)
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const Message = require("../models/Message");
const TrackedGroup = require("../models/TrackedGroup");
const { analyzeMessage } = require('./aiProcessor'); // import AI service

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.qrCode = null;

    // in-memory cache: messageId -> savedMessageMongoId
    this.msgCache = new Map();
    // optional: limit cache size
    this.maxCacheSize = 5000;
  }

  async saveIncomingMessage(msg, chat, io) {
    const messageId = msg.id && msg.id._serialized ? msg.id._serialized : null;

    // 🧠 Step 1: Extract sender info (number + name)
    let senderNumber = null;
    let senderName = null;

    try {
      const contact = await msg.getContact();
      senderNumber = contact.number || msg.author?.replace(/@.*/, '') || msg.from?.replace(/@.*/, '');
      senderName = contact.pushname || contact.name || msg._data?.notifyName || senderNumber;
    } catch (err) {
      console.warn('Error fetching contact info:', err);
      senderNumber = msg.author?.replace(/@.*/, '') || msg.from?.replace(/@.*/, '');
      senderName = msg._data?.notifyName || senderNumber;
    }

    // 🧠 Step 2: AI processing (extract logistics info)
    let aiExtracted = [];
    try {
      aiExtracted = await analyzeMessage(msg.body);
    } catch (err) {
      console.error('AI processing failed:', err);
    }

    // 🧠 Step 3: Create message document with updated model structure
    const dbDoc = new Message({
      // Source type
      type: "whatsapp",
      
      // Common fields
      senderName,
      company: null, // Will be extracted later if needed
      originalContent: msg.body,
      
      // WhatsApp specific fields
      messageId,
      groupId: chat.id._serialized,
      groupName: chat.name,
      senderNumber,
      
      // Email specific fields (null for WhatsApp)
      emailId: null,
      senderEmail: null,
      
      // AI extracted data with new field structure
      aiExtracted: aiExtracted.map(item => ({
        loading_country: item.LoadingCountry,
        loading_city: item.LoadingCity,
        loading_postcode: item.LoadingPostcode,
        loading_lat: null, // Will be populated later if geocoding is added
        loading_lng: null,
        
        delivery_country: item.DeliveryCountry,
        delivery_city: item.DeliveryCity,
        delivery_postcode: item.DeliveryPostcode,
        delivery_lat: null,
        delivery_lng: null,
        
        price: item.Price ? parseFloat(item.Price.replace(/[^\d.,]/g, '').replace(',', '.')) : null,
        comments: item.Comments
      })),
      
      // Set expiration date (24 hours from now)
      expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      
      // System fields
      status: "new",
      isDeleted: false,
      created_at: new Date(msg.timestamp * 1000),
      updated_at: new Date()
    });

    const saved = await dbDoc.save();

    // 🧠 Step 4: Cache message for revoke tracking
    if (messageId) {
      this.msgCache.set(messageId, saved._id.toString());
      if (this.msgCache.size > this.maxCacheSize) {
        const firstKey = this.msgCache.keys().next().value;
        this.msgCache.delete(firstKey);
      }
    }

    // 🧠 Step 5: Emit message + AI result to frontend with updated structure
    io.emit('newMessage', {
      _id: saved._id,
      type: saved.type,
      messageId,
      groupName: chat.name,
      senderNumber,
      senderName,
      originalContent: msg.body,
      aiExtracted: saved.aiExtracted, // Send processed AI data
      created_at: saved.created_at,
      status: saved.status
    });

    return saved;
  }

  initialize(io) {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    this.client.on("qr", async (qr) => {
      console.log("QR Code received");
      this.qrCode = await qrcode.toDataURL(qr);
      io.emit("qr", this.qrCode);
    });

    this.client.on("ready", () => {
      console.log("WhatsApp Client is ready!");
      this.isReady = true;
      io.emit("ready", { message: "WhatsApp connected successfully!" });
    });

    // Incoming messages
    this.client.on("message", async (msg) => {
      try {
        const chat = await msg.getChat();

        if (!chat.isGroup) return;

        const trackedGroup = await TrackedGroup.findOne({
          groupId: chat.id._serialized,
          isActive: true,
        });

        if (!trackedGroup) return;

        await this.saveIncomingMessage(msg, chat, io);
        console.log(`Message saved from ${chat.name}`);
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    // Handle revoke/delete for everyone
    this.client.on("message_revoke_everyone", async (after, before) => {
      try {
        // Determine messageId: try 'before' first (contains original), else try 'after'
        let messageId = null;
        let deletedBy = null;

        if (before && before.id && before.id._serialized) {
          messageId = before.id._serialized;
          deletedBy = before.author || before.participant || null;
        } else if (after && after.id && after.id._serialized) {
          messageId = after.id._serialized;
          deletedBy = after.author || after.participant || null;
        } else if (after && after.key && after.key.id) {
          messageId = after.key.id;
        }

        if (!messageId) {
          console.warn("Revoke event without messageId:", { after, before });
          return;
        }

        // Try cache first
        let savedDocId = this.msgCache.get(messageId);
        let msgDoc = null;
        
        if (savedDocId) {
          msgDoc = await Message.findById(savedDocId);
        } else {
          msgDoc = await Message.findOne({ messageId });
        }

        if (msgDoc) {
          msgDoc.isDeleted = true;
          msgDoc.deletedAt = new Date();
          msgDoc.deleted_at = new Date(); // Updated field name
          if (deletedBy) msgDoc.deletedBy = deletedBy;
          
          await msgDoc.save();

          // notify frontend to update UI
          io.emit("messageDeleted", {
            _id: msgDoc._id,
            messageId,
            deletedAt: msgDoc.deletedAt,
            deletedBy: msgDoc.deletedBy,
          });

          console.log("Message marked deleted in DB for messageId:", messageId);
        }
      } catch (err) {
        console.error("Error handling message_revoke_everyone:", err);
      }
    });

    this.client.on("disconnected", (reason) => {
      console.log("Client was logged out:", reason);
      this.isReady = false;
      io.emit("disconnected", { reason });
    });

    this.client.initialize();
  }

  async getAllGroups() {
    if (!this.isReady) {
      throw new Error("WhatsApp client is not ready");
    }

    const chats = await this.client.getChats();
    const groups = chats.filter((chat) => chat.isGroup);

    return groups.map((group) => ({
      id: group.id._serialized,
      name: group.name,
    }));
  }

  getStatus() {
    return {
      isReady: this.isReady,
      qrCode: this.qrCode,
    };
  }
}

module.exports = new WhatsAppService();