# WhatsApp & Email Tracker Bot 🚀

A comprehensive WhatsApp group monitoring and email tracking system with AI-powered logistics data extraction capabilities. This system can track multiple WhatsApp groups simultaneously, process messages using OpenAI's GPT models to extract structured logistics information, and provide real-time dashboard monitoring with automatic message cleanup functionality.

## 🌟 Features

### 📱 WhatsApp Integration
- **QR Code Authentication**: Easy setup with WhatsApp Web
- **Multi-Group Monitoring**: Track multiple WhatsApp groups simultaneously
- **Real-time Processing**: Instant message processing and analysis
- **Session Persistence**: Automatic session restoration
- **Message Tracking**: Complete message lifecycle management including deletions

### 📧 Email Integration
- **IMAP Support**: Monitor Gmail and other email providers
- **Automatic Processing**: Real-time email processing with AI extraction
- **SMTP Responses**: Send automated responses via email
- **App Password Support**: Secure authentication with Gmail App Passwords

### 🤖 AI-Powered Processing
- **OpenAI GPT Integration**: Advanced message analysis and data extraction
- **Logistics Data Extraction**: Automatic extraction of shipping details including:
  - Loading and delivery locations (cities, countries, postcodes)
  - Pricing information
  - Status indicators (SOLD detection)
  - Comments and additional details
- **Multi-language Support**: Process messages in various languages
- **Structured Output**: Consistent JSON format for extracted data

### 🖥️ Web Dashboard
- **Real-time Monitoring**: Live message feed with instant updates
- **Advanced Search**: Search by location, sender, price, or any criteria
- **Filtering Options**: Filter by message type, status, timeframe
- **Statistics Dashboard**: Comprehensive analytics and insights
- **Excel Export**: Download data in Excel format
- **Response Management**: Send automated responses to specific shipments

### 🔧 System Features
- **Automated Cleanup**: Scheduled message expiration and cleanup
- **Database Integration**: MongoDB for reliable data storage
- **Process Management**: PM2 for production deployment
- **Real-time Updates**: Socket.io for live dashboard updates
- **Error Handling**: Comprehensive error handling and logging

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose
- **WhatsApp**: whatsapp-web.js
- **Email**: mail-listener2, nodemailer, imap
- **AI**: OpenAI GPT API
- **Frontend**: EJS templates with Socket.io
- **Process Management**: PM2
- **Task Scheduling**: node-cron

## 📋 Prerequisites

- **Node.js** v16+ 
- **MongoDB** (local or cloud)
- **OpenAI API Key** (required for AI processing)
- **Gmail Account** (for email monitoring - optional)
- **Ubuntu/Linux Server** (for deployment)

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/huzaifasaeed123/WhatsApp_bot.git
cd "WhatsApp_bot/WhatsApp & Email Tracker Bot"
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Create a `.env` file:
```env
OPENAI_API_KEY=your_openai_api_key_here
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_HOST=imap.gmail.com
EMAIL_PORT=993
MONGODB_URI=mongodb://localhost:27017/monitor_bot
PORT=3000
NODE_ENV=development
```

### 4. Start the Application
```bash
# Development
npm run dev

# Production
npm start
```

### 5. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:3000
```

## 📖 Detailed Setup

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `OPENAI_API_KEY` | OpenAI API key for AI processing | Yes | - |
| `EMAIL_USER` | Email address for monitoring | No | - |
| `EMAIL_PASS` | Gmail App Password | No | - |
| `EMAIL_HOST` | IMAP server host | No | imap.gmail.com |
| `EMAIL_PORT` | IMAP server port | No | 993 |
| `MONGODB_URI` | MongoDB connection string | No | mongodb://localhost:27017/monitor_bot |
| `PORT` | Server port | No | 3000 |
| `NODE_ENV` | Environment mode | No | development |

### Getting Required Credentials

#### OpenAI API Key
1. Visit [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Copy the key (starts with `sk-proj-`)

#### Gmail App Password
1. Enable 2-Factor Authentication on your Google account
2. Visit [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Generate an app password for "Mail"
4. Use this 16-character password (not your regular Gmail password)

## 🏗️ Project Structure

```
WhatsApp & Email Tracker Bot/
├── controllers/
│   └── adminController.js      # Main application controller
├── models/
│   ├── Message.js              # Message data schema
│   └── TrackedGroup.js         # Group management schema
├── services/
│   ├── whatsappService.js      # WhatsApp integration
│   ├── emailService.js         # Email integration
│   ├── aiProcessor.js          # AI processing engine
│   └── cron_service.js         # Automated cleanup
├── routes/
│   └── index.js               # Application routes
├── views/
│   ├── login.ejs              # Authentication page
│   ├── groups.ejs             # Group management
│   └── dashboard.ejs          # Main dashboard
├── server.js                  # Application entry point
├── package.json               # Dependencies and scripts
└── README.md                  # This file
```

## 🔌 API Endpoints

### Web Routes
- `GET /` - Authentication/QR code page
- `GET /groups` - Group management interface
- `POST /track-groups` - Configure group tracking
- `GET /dashboard` - Main dashboard

### API Routes
- `GET /api/messages` - Retrieve messages with filtering
- `GET /api/export-excel` - Export data to Excel
- `GET /api/service-status` - Check service status
- `POST /api/send-response` - Send automated responses
- `GET /api/templates` - Get response templates
- `POST /api/templates` - Update response templates

## 📊 Dashboard Features

### Real-time Statistics
- Total messages processed
- Active messages count
- Last 24 hours activity
- Total shipments extracted
- Service status indicators

### Advanced Search & Filtering
- **Search by**: Location, sender, company, phone, email, comments
- **Filter by**: Message type (WhatsApp/Email), status (Active/Deleted), time period
- **Pagination**: Configurable results per page
- **Export**: Download filtered results to Excel

### Message Management
- View all extracted shipment details
- Send responses to specific shipments
- Track message deletion status
- Real-time updates via WebSocket

## 🤖 AI Processing Details

### Supported Data Extraction
- **Loading Information**: City, country, postal code
- **Delivery Information**: City, country, postal code
- **Pricing**: Multiple currency formats support
- **Status**: SOLD detection and status tracking
- **Comments**: Additional descriptive information

### Processing Rules
- Multi-shipment message support
- Flag emoji to country mapping
- Case-insensitive status detection
- JSON structure enforcement
- Error handling and fallback mechanisms

## 🔧 Production Deployment

### Using PM2
```bash
# Install PM2
sudo npm install -g pm2

# Start application
pm2 start server.js --name "whatsapp-email-tracker"

# Save configuration
pm2 save

# Setup auto-start
pm2 startup
```

### MongoDB Setup
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

### Security Considerations
- Use environment variables for sensitive data
- Enable firewall rules for required ports
- Regular security updates
- Monitor application logs
- Secure MongoDB installation

## 📱 WhatsApp Setup

1. **Access the application** at `http://your-server:3000`
2. **Scan QR code** with your WhatsApp mobile app
3. **Select groups** to monitor from the groups page
4. **Start monitoring** - messages will appear on the dashboard

## 📧 Email Setup

1. **Configure Gmail** with 2-Factor Authentication
2. **Generate App Password** (not regular password)
3. **Update .env file** with email credentials
4. **Restart application** to activate email monitoring

## 🔍 Troubleshooting

### Common Issues

#### Application Won't Start
```bash
# Check logs
pm2 logs whatsapp-email-tracker

# Verify dependencies
npm install

# Check MongoDB
sudo systemctl status mongodb
```

#### WhatsApp QR Not Appearing
```bash
# Restart application
pm2 restart whatsapp-email-tracker

# Check Chrome/Chromium installation
google-chrome --version
```

#### Email Not Working
- Verify Gmail App Password (16 characters with spaces)
- Ensure 2FA is enabled on Gmail account
- Check email credentials in .env file

#### AI Processing Errors
- Verify OpenAI API key is valid
- Check API quota and billing
- Monitor logs for specific error messages

## 📈 Performance Optimization

### Database Indexing
The application automatically creates necessary indexes for:
- Message IDs for quick lookups
- Creation dates for time-based queries
- Deletion status for filtering

### Caching
- In-memory message ID cache for revocation tracking
- Efficient MongoDB queries with lean operations
- Real-time updates via Socket.io

### Monitoring
```bash
# Monitor application performance
pm2 monit

# Check system resources
htop

# Monitor MongoDB
mongo --eval "db.runCommand({serverStatus: 1})"
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License - see the package.json file for details.

## 💬 Support

For support, issues, or feature requests:

1. Check the troubleshooting section
2. Review the deployment guide
3. Check application logs
4. Contact the development team

## 🔄 Version History

- **v1.0.0** - Initial release with WhatsApp and Email integration
- **v1.1.0** - Enhanced search functionality and AI processing
- **v1.2.0** - Added response management and templates
- **v1.3.0** - Improved dashboard and real-time updates

## 🎯 Roadmap

- [ ] Advanced analytics and reporting
- [ ] Multi-language dashboard support
- [ ] Integration with more messaging platforms
- [ ] Advanced AI processing capabilities
- [ ] Mobile application for monitoring
- [ ] API rate limiting and authentication
- [ ] Advanced user management and roles

---

**Built with ❤️ for logistics professionals who need efficient communication monitoring and data extraction.**
