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

# The Idea Behind the WhatsApp Bot

## Problem Statement
Managing communications across multiple WhatsApp groups presents a significant challenge, especially when it involves forwarding the same message to over 160 groups. The process was not only cumbersome, involving the use of alternatives like GB WhatsApp for bulk messaging, but it also placed a heavy burden on the administrator, making consistent communication difficult. For instance, in the context of SAEED MDCAT preparation, there was a need to:

- *1-Bulk Forwarding:* Manually forwarding messages to each of the 160 groups was tedious and time-consuming.
- *2-Consistent Updates:* Posting new content daily at a fixed time based on a schedule, including test details and links fetched from a website, was challenging due to the lack of consistency and the manual effort required.
## Solution Through Automation
This WhatsApp bot was developed as a solution to streamline the process of managing multiple groups and ensure timely and consistent message delivery. It offers:

- *1-Efficient Message Forwarding:* With this bot, the task of message forwarding is simplified. A message sent to one group can automatically be forwarded to all other SAEED MDCAT groups, eliminating the need for manual intervention.
- *2-Scheduled Messages:* The bot autonomously generates messages daily at 10 AM based on a predefined schedule. It retrieves test details and links directly from a website and posts them to the WhatsApp groups. This schedule is managed through an Excel file, allowing for easy updates and adjustments.

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
