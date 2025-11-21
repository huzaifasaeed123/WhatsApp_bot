const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const TrackedGroup = require('../models/TrackedGroup');
const Message = require('../models/Message');
const ExcelJS = require('exceljs');

// Show login page with both WhatsApp and Email status
exports.loginPage = (req, res) => {
  const whatsappStatus = whatsappService.getStatus();
  const emailStatus = emailService.getStatus();
  
  res.render('login', { 
    whatsappStatus,
    emailStatus
  });
};

// Show groups selection page (WhatsApp only)
exports.groupsPage = async (req, res) => {
  try {
    if (!whatsappService.isReady) {
      return res.redirect('/');
    }

    const allGroups = await whatsappService.getAllGroups();
    const trackedGroups = await TrackedGroup.find({ isActive: true });
    const trackedGroupIds = trackedGroups.map(g => g.groupId);

    res.render('groups', { 
      groups: allGroups,
      trackedGroupIds
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading groups');
  }
};

// Track selected groups (WhatsApp only)
exports.trackGroups = async (req, res) => {
  try {
    const { groupIds } = req.body;
    const selectedIds = Array.isArray(groupIds) ? groupIds : [groupIds];

    // Deactivate all groups first
    await TrackedGroup.updateMany({}, { isActive: false });

    // Get all groups to find names
    const allGroups = await whatsappService.getAllGroups();

    // Add or activate selected groups
    for (const groupId of selectedIds) {
      const group = allGroups.find(g => g.id === groupId);
      if (group) {
        await TrackedGroup.findOneAndUpdate(
          { groupId },
          { 
            groupId,
            groupName: group.name,
            isActive: true 
          },
          { upsert: true }
        );
      }
    }

    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error tracking groups');
  }
};

// Enhanced dashboard with comprehensive filtering
exports.dashboard = async (req, res) => {
  try {
    // Get service status
    const whatsappStatus = whatsappService.getStatus();
    const emailStatus = emailService.getStatus();
    const trackedGroups = await TrackedGroup.find({ isActive: true });
    
    // Get basic statistics for dashboard cards
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const [totalMessages, activeMessages, last24hMessages, totalShipments] = await Promise.all([
      Message.countDocuments({}), // All messages including deleted
      Message.countDocuments({ isDeleted: false }), // Active only
      Message.countDocuments({ 
        created_at: { $gte: twentyFourHoursAgo },
        isDeleted: false 
      }), // Last 24h active
      Message.aggregate([
        { $match: { isDeleted: false } },
        { $unwind: '$aiExtracted' },
        { $count: 'total' }
      ]).then(result => result[0]?.total || 0)
    ]);

    const stats = {
      totalMessages,
      activeMessages,
      last24hMessages,
      totalShipments,
      whatsappMessages: await Message.countDocuments({ type: 'whatsapp', isDeleted: false }),
      emailMessages: await Message.countDocuments({ type: 'email', isDeleted: false })
    };

    res.render('dashboard', { 
      trackedGroups,
      stats,
      whatsappStatus,
      emailStatus
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading dashboard');
  }
};

// API endpoint for comprehensive message filtering with pagination and search
exports.getMessages = async (req, res) => {
  try {
    const {
      type = 'all',           // all, whatsapp, email
      status = 'all',         // all, active, deleted
      timeframe = 'all',      // all, last24h, last7d, last30d
      search = '',            // search term
      page = 1,              // pagination
      limit = 100            // items per page (max 1000)
    } = req.query;

    // Build query conditions
    const query = {};
    
    // Type filter
    if (type !== 'all') {
      query.type = type;
    }
    
    // Status filter
    if (status === 'active') {
      query.isDeleted = false;
    } else if (status === 'deleted') {
      query.isDeleted = true;
    }
    // 'all' means no status filter
    
    // Timeframe filter
    const now = new Date();
    if (timeframe === 'last24h') {
      query.created_at = { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
    } else if (timeframe === 'last7d') {
      query.created_at = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    } else if (timeframe === 'last30d') {
      query.created_at = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    }
    
    // Search functionality
    if (search) {
      const searchRegex = new RegExp(search, 'i'); // Case-insensitive
      query.$or = [
        { senderName: searchRegex },
        { senderEmail: searchRegex },
        { senderNumber: searchRegex },
        { company: searchRegex },
        { groupName: searchRegex },
        { originalContent: searchRegex },
        { 'aiExtracted.loading_city': searchRegex },
        { 'aiExtracted.loading_country': searchRegex },
        { 'aiExtracted.delivery_city': searchRegex },
        { 'aiExtracted.delivery_country': searchRegex },
        { 'aiExtracted.comments': searchRegex }
      ];
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit))); // Max 1000, min 1
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalCount = await Message.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limitNum);

    // Get messages with pagination
    const messages = await Message.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(); // Use lean for better performance

    res.json({
      success: true,
      messages,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        limit: limitNum
      },
      filters: {
        type,
        status,
        timeframe,
        search
      }
    });

  } catch (error) {
    console.error('Error in getMessages:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// API endpoint to send automated response
exports.sendAutomatedResponse = async (req, res) => {
  try {
    const { messageId, template } = req.body;
    
    // Get the original message
    const originalMessage = await Message.findById(messageId);
    if (!originalMessage) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    // Build response message with offer details
    let responseText = template || "Thank you for your logistics offer. We would like to reserve the following:";
    
    if (originalMessage.aiExtracted && originalMessage.aiExtracted.length > 0) {
      responseText += "\n\n📦 OFFER DETAILS:\n";
      
      originalMessage.aiExtracted.forEach((shipment, index) => {
        responseText += `\n${index + 1}. `;
        if (shipment.loading_city || shipment.loading_country) {
          responseText += `From: ${shipment.loading_city || ''} ${shipment.loading_country || ''}`;
          if (shipment.loading_postcode) responseText += ` (${shipment.loading_postcode})`;
        }
        if (shipment.delivery_city || shipment.delivery_country) {
          responseText += ` → To: ${shipment.delivery_city || ''} ${shipment.delivery_country || ''}`;
          if (shipment.delivery_postcode) responseText += ` (${shipment.delivery_postcode})`;
        }
        if (shipment.price) {
          responseText += `\n   💰 Price: €${shipment.price}`;
        }
        if (shipment.comments) {
          responseText += `\n   📝 ${shipment.comments}`;
        }
        responseText += "\n";
      });
      
      responseText += "\nPlease confirm availability and provide further details.";
    }

    let success = false;
    let response = '';

    // Send via appropriate channel
    if (originalMessage.type === 'whatsapp' && originalMessage.senderNumber) {
      try {
        success = await whatsappService.sendMessage(originalMessage.senderNumber, responseText);
        response = success ? 'WhatsApp message sent successfully' : 'Failed to send WhatsApp message';
      } catch (error) {
        console.error('WhatsApp send error:', error);
        response = 'WhatsApp service unavailable';
      }
    } else if (originalMessage.type === 'email' && originalMessage.senderEmail) {
      try {
        success = await emailService.sendEmail(originalMessage.senderEmail, 'RE: Your Logistics Offer', responseText);
        response = success ? 'Email sent successfully' : 'Failed to send email';
      } catch (error) {
        console.error('Email send error:', error);
        response = 'Email service unavailable';
      }
    } else {
      response = 'Invalid message type or missing contact information';
    }

    res.json({
      success,
      message: response,
      sentTo: originalMessage.type === 'whatsapp' ? originalMessage.senderNumber : originalMessage.senderEmail
    });

  } catch (error) {
    console.error('Error in sendAutomatedResponse:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// API endpoint to get/update response templates
exports.getResponseTemplates = async (req, res) => {
  try {
    // For now, return default templates. In production, store in database
    const templates = {
      whatsapp: process.env.WHATSAPP_TEMPLATE || "Thank you for your logistics offer. We would like to reserve this shipment. Please confirm availability.",
      email: process.env.EMAIL_TEMPLATE || "Thank you for your logistics offer. We are interested in reserving this shipment. Please provide further details and confirm availability."
    };

    res.json({ success: true, templates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateResponseTemplates = async (req, res) => {
  try {
    const { whatsappTemplate, emailTemplate } = req.body;
    
    // In production, save to database. For now, just return success
    // You might want to create a Settings model to store these templates
    
    res.json({ 
      success: true, 
      message: 'Templates updated successfully',
      templates: {
        whatsapp: whatsappTemplate,
        email: emailTemplate
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Existing endpoints with minor enhancements
exports.getServiceStatus = async (req, res) => {
  try {
    const whatsappStatus = whatsappService.getStatus();
    const emailStatus = emailService.getStatus();
    
    res.json({
      success: true,
      services: {
        whatsapp: whatsappStatus,
        email: emailStatus
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.checkEmails = async (req, res) => {
  try {
    const result = await emailService.checkForNewEmails();
    res.json({ 
      success: true, 
      message: result ? 'Email check initiated' : 'Email service not available'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Enhanced Excel export with comprehensive data
exports.exportExcel = async (req, res) => {
  try {
    const {
      type = 'all',
      status = 'active',
      timeframe = 'last24h'
    } = req.query;

    // Build query for export
    const query = {};
    
    if (type !== 'all') {
      query.type = type;
    }
    
    if (status === 'active') {
      query.isDeleted = false;
    } else if (status === 'deleted') {
      query.isDeleted = true;
    }
    
    const now = new Date();
    if (timeframe === 'last24h') {
      query.created_at = { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
    } else if (timeframe === 'last7d') {
      query.created_at = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    }

    const messages = await Message.find(query).sort({ created_at: -1 });

    // Create workbook with comprehensive data
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Logistics Data');

    // Headers
    const headers = [
      'Type', 'Status', 'Source', 'Sender', 'Contact', 'Company',
      'Loading City', 'Loading Country', 'Loading Postcode',
      'Delivery City', 'Delivery Country', 'Delivery Postcode',
      'Price', 'Comments', 'Date', 'Deleted At'
    ];

    worksheet.addRow(headers);

    // Add data rows
    messages.forEach(msg => {
      if (msg.aiExtracted && msg.aiExtracted.length > 0) {
        msg.aiExtracted.forEach(shipment => {
          worksheet.addRow([
            msg.type,
            msg.isDeleted ? 'Deleted' : 'Active',
            msg.groupName || 'Email',
            msg.senderName,
            msg.senderEmail || msg.senderNumber,
            msg.company || '-',
            shipment.loading_city || '-',
            shipment.loading_country || '-',
            shipment.loading_postcode || '-',
            shipment.delivery_city || '-',
            shipment.delivery_country || '-',
            shipment.delivery_postcode || '-',
            shipment.price ? `€${shipment.price}` : '-',
            shipment.comments || '-',
            new Date(msg.created_at).toLocaleString(),
            msg.deletedAt ? new Date(msg.deletedAt).toLocaleString() : '-'
          ]);
        });
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `logistics_export_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};