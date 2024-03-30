# WhatsApp Bot for Group Management and Messaging

## Introduction
it is a powerful WhatsApp bot designed to automate the management and messaging of WhatsApp groups. This bot is ideal for educators, community managers, and anyone needing to broadcast information across multiple groups efficiently. It allows for scheduling messages, forwarding specific messages based on rules, retrieving group IDs, and more.

## Features
- **Scheduled Messaging:** Set up a schedule for one month or more in an Excel file to send dynamic messages based on the schedule to all groups. Perfect for daily updates, like test links.
- **Message Forwarding:** Easily forward the same message to multiple WhatsApp groups, saving time and ensuring consistency in communications.
- **Keyword-Based Messaging:** Automatically forward specific messages to users whose names start with a particular prefix (e.g., SAEED). This functionality can be customized as needed.
- **Retrieval of Today's Message:** Use the `.todaytest` command to return the message sent to groups for the day.
- **Group ID Listing:** The `.Sgids` command returns a list of all groups and their IDs where messages will be sent.
- **Flexible Authentication:** Set up one or more administrators responsible for managing group messages, enhancing security and control.

## Getting Started

### Prerequisites
- Node.js installed on your local machine or server.
- A WhatsApp account for authentication.

### Installation
**Install Required Packages**

    Run the following command to install the necessary Node.js packages:

    ```bash
    npm install exceljs moment node-cron qrcode-terminal whatsapp-web.js
    ```

    These packages include everything needed for scheduling, timezone handling, task execution, QR code generation for WhatsApp login, and the WhatsApp Web API interface.

**Clone the Repository**

   Clone the project to your local machine and navigate to the project directory:

   ```bash
   git clone [Your Repository URL]
   cd [Your Project's Directory Name]
