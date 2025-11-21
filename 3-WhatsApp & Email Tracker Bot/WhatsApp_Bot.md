# WhatsApp & Email Tracker Bot - Complete Project Overview

## Project Description
This is a comprehensive WhatsApp group monitoring and message tracking system with AI-powered logistics data extraction capabilities. The system can track multiple WhatsApp groups simultaneously, process messages using OpenAI's GPT models to extract structured logistics information, and provide real-time dashboard monitoring with automatic message cleanup functionality.

## Core Functionalities

### 1. **WhatsApp Integration & Authentication**
- QR code-based WhatsApp Web authentication
- Real-time connection status monitoring
- Session persistence using LocalAuth strategy
- Automatic reconnection handling

### 2. **Group Management & Tracking**
- Dynamic group selection and tracking
- Multi-group simultaneous monitoring
- Active/inactive group status management
- Real-time group list updates

### 3. **AI-Powered Message Processing**
- OpenAI GPT integration for logistics data extraction
- Structured data extraction from unstructured messages
- Support for truck shipments, transport offers, and load details
- Automatic "SOLD" status detection
- Price and location extraction (countries, cities)

### 4. **Message Storage & Management**
- MongoDB-based message persistence
- Sender information tracking (number and name)
- Original content preservation
- Media detection and handling
- Message deletion tracking (revoke detection)

### 5. **Real-time Dashboard**
- Live message monitoring
- Statistics display (tracked groups, total messages)
- Real-time notifications for new messages
- Message deletion status updates
- Socket.io-based real-time communication

### 6. **Automated Message Cleanup**
- Cron job-based automatic message deletion
- Configurable expiration dates
- Batch processing notifications
- Hourly cleanup scheduling

### 7. **Web-based Admin Panel**
- Group selection interface
- Dashboard with live updates
- Message history viewing
- Connection status monitoring

---

## File Structure & Functionalities

### **Server & Configuration Files**

#### **server.js** - Main Application Entry Point
- **Primary Functions:**
  - Express server initialization
  - Socket.io setup for real-time communication
  - MongoDB connection establishment
  - WhatsApp service initialization
  - Cron service startup
  - Route configuration and middleware setup
- **Key Features:**
  - Port configuration (default 3000)
  - Static file serving
  - EJS view engine setup
  - Database connection with error handling

#### **package.json** - Project Dependencies & Scripts
- **Dependencies Management:**
  - WhatsApp Web.js for WhatsApp integration
  - Express.js for web server
  - Mongoose for MongoDB operations
  - Socket.io for real-time communication
  - OpenAI for AI processing
  - Node-cron for scheduled tasks
  - QRCode for QR generation
  - EJS for templating
- **Scripts:** Development and production startup commands

#### **.gitignore** - Version Control Exclusions
- **Excluded Items:**
  - Node modules
  - WhatsApp authentication files (.wwebjs_auth/, .wwebjs_cache/)
  - Environment variables (.env)

### **Database Models**

#### **models/Message.js** - Message Data Schema
- **Schema Fields:**
  - `messageId`: WhatsApp message identifier
  - `groupId` & `groupName`: Group identification
  - `senderName` & `senderNumber`: Sender information
  - `messageContent` & `originalContent`: Message text (current and preserved)
  - `hasMedia` & `mediaPath`: Media handling
  - `date`: Timestamp
  - `aiExtracted`: Array of AI-processed logistics data
  - `expirationDate`: Automatic deletion scheduling
  - `isDeleted`, `deletedAt`, `deletedBy`: Deletion tracking
- **Purpose:** Complete message lifecycle management with AI integration

#### **models/TrackedGroup.js** - Group Management Schema
- **Schema Fields:**
  - `groupId`: Unique WhatsApp group identifier
  - `groupName`: Human-readable group name
  - `isActive`: Tracking status toggle
  - `timestamps`: Creation and modification dates
- **Purpose:** Dynamic group tracking management

### **Core Services**

#### **services/whatsappService.js** - WhatsApp Integration Engine
- **Primary Functions:**
  - `initialize(io)`: WhatsApp client setup with Socket.io integration
  - `saveIncomingMessage(msg, chat, io)`: Complete message processing pipeline
  - `getAllGroups()`: Group discovery and listing
  - `getStatus()`: Connection status reporting
- **Key Features:**
  - QR code generation and broadcasting
  - Message filtering by tracked groups
  - AI processing integration
  - Real-time message broadcasting
  - Message revocation/deletion handling
  - Sender contact information extraction
  - Cache management for message tracking
- **Event Handlers:**
  - 'qr': QR code generation and emission
  - 'ready': Connection establishment
  - 'message': Incoming message processing
  - 'message_revoke_everyone': Deletion tracking
  - 'disconnected': Connection loss handling

#### **services/aiProcessor.js** - AI Processing Engine
- **Primary Function:**
  - `analyzeMessage(messageText)`: GPT-powered message analysis
- **AI Processing Pipeline:**
  - Custom prompt engineering for logistics data extraction
  - JSON structure enforcement for consistent output
  - Field extraction: LoadingCountry, LoadingCity, DeliveryCountry, DeliveryCity, Price, Comments, Sold status
  - Error handling and fallback mechanisms
  - Support for multiple shipments per message
- **Output Format:** Structured JSON array with logistics information

#### **services/cron_service.js** - Automated Cleanup Service
- **Primary Functions:**
  - `start()`: Cron job initialization
  - Hourly message expiration processing
  - Batch deletion operations
  - Real-time notification broadcasting
- **Scheduling:** Configurable intervals (hourly by default, with testing options)
- **Features:**
  - Bulk message expiration detection
  - Database batch updates
  - Dashboard notification integration

### **Controllers**

#### **controllers/adminController.js** - Web Interface Controller
- **Route Handlers:**
  - `loginPage(req, res)`: QR code display and connection status
  - `groupsPage(req, res)`: Group selection interface with current tracking status
  - `trackGroups(req, res)`: Group tracking configuration processing
  - `dashboard(req, res)`: Main dashboard with statistics and message history
  - `getMessages(req, res)`: API endpoint for message retrieval
- **Features:**
  - WhatsApp readiness validation
  - Group management logic
  - Real-time data integration
  - Error handling and user feedback

### **Routing**

#### **routes/index.js** - Application Routing Configuration
- **Route Definitions:**
  - `GET /`: Login/QR code page
  - `GET /groups`: Group management interface
  - `POST /track-groups`: Group tracking configuration
  - `GET /dashboard`: Main monitoring dashboard
  - `GET /api/messages`: Message API endpoint
- **Purpose:** Centralized route management and controller mapping

### **Frontend Views (EJS Templates)**

#### **views/login.ejs** - Authentication Interface
- **Features:**
  - QR code display with auto-refresh
  - Connection status indicators
  - Real-time Socket.io integration
  - Responsive design with WhatsApp branding
  - Automatic redirection upon successful connection
- **Socket Events:**
  - 'qr': QR code updates
  - 'ready': Connection success handling
  - 'disconnected': Connection failure management

#### **views/groups.ejs** - Group Management Interface
- **Features:**
  - Dynamic group listing with selection checkboxes
  - Current tracking status display
  - Real-time selection counter
  - Form submission for tracking configuration
  - Responsive grid layout
- **Interactive Elements:**
  - Group selection with visual feedback
  - Submit tracking configuration
  - Navigation to dashboard

#### **views/dashboard.ejs** - Main Monitoring Interface
- **Features:**
  - Real-time statistics display (tracked groups, total messages)
  - Live message feed with sender information
  - Message deletion status indicators
  - Responsive design with card-based layout
  - Auto-scrolling message list
- **Real-time Updates:**
  - 'newMessage': Live message additions
  - 'messageDeleted': Individual message deletion updates
  - 'messageDeletedBatch': Bulk deletion notifications
- **Visual Features:**
  - Message highlighting for new arrivals
  - Deletion status styling
  - Timestamp formatting
  - Group identification

---

## Data Flow Architecture

### **Message Processing Pipeline:**
1. **WhatsApp Message Reception** → services/whatsappService.js
2. **Group Validation** → models/TrackedGroup.js verification
3. **Sender Information Extraction** → Contact API integration
4. **AI Processing** → services/aiProcessor.js (OpenAI GPT)
5. **Database Storage** → models/Message.js with AI results
6. **Real-time Broadcasting** → Socket.io to dashboard
7. **Cache Management** → In-memory message ID tracking

### **Group Management Flow:**
1. **Group Discovery** → WhatsApp API group listing
2. **Selection Interface** → views/groups.ejs
3. **Configuration Processing** → controllers/adminController.js
4. **Database Updates** → models/TrackedGroup.js
5. **Dashboard Updates** → Real-time statistics

### **Deletion Tracking Flow:**
1. **Revocation Detection** → WhatsApp event handlers
2. **Cache Lookup** → In-memory message mapping
3. **Database Updates** → Message deletion status
4. **Real-time Notifications** → Dashboard updates

### **Automated Cleanup Flow:**
1. **Scheduled Execution** → services/cron_service.js
2. **Expiration Detection** → Database queries
3. **Batch Processing** → Bulk updates
4. **Notification Broadcasting** → Dashboard alerts

---

## AI Integration Details

### **Logistics Data Extraction:**
- **Supported Formats:** Truck shipments, transport offers, load details
- **Extracted Fields:**
  - Loading and delivery locations (countries and cities)
  - Pricing information (multiple currency formats)
  - Status indicators (SOLD detection)
  - Additional comments and descriptions
- **Processing Rules:**
  - Multi-shipment message support
  - Flag emoji to country mapping
  - Case-insensitive status detection
  - JSON structure enforcement

### **Error Handling:**
- Graceful fallback for AI processing failures
- Input validation and sanitization
- Output format standardization
- Retry mechanisms for API calls

---

## Security & Performance Features

### **Authentication:**
- LocalAuth strategy for session persistence
- Secure credential storage
- Automatic session restoration

### **Performance Optimizations:**
- In-memory caching for message tracking
- Efficient database queries with indexing
- Real-time communication optimization
- Batch processing for bulk operations

### **Error Handling:**
- Comprehensive try-catch blocks
- Graceful degradation for service failures
- User-friendly error messages
- Logging and monitoring integration

---

## Configuration & Environment

### **Required Environment Variables:**
- `OPENAI_API_KEY`: OpenAI API authentication
- `PORT`: Server port configuration (default: 3000)
- `MONGODB_URI`: Database connection string (default: localhost)

### **Deployment Considerations:**
- MongoDB database requirement
- Node.js runtime environment
- WhatsApp Web session management
- Socket.io real-time capabilities
- File system permissions for authentication storage

This project represents a complete solution for WhatsApp group monitoring with advanced AI processing capabilities, real-time web interface, and automated data management features.
