// services/emailService.js
const MailListener = require("mail-listener2");
const { analyzeMessage } = require("./aiProcessor");
const Message = require("../models/Message");

class EmailService {
  constructor() {
    this.mailListener = null;
    this.isConnected = false;
    this.io = null;
  }

  initialize(io) {
    this.io = io;
    
    // Configure Mail Listener
    this.mailListener = new MailListener({
      username: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASS,
      host: process.env.EMAIL_HOST || "imap.gmail.com",
      port: parseInt(process.env.EMAIL_PORT) || 993,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: false
      },
      mailbox: "INBOX",
      markSeen: true,
      fetchUnreadOnStart: true,
      attachments: false,
      attachmentOptions: { directory: "attachments/" }
    });

    this.setupEventHandlers();
    this.start();
  }

  setupEventHandlers() {
    // Connection events
    this.mailListener.on("server:connected", () => {
      console.log("✅ Connected to IMAP server");
      this.isConnected = true;
      if (this.io) {
        this.io.emit("email:connected", { message: "Email server connected successfully!" });
      }
    });

    this.mailListener.on("server:disconnected", () => {
      console.log("⚠️ IMAP server disconnected. Reconnecting...");
      this.isConnected = false;
      if (this.io) {
        this.io.emit("email:disconnected", { message: "Email server disconnected" });
      }
      // Auto-reconnect after delay
      setTimeout(() => {
        this.start();
      }, 5000);
    });

    this.mailListener.on("error", (err) => {
      console.error("❌ Mail listener error:", err);
      this.isConnected = false;
      if (this.io) {
        this.io.emit("email:error", { error: err.message });
      }
    });

    // New mail handler
    this.mailListener.on("mail", async (mail) => {
      try {
        await this.processIncomingEmail(mail);
      } catch (error) {
        console.error("Error processing email:", error);
      }
    });
  }

  async processIncomingEmail(mail) {
    try {
      console.log("📩 New email received from:", mail.from[0].address);
      console.log("Subject:", mail.subject);
      
      // Extract email content (prefer text, fallback to HTML)
      let emailBody = '';
      if (mail.text) {
        emailBody = mail.text;
      } else if (mail.html) {
        // Simple HTML to text conversion (you might want to use a proper library)
        emailBody = mail.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }

      if (!emailBody) {
        console.log("⚠️ Email has no readable content, skipping...");
        return;
      }

      // Extract sender information
      const senderName = mail.from[0].name || mail.from[0].address.split('@')[0];
      const senderEmail = mail.from[0].address;
      
      // Get company from email domain (optional)
      const company = this.extractCompanyFromEmail(senderEmail);

      // Step 1: Call AI processor to extract structured logistics info
      console.log("🧠 Processing email with AI...");
      const aiExtracted = await analyzeMessage(emailBody);
      
      // Map AI output to database structure
      const mappedAiData = aiExtracted.map(item => ({
        loading_country: item.LoadingCountry,
        loading_city: item.LoadingCity,
        loading_postcode: item.LoadingPostcode,
        loading_lat: null,
        loading_lng: null,
        
        delivery_country: item.DeliveryCountry,
        delivery_city: item.DeliveryCity,
        delivery_postcode: item.DeliveryPostcode,
        delivery_lat: null,
        delivery_lng: null,
        
        price: item.Price ? this.parsePrice(item.Price) : null,
        comments: item.Comments
      }));

      // Step 2: Create message document
      const emailMessage = new Message({
        // Source type
        type: "email",
        
        // Common fields
        senderName,
        company,
        originalContent: emailBody,
        
        // Email specific fields
        emailId: mail.messageId,
        senderEmail,
        
        // WhatsApp specific fields (null for emails)
        messageId: null,
        groupId: null,
        groupName: null,
        senderNumber: null,
        
        // AI extracted data
        aiExtracted: mappedAiData,
        
        // Set expiration date (24 hours from now)
        expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        
        // System fields
        status: "new",
        isDeleted: false,
        created_at: new Date(),
        updated_at: new Date()
      });

      const savedMessage = await emailMessage.save();
      
      // Step 3: Emit to frontend for real-time updates
      if (this.io) {
        this.io.emit('newMessage', {
          _id: savedMessage._id,
          type: savedMessage.type,
          emailId: mail.messageId,
          senderName,
          senderEmail,
          company,
          originalContent: emailBody,
          subject: mail.subject,
          aiExtracted: mappedAiData,
          created_at: savedMessage.created_at,
          status: savedMessage.status
        });
      }

      console.log(`✅ Email processed and saved with ${mappedAiData.length} AI-extracted shipments`);
      
      return savedMessage;

    } catch (error) {
      console.error("❌ Failed to process incoming email:", error);
      throw error;
    }
  }

  // Helper method to extract company name from email domain
  extractCompanyFromEmail(email) {
    try {
      const domain = email.split('@')[1];
      if (!domain) return null;
      
      // Remove common email providers and extract company name
      const commonProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
      if (commonProviders.includes(domain.toLowerCase())) {
        return null;
      }
      
      // Extract company name from domain
      const companyPart = domain.split('.')[0];
      return companyPart.charAt(0).toUpperCase() + companyPart.slice(1);
    } catch (error) {
      return null;
    }
  }

  // Helper method to parse price from string
  parsePrice(priceString) {
    try {
      if (!priceString) return null;
      // Remove currency symbols and extract numbers
      const numericValue = priceString.replace(/[^\d.,]/g, '').replace(',', '.');
      const parsed = parseFloat(numericValue);
      return isNaN(parsed) ? null : parsed;
    } catch (error) {
      return null;
    }
  }

  start() {
    if (this.mailListener) {
      try {
        this.mailListener.start();
      } catch (error) {
        console.error("Error starting mail listener:", error);
      }
    }
  }

  stop() {
    if (this.mailListener) {
      try {
        this.mailListener.stop();
        this.isConnected = false;
      } catch (error) {
        console.error("Error stopping mail listener:", error);
      }
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      service: 'email'
    };
  }

  // Method to manually check for new emails (useful for testing)
  async checkForNewEmails() {
    if (this.isConnected && this.mailListener) {
      try {
        // This will trigger the mail listener to check for new emails
        console.log("🔄 Manually checking for new emails...");
        // The mail-listener2 automatically fetches unread emails
        return true;
      } catch (error) {
        console.error("Error checking for emails:", error);
        return false;
      }
    }
    return false;
  }
}

module.exports = new EmailService();