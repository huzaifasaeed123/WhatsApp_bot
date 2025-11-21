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

// Show dashboard with real-time messages from both WhatsApp and Email
exports.dashboard = async (req, res) => {
  try {
    // Get WhatsApp service status
    const whatsappStatus = whatsappService.getStatus();
    
    // Get Email service status
    const emailStatus = emailService.getStatus();
    
    // Get tracked WhatsApp groups
    const trackedGroups = await TrackedGroup.find({ isActive: true });
    
    // Get recent messages from both WhatsApp and Email
    const messages = await Message.find({
      isDeleted: false,
      type: { $in: ["whatsapp", "email"] }
    })
    .sort({ created_at: -1 })
    .limit(100); // Increased limit to show more data

    // Calculate statistics
    const stats = {
      totalMessages: messages.length,
      whatsappMessages: messages.filter(m => m.type === 'whatsapp').length,
      emailMessages: messages.filter(m => m.type === 'email').length,
      todayMessages: messages.filter(m => {
        const today = new Date();
        const msgDate = new Date(m.created_at);
        return msgDate.toDateString() === today.toDateString();
      }).length,
      totalShipments: messages.reduce((count, m) => count + (m.aiExtracted?.length || 0), 0)
    };

    res.render('dashboard', { 
      trackedGroups,
      messages,
      stats,
      whatsappStatus,
      emailStatus
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading dashboard');
  }
};

// API endpoint to get messages with updated field structure
exports.getMessages = async (req, res) => {
  try {
    const { type, limit = 50 } = req.query;
    
    // Build query
    const query = { isDeleted: false };
    if (type && ['whatsapp', 'email'].includes(type)) {
      query.type = type;
    } else {
      query.type = { $in: ["whatsapp", "email"] };
    }
    
    const messages = await Message.find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit));
    
    res.json({ success: true, messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// API endpoint to get service status
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

// API endpoint to manually check emails
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

// Enhanced Excel export with both WhatsApp and Email data
exports.exportExcel = async (req, res) => {
  try {
    // Calculate date 24 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get messages from last 24 hours with AI extracted data
    const messages = await Message.find({
      created_at: { $gte: twentyFourHoursAgo },
      aiExtracted: { $exists: true, $ne: [] },
      isDeleted: false,
      type: { $in: ["whatsapp", "email"] }
    })
    .sort({ created_at: -1 });

    // Flatten AI extracted shipments with message context
    const shipments = [];
    messages.forEach(msg => {
      if (msg.aiExtracted && Array.isArray(msg.aiExtracted) && msg.aiExtracted.length > 0) {
        msg.aiExtracted.forEach(shipment => {
          shipments.push({
            Type: msg.type || 'unknown',
            Source: msg.type === 'whatsapp' ? (msg.groupName || 'Unknown Group') : 'Email',
            Sender: msg.senderName || msg.senderNumber || msg.senderEmail || 'Unknown',
            'Sender Email': msg.senderEmail || '-',
            'Sender Number': msg.senderNumber || '-',
            Company: msg.company || '-',
            'Loading City': shipment.loading_city || '-',
            'Loading Country': shipment.loading_country || '-',
            'Loading Postcode': shipment.loading_postcode || '-',
            'Delivery City': shipment.delivery_city || '-',
            'Delivery Country': shipment.delivery_country || '-',
            'Delivery Postcode': shipment.delivery_postcode || '-',
            Price: shipment.price ? `€${shipment.price}` : '-',
            Comments: shipment.comments || '-',
            Status: msg.status || 'new',
            'Date & Time': new Date(msg.created_at).toLocaleString(),
            'Original Message': msg.originalContent?.substring(0, 200) + (msg.originalContent?.length > 200 ? '...' : '') || '-'
          });
        });
      }
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    
    // Main shipments worksheet
    const worksheet = workbook.addWorksheet('Shipments Data');

    // Add title row
    worksheet.mergeCells('A1:P1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Shipments Report - Last 24 Hours (${new Date().toLocaleString()})`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF25D366' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.getRow(1).height = 25;

    // Add headers
    const headers = [
      'Type', 'Source', 'Sender', 'Sender Email', 'Sender Number', 'Company', 
      'Loading City', 'Loading Country', 'Loading Postcode',
      'Delivery City', 'Delivery Country', 'Delivery Postcode', 
      'Price', 'Comments', 'Status', 'Date & Time'
    ];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    worksheet.getRow(2).height = 20;

    // Add data rows
    shipments.forEach((shipment, index) => {
      const row = worksheet.addRow([
        shipment.Type,
        shipment.Source,
        shipment.Sender,
        shipment['Sender Email'],
        shipment['Sender Number'],
        shipment.Company,
        shipment['Loading City'],
        shipment['Loading Country'],
        shipment['Loading Postcode'],
        shipment['Delivery City'],
        shipment['Delivery Country'],
        shipment['Delivery Postcode'],
        shipment.Price,
        shipment.Comments,
        shipment.Status,
        shipment['Date & Time']
      ]);

      // Color coding by type and status
      if (shipment.Type === 'email') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FD' } };
      } else if (shipment.Type === 'whatsapp') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E8' } };
      }
      
      if (shipment.Status === 'sold') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE6E6' } };
      }

      row.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      row.height = 30;

      // Alternate row colors for better readability
      if (index % 2 === 0 && shipment.Status !== 'sold') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
      }
    });

    // Adjust column widths
    worksheet.columns = [
      { width: 10 }, // Type
      { width: 15 }, // Source
      { width: 15 }, // Sender
      { width: 20 }, // Sender Email
      { width: 15 }, // Sender Number
      { width: 15 }, // Company
      { width: 15 }, // Loading City
      { width: 15 }, // Loading Country
      { width: 12 }, // Loading Postcode
      { width: 15 }, // Delivery City
      { width: 15 }, // Delivery Country
      { width: 12 }, // Delivery Postcode
      { width: 12 }, // Price
      { width: 25 }, // Comments
      { width: 10 }, // Status
      { width: 20 }  // Date & Time
    ];

    // Freeze header rows
    worksheet.views = [{ state: 'frozen', ySplit: 2 }];

    // Add summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.mergeCells('A1:B1');
    const summaryTitle = summarySheet.getCell('A1');
    summaryTitle.value = 'Export Summary';
    summaryTitle.font = { bold: true, size: 12 };

    const whatsappCount = shipments.filter(s => s.Type === 'whatsapp').length;
    const emailCount = shipments.filter(s => s.Type === 'email').length;
    const newCount = shipments.filter(s => s.Status === 'new').length;
    const soldCount = shipments.filter(s => s.Status === 'sold').length;

    const summaryData = [
      ['Total Shipments', shipments.length],
      ['WhatsApp Shipments', whatsappCount],
      ['Email Shipments', emailCount],
      ['New Status', newCount],
      ['Sold Status', soldCount],
      ['Total Messages', messages.length],
      ['Export Date', new Date().toLocaleString()],
      ['Period', 'Last 24 Hours']
    ];

    summaryData.forEach(([label, value]) => {
      const row = summarySheet.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      summarySheet.getCell(`A${row.number}`).alignment = { horizontal: 'left' };
      summarySheet.getCell(`B${row.number}`).alignment = { horizontal: 'right' };
    });

    summarySheet.columns = [{ width: 20 }, { width: 20 }];

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();

    // Send file
    const filename = `shipments_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

    console.log(`📊 Excel export generated: ${shipments.length} shipments from ${messages.length} messages`);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};