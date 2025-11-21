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
    const messages = await Message.find()
      .sort({ date: -1 })
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

// API endpoint to get messages
exports.getMessages = async (req, res) => {
  try {
    const messages = await Message.find()
      .sort({ date: -1 })
      .limit(50);
    
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🆕 API endpoint to export Excel with last 24 hours data
exports.exportExcel = async (req, res) => {
  try {
    // Calculate date 24 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get messages from last 24 hours with AI extracted data
    const messages = await Message.find({
      date: { $gte: twentyFourHoursAgo },
      aiExtracted: { $exists: true, $ne: [] }
    })
    .sort({ date: -1 });

    // Flatten AI extracted shipments with message context
    const shipments = [];
    messages.forEach(msg => {
      if (msg.aiExtracted && Array.isArray(msg.aiExtracted) && msg.aiExtracted.length > 0) {
        msg.aiExtracted.forEach(shipment => {
          shipments.push({
            Group: msg.groupName || 'Unknown',
            Sender: msg.senderName || msg.senderNumber || 'Unknown',
            'Loading City': shipment.LoadingCity || '-',
            'Loading Country': shipment.LoadingCountry || '-',
            'Delivery City': shipment.DeliveryCity || '-',
            'Delivery Country': shipment.DeliveryCountry || '-',
            Price: shipment.Price || '-',
            Comments: shipment.Comments || '-',
            Status: shipment.Sold ? 'SOLD' : 'AVAILABLE',
            'Date & Time': new Date(msg.date).toLocaleString(),
            'Message Date (UTC)': msg.date.toISOString()
          });
        });
      }
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Shipments');

    // Add title row
    worksheet.mergeCells('A1:J1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Shipments Report - Last 24 Hours (${new Date().toLocaleString()})`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF25D366' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.getRow(1).height = 25;

    // Add headers
    const headers = ['Group', 'Sender', 'Loading City', 'Loading Country', 'Delivery City', 'Delivery Country', 'Price', 'Comments', 'Status', 'Date & Time'];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    worksheet.getRow(2).height = 20;

    // Add data rows
    shipments.forEach((shipment, index) => {
      const row = worksheet.addRow([
        shipment.Group,
        shipment.Sender,
        shipment['Loading City'],
        shipment['Loading Country'],
        shipment['Delivery City'],
        shipment['Delivery Country'],
        shipment.Price,
        shipment.Comments,
        shipment.Status,
        shipment['Date & Time']
      ]);

      // Color sold rows differently
      if (shipment.Status === 'SOLD') {
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
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 12 },
      { width: 20 },
      { width: 12 },
      { width: 20 }
    ];

    // Freeze header rows
    worksheet.views = [{ state: 'frozen', ySplit: 2 }];

    // Add summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.mergeCells('A1:B1');
    const summaryTitle = summarySheet.getCell('A1');
    summaryTitle.value = 'Export Summary';
    summaryTitle.font = { bold: true, size: 12 };

    const summaryData = [
      ['Total Shipments', shipments.length],
      ['Available', shipments.filter(s => s.Status === 'AVAILABLE').length],
      ['Sold', shipments.filter(s => s.Status === 'SOLD').length],
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