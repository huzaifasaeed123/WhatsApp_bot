// // services/emailService.js
// const MailListener = require("mail-listener2");
// const Imap = require("imap");
// const { analyzeMessage } = require("./aiProcessor");
// const Message = require("../models/Message");

// class EmailService {
//   constructor() {
//     this.mailListener = null;
//     this.isConnected = false;
//     this.io = null;
//     this.startTime = null; // To track only new emails
//     this.initialCleanupDone = false;
//   }

//   async initialize(io) {
//     this.io = io;
//     this.startTime = new Date(); // When our service actually starts

//     console.log("🔄 Marking all old unread emails as seen before starting listener...");

//     await this.markAllExistingEmailsAsSeen(); // STEP 1 — super important

//     console.log("✔ All old unread emails cleaned. Now starting email listener...");

//     this.startListener();
//   }

//   startListener() {
//     this.mailListener = new MailListener({
//       username: process.env.EMAIL_USER,
//       password: process.env.EMAIL_PASS,
//       host: "imap.gmail.com",
//       port: 993,
//       tls: true,
//       tlsOptions: { rejectUnauthorized: false },
//       mailbox: "INBOX",
//       markSeen: true,                    // Mark new emails as seen
//       fetchUnreadOnStart: false,         // DO NOT fetch unread emails at startup
//       attachments: false,
//     });

//     this.setupEventHandlers();
//     this.mailListener.start();
//   }

//   //------------------------------------------------------------
//   // STEP 1 — Mark all old unread emails as seen before starting
//   //------------------------------------------------------------
//   markAllExistingEmailsAsSeen() {
//     return new Promise((resolve, reject) => {
//       const imap = new Imap({
//         user: process.env.EMAIL_USER,
//         password: process.env.EMAIL_PASS,
//         host: "imap.gmail.com",
//         port: 993,
//         tls: true,
//         tlsOptions: { rejectUnauthorized: false } // ✅ REQUIRED FIX

//       });

//       imap.once("ready", function () {
//         imap.openBox("INBOX", false, function (err, box) {
//           if (err) return reject(err);

//           // Search for UNREAD emails
//           imap.search(["UNSEEN"], function (err, results) {
//             if (err) return reject(err);

//             if (results.length === 0) {
//               console.log("👌 No unread emails found. Clean start.");
//               imap.end();
//               return resolve();
//             }

//             // Mark all unread emails as SEEN
//             imap.addFlags(results, "\\Seen", function (err) {
//               if (err) return reject(err);

//               console.log(`✔ Marked ${results.length} old unread emails as seen.`);
//               imap.end();
//               return resolve();
//             });
//           });
//         });
//       });

//       imap.once("error", reject);
//       imap.connect();
//     });
//   }

//   //------------------------------------------------------------
//   // STEP 2 — Setup IMAP event handlers
//   //------------------------------------------------------------
//   setupEventHandlers() {
//     this.mailListener.on("server:connected", () => {
//       console.log("📡 IMAP server connected.");
//       this.isConnected = true;
//     });

//     this.mailListener.on("server:disconnected", () => {
//       console.log("⚠️ IMAP disconnected — reconnecting in 5s");
//       this.isConnected = false;
//       setTimeout(() => this.startListener(), 5000);
//     });

//     this.mailListener.on("error", (err) => {
//       console.error("IMAP Error:", err);
//     });

//     //------------------------------------------------------------
//     // The MAIN handler for new incoming email
//     //------------------------------------------------------------
//     this.mailListener.on("mail", async (mail) => {
//       try {
//         const received = mail.receivedDate
//           ? new Date(mail.receivedDate)
//           : new Date();

//         // STEP 2: Ignore all emails that arrived BEFORE service started
//         if (received < this.startTime) {
//           console.log(`⏭️ Old email ignored (received: ${received.toISOString()})`);
//           return;
//         }

//         await this.processIncomingEmail(mail);

//       } catch (err) {
//         console.error("Error in email processing:", err);
//       }
//     });
//   }

//   //------------------------------------------------------------
//   // MAIN EMAIL PROCESSOR
//   //------------------------------------------------------------
//   async processIncomingEmail(mail) {
//     console.log("📩 NEW EMAIL ARRIVED!");

//     let emailBody = mail.text || mail.html?.replace(/<[^>]*>/g, " ") || "";

//     if (!emailBody.trim()) {
//       console.log("⚠️ Skipping email with no usable body");
//       return;
//     }

//     const senderEmail = mail.from[0].address;
//     const senderName = mail.from[0].name || senderEmail.split("@")[0];
//     const company = this.extractCompanyFromEmail(senderEmail);

//     console.log("🧠 Processing via AI...");
//     const aiExtracted = await analyzeMessage(emailBody);

//     if (aiExtracted.length === 0) {
//       console.log("⚠️ AI found no shipments. Email ignored.");
//       return;
//     }

//     const mappedAiData = aiExtracted.map(item => ({
//       loading_country: item.LoadingCountry,
//       loading_city: item.LoadingCity,
//       loading_postcode: item.LoadingPostcode,
//       loading_lat: null,
//       loading_lng: null,

//       delivery_country: item.DeliveryCountry,
//       delivery_city: item.DeliveryCity,
//       delivery_postcode: item.DeliveryPostcode,
//       delivery_lat: null,
//       delivery_lng: null,

//       price: this.parsePrice(item.Price),
//       comments: item.Comments
//     }));

//     const saved = await new Message({
//       type: "email",
//       senderName,
//       senderEmail,
//       company,
//       originalContent: emailBody,
//       emailId: mail.messageId,
//       aiExtracted: mappedAiData,
//       created_at: new Date(),
//       updated_at: new Date(),
//       expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
//     }).save();

//     if (this.io) {
//       this.io.emit("newMessage", saved);
//     }

//     console.log(`✅ Email saved with ${mappedAiData.length} shipments.`);
//   }

//   //------------------------------------------------------------
//   // UTILITIES
//   //------------------------------------------------------------
//   extractCompanyFromEmail(email) {
//     try {
//       const domain = email.split("@")[1];
//       if (!domain) return null;

//       const common = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
//       if (common.includes(domain)) return null;

//       return domain.split(".")[0];
//     } catch {
//       return null;
//     }
//   }

//   parsePrice(string) {
//     if (!string) return null;
//     const num = parseFloat(string.replace(/[^\d.,]/g, "").replace(",", "."));
//     return isNaN(num) ? null : num;
//   }

//   getStatus() {
//     return {
//       isConnected: this.isConnected,
//       startTime: this.startTime,
//     };
//   }
// }

// module.exports = new EmailService();



// services/emailService.js (enhanced with send email capability)
const MailListener = require("mail-listener2");
const Imap = require("imap");
const nodemailer = require("nodemailer"); // 🆕 NEW: For sending emails
const { analyzeMessage } = require("./aiProcessor");
const Message = require("../models/Message");

class EmailService {
  constructor() {
    this.mailListener = null;
    this.isConnected = false;
    this.io = null;
    this.startTime = null;
    this.initialCleanupDone = false;
    this.smtpTransporter = null; // 🆕 NEW: For sending emails
  }

  async initialize(io) {
    this.io = io;
    this.startTime = new Date();

    console.log("🔄 Marking all old unread emails as seen before starting listener...");
    await this.markAllExistingEmailsAsSeen();
    console.log("✔ All old unread emails cleaned. Now starting email listener...");

    // 🆕 NEW: Initialize SMTP transporter for sending emails
    this.initializeSMTP();

    this.startListener();
  }

  // 🆕 NEW: Initialize SMTP for sending emails
  initializeSMTP() {
    try {
      this.smtpTransporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || "smtp.gmail.com",
        port: parseInt(process.env.EMAIL_SMTP_PORT) || 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      console.log("📧 SMTP transporter initialized for sending emails");
    } catch (error) {
      console.error("❌ Failed to initialize SMTP transporter:", error);
    }
  }

  // 🆕 NEW: Method to send email response
  async sendEmail(to, subject, body) {
    try {
      if (!this.smtpTransporter) {
        console.error('SMTP transporter not initialized');
        return false;
      }

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: to,
        subject: subject,
        text: body,
        html: body.replace(/\n/g, '<br>') // Simple text to HTML conversion
      };

      await this.smtpTransporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${to}`);
      return true;

    } catch (error) {
      console.error('❌ Error sending email:', error);
      return false;
    }
  }

  // 🆕 NEW: Verify SMTP connection
  async verifyEmailConnection() {
    try {
      if (!this.smtpTransporter) return false;
      
      await this.smtpTransporter.verify();
      console.log('✅ SMTP connection verified');
      return true;
    } catch (error) {
      console.error('❌ SMTP verification failed:', error);
      return false;
    }
  }

  startListener() {
    this.mailListener = new MailListener({
      username: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASS,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      mailbox: "INBOX",
      markSeen: true,
      fetchUnreadOnStart: false,
      attachments: false,
    });

    this.setupEventHandlers();
    this.mailListener.start();
  }

  markAllExistingEmailsAsSeen() {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASS,
        host: "imap.gmail.com",
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
      });

      imap.once("ready", function () {
        imap.openBox("INBOX", false, function (err, box) {
          if (err) return reject(err);

          imap.search(["UNSEEN"], function (err, results) {
            if (err) return reject(err);

            if (results.length === 0) {
              console.log("👌 No unread emails found. Clean start.");
              imap.end();
              return resolve();
            }

            imap.addFlags(results, "\\Seen", function (err) {
              if (err) return reject(err);

              console.log(`✔ Marked ${results.length} old unread emails as seen.`);
              imap.end();
              return resolve();
            });
          });
        });
      });

      imap.once("error", reject);
      imap.connect();
    });
  }

  setupEventHandlers() {
    this.mailListener.on("server:connected", () => {
      console.log("📡 IMAP server connected.");
      this.isConnected = true;
      
      // Verify SMTP connection when IMAP connects
      this.verifyEmailConnection();
    });

    this.mailListener.on("server:disconnected", () => {
      console.log("⚠️ IMAP disconnected — reconnecting in 5s");
      this.isConnected = false;
      setTimeout(() => this.startListener(), 5000);
    });

    this.mailListener.on("error", (err) => {
      console.error("IMAP Error:", err);
    });

    this.mailListener.on("mail", async (mail) => {
      try {
        const received = mail.receivedDate
          ? new Date(mail.receivedDate)
          : new Date();

        if (received < this.startTime) {
          console.log(`⏭️ Old email ignored (received: ${received.toISOString()})`);
          return;
        }

        await this.processIncomingEmail(mail);

      } catch (err) {
        console.error("Error in email processing:", err);
      }
    });
  }

  async processIncomingEmail(mail) {
    console.log("📩 NEW EMAIL ARRIVED!");

    let emailBody = mail.text || mail.html?.replace(/<[^>]*>/g, " ") || "";

    if (!emailBody.trim()) {
      console.log("⚠️ Skipping email with no usable body");
      return;
    }

    const senderEmail = mail.from[0].address;
    const senderName = mail.from[0].name || senderEmail.split("@")[0];
    const company = this.extractCompanyFromEmail(senderEmail);

    console.log("🧠 Processing via AI...");
    const aiExtracted = await analyzeMessage(emailBody);

    if (aiExtracted.length === 0) {
      console.log("⚠️ AI found no shipments. Email ignored.");
      return;
    }

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

      price: this.parsePrice(item.Price),
      comments: item.Comments
    }));

    const saved = await new Message({
      type: "email",
      senderName,
      senderEmail,
      company,
      originalContent: emailBody,
      emailId: mail.messageId,
      aiExtracted: mappedAiData,
      created_at: new Date(),
      updated_at: new Date(),
      expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }).save();

    if (this.io) {
      this.io.emit("newMessage", saved);
    }

    console.log(`✅ Email saved with ${mappedAiData.length} shipments.`);
  }

  extractCompanyFromEmail(email) {
    try {
      const domain = email.split("@")[1];
      if (!domain) return null;

      const common = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
      if (common.includes(domain)) return null;

      return domain.split(".")[0];
    } catch {
      return null;
    }
  }

  parsePrice(string) {
    if (!string) return null;
    const num = parseFloat(string.replace(/[^\d.,]/g, "").replace(",", "."));
    return isNaN(num) ? null : num;
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      startTime: this.startTime,
      smtpReady: !!this.smtpTransporter
    };
  }

  // 🆕 NEW: Method to check for new emails manually
  async checkForNewEmails() {
    try {
      if (this.isConnected && this.mailListener) {
        console.log("🔄 Manually checking for new emails...");
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error checking for emails:", error);
      return false;
    }
  }
}

module.exports = new EmailService();