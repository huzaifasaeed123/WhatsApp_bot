# WhatsApp & Email Tracker Bot - Ubuntu Deployment Guide

## Overview
This guide will help you deploy the WhatsApp & Email Tracker Bot on an Ubuntu server step by step.

---

## 1. Get the Project

Clone the project from GitHub and navigate to the project folder:

```bash
git clone https://github.com/huzaifasaeed123/WhatsApp_bot.git
cd "WhatsApp_bot/WhatsApp & Email Tracker Bot"
```

---

## 2. Install Node.js

### Check if Node.js is installed:
```bash
node -v
```

### If not installed, install Node.js (recommended v18+):
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### Verify installation:
```bash
node -v
npm -v
```

---

## 3. Install Project Dependencies

Inside the project directory, run:

```bash
npm install
```

This installs all required dependencies from package.json.

---

## 4. Create .env File

### Create a .env file using the following command:
```bash
nano .env
```

### Paste the following content and update only the highlighted values:
```env
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_HOST=imap.gmail.com
EMAIL_PORT=993
MONGODB_URI=mongodb://localhost:27017/monitor_bot
PORT=3000
NODE_ENV=development
```

### Important Notes:
- **EMAIL_PASS** should be a Gmail App Password, not your normal Gmail password
- **OPENAI_API_KEY** should be your OpenAI API key
- Keep other values as default unless needed to change

### Save the file:
Press `Ctrl+O`, then `Enter`, then `Ctrl+X` to exit.

---

## 5. Install MongoDB

### Install MongoDB on Ubuntu:
```bash
sudo apt update
sudo apt install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

### Check MongoDB status:
```bash
sudo systemctl status mongodb
```

**Ensure MongoDB is running before starting the bot.**

---

## 6. Install PM2

PM2 is used to run the bot in the background:

```bash
sudo npm install -g pm2
pm2 -v
```

---

## 7. Start the Bot with PM2

### Start the bot using PM2:
```bash
pm2 start server.js --name "WhatsApp_Email_Bot"
```

### Check bot logs:
```bash
pm2 logs WhatsApp_Email_Bot
```

---

## 8. Set PM2 to Auto-Start on Reboot

```bash
pm2 startup systemd
pm2 save
```

The bot will now automatically restart if the server reboots.

---

## 9. Access the Bot

- The bot will run on **PORT 3000** by default (as set in .env)
- Ensure your server firewall allows the port if needed:

```bash
sudo ufw allow 3000
sudo ufw status
```

---

## 10. Quick Command Summary

For quick deployment, run these commands in sequence:

```bash
git clone https://github.com/huzaifasaeed123/WhatsApp_bot.git
cd "WhatsApp_bot/WhatsApp & Email Tracker Bot"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
npm install
nano .env
sudo apt install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
sudo npm install -g pm2
pm2 start server.js --name "WhatsApp_Email_Bot"
pm2 startup systemd
pm2 save
pm2 logs WhatsApp_Email_Bot
sudo ufw allow 3000
```

---

## 11. Post-Deployment Verification

### Access the application:
Open your web browser and go to:
```
http://YOUR_SERVER_IP:3000
```

### Verify services are running:
```bash
pm2 status
sudo systemctl status mongodb
```

---

## 12. Troubleshooting

### If the bot doesn't start:
1. Check logs: `pm2 logs WhatsApp_Email_Bot`
2. Verify .env file: `cat .env`
3. Check MongoDB: `sudo systemctl status mongodb`
4. Restart services: `pm2 restart WhatsApp_Email_Bot`

### If you can't access the web interface:
1. Check firewall: `sudo ufw status`
2. Verify port: `netstat -tulpn | grep :3000`
3. Check server logs: `pm2 logs WhatsApp_Email_Bot`

---

## 13. Maintenance Commands

### View application status:
```bash
pm2 status
```

### Restart the application:
```bash
pm2 restart WhatsApp_Email_Bot
```

### Stop the application:
```bash
pm2 stop WhatsApp_Email_Bot
```

### View real-time logs:
```bash
pm2 logs WhatsApp_Email_Bot --lines 100
```

---

## 14. Required Credentials Setup

### OpenAI API Key:
1. Go to: https://platform.openai.com/api-keys
2. Login to your OpenAI account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-proj-`)

### Gmail App Password:
1. Go to: https://myaccount.google.com/apppasswords
2. Select app: "Mail"
3. Select device: "Other (custom name)"
4. Generate password
5. Copy the 16-character password (with spaces)

---

## 15. Security Considerations

- Keep your `.env` file secure and never commit it to version control
- Use strong passwords for email accounts
- Consider using environment variables on production servers
- Regularly update dependencies: `npm update`
- Monitor logs for any suspicious activity

---

## 16. Features Overview

### WhatsApp Integration:
- QR code-based authentication
- Real-time group monitoring
- Message tracking and processing
- Automated responses to specific shipments

### Email Integration:
- IMAP-based email monitoring
- Automatic email processing
- Support for Gmail and other providers
- Email response capabilities

### AI Processing:
- OpenAI GPT integration for logistics data extraction
- Automatic extraction of shipping details
- Support for multiple languages and formats
- Structured data output

### Web Dashboard:
- Real-time message monitoring
- Advanced search and filtering
- Export to Excel functionality
- Service status monitoring

---

**Your WhatsApp & Email Tracker Bot is now successfully deployed and running on Ubuntu!**

For support or issues, please check the troubleshooting section or contact the development team.
