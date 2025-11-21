const whatsappService = require('../services/whatsappService');
const TrackedGroup = require('../models/TrackedGroup');
const Message = require('../models/Message');
const ExcelJS = require('exceljs');

// Show login page
exports.loginPage = (req, res) => {
  const status = whatsappService.getStatus();
  res.render('login', { 
    qrCode: status.qrCode,
    isReady: status.isReady 
  });
};

// Show groups selection page
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

// Track selected groups
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

// Show dashboard with real-time messages
exports.dashboard = async (req, res) => {
  try {
    if (!whatsappService.isReady) {
      return res.redirect('/');
    }

    const trackedGroups = await TrackedGroup.find({ isActive: true });
    
    // Updated query to use new field structure
    const messages = await Message.find({
      isDeleted: false,
      type: { $in: ["whatsapp", "email"] } // Support both types
    })
    .sort({ created_at: -1 })
    .limit(50);

    res.render('dashboard', { 
      trackedGroups,
      messages
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading dashboard');
  }
};

// API endpoint to get messages with updated field structure
exports.getMessages = async (req, res) => {
  try {
    const messages = await Message.find({
      isDeleted: false,
      type: { $in: ["whatsapp", "email"] }
    })
    .sort({ created_at: -1 })
    .limit(50);
    
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🆕 API endpoint to export Excel with updated database structure
exports.exportExcel = async (req, res) => {
  try {
    // Calculate date 24 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get messages from last 24 hours with AI extracted data using updated field structure
    const messages = await Message.find({
      created_at: { $gte: twentyFourHoursAgo },
      aiExtracted: { $exists: true, $ne: [] },
      isDeleted: false,
      type: { $in: ["whatsapp", "email"] }
    })
    .sort({ created_at: -1 });

    // Flatten AI extracted shipments with message context using new field structure
    const shipments = [];
    messages.forEach(msg => {
      if (msg.aiExtracted && Array.isArray(msg.aiExtracted) && msg.aiExtracted.length > 0) {
        msg.aiExtracted.forEach(shipment => {
          shipments.push({
            Type: msg.type || 'unknown',
            Group: msg.groupName || 'Email', // Group name for WhatsApp, 'Email' for emails
            Sender: msg.senderName || msg.senderNumber || msg.senderEmail || 'Unknown',
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
            'Message Date (UTC)': new Date(msg.created_at).toISOString()
          });
        });
      }
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Shipments');

    // Add title row
    worksheet.mergeCells('A1:M1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Shipments Report - Last 24 Hours (${new Date().toLocaleString()})`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF25D366' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.getRow(1).height = 25;

    // Add headers with updated structure
    const headers = [
      'Type', 'Group/Source', 'Sender', 'Company', 'Loading City', 'Loading Country', 'Loading Postcode',
      'Delivery City', 'Delivery Country', 'Delivery Postcode', 'Price', 'Comments', 'Status', 'Date & Time'
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
        shipment.Group,
        shipment.Sender,
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

      // Color different message types differently
      if (shipment.Type === 'email') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FD' } };
      } else if (shipment.Status === 'sold') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE6E6' } };
      }

      // Wrap text and align
      row.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      row.height = 30;

      // Alternate row colors for better readability
      if (index % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
      }
    });

    // Adjust column widths
    worksheet.columns = [
      { width: 10 }, // Type
      { width: 15 }, // Group/Source
      { width: 15 }, // Sender
      { width: 15 }, // Company
      { width: 15 }, // Loading City
      { width: 15 }, // Loading Country
      { width: 12 }, // Loading Postcode
      { width: 15 }, // Delivery City
      { width: 15 }, // Delivery Country
      { width: 12 }, // Delivery Postcode
      { width: 12 }, // Price
      { width: 20 }, // Comments
      { width: 10 }, // Status
      { width: 20 }  // Date & Time
    ];

    // Freeze header rows
    worksheet.views = [{ state: 'frozen', ySplit: 2 }];

    // Add summary sheet with updated metrics
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.mergeCells('A1:B1');
    const summaryTitle = summarySheet.getCell('A1');
    summaryTitle.value = 'Export Summary';
    summaryTitle.font = { bold: true, size: 12 };

    const whatsappCount = shipments.filter(s => s.Type === 'whatsapp').length;
    const emailCount = shipments.filter(s => s.Type === 'email').length;
    const newCount = shipments.filter(s => s.Status === 'new').length;

    const summaryData = [
      ['Total Shipments', shipments.length],
      ['WhatsApp Messages', whatsappCount],
      ['Email Messages', emailCount],
      ['New Status', newCount],
      ['Export Date', new Date().toLocaleString()],
      ['Period', 'Last 24 Hours']
    ];

    summaryData.forEach(([label, value]) => {
      const row = summarySheet.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      summarySheet.getCell(`A${row.number}`).alignment = { horizontal: 'left' };
      summarySheet.getCell(`B${row.number}`).alignment = { horizontal: 'right' };
    });

    summarySheet.columns = [
      { width: 20 },
      { width: 20 }
    ];

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();

    // Send file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="shipments_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};