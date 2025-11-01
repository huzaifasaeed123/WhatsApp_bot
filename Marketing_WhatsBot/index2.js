const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

// ============= CONFIGURATION VARIABLES =============
// File settings
const DATA_FILE_PATH = 'MDCAT Marketing Data.csv';  // Path to your CSV file
const START_ROW = 1;                    // Start from which row (1-based index, header is row 1)
const END_ROW = 1000;                   // End at which row

// Message settings
const MESSAGE_TEMPLATE = `*Dear {name} S/O {fathername}:* 
*Join this group if you are preparing for MDCAT 2024 and also Share with MDCAT Students*
✅ *SAEED MDCAT SESSION 2025*
👉🏻 Free 🆓 Of Cost
👉🏻 Topic Wise MCQs
👉🏻 Recorded Discussion Videos
👉🏻 Complete MDCAT Material & Resourses
👉🏻 HandMade Notes
🔯 Join this Whatsapp Group to Join Free of cost Session
{link}
*Share with MDCAT STUDENTS*

*Contact Number:* 03418729745 (WhatsApp)`;

// CSV column mapping (change these to match your CSV headers)
const COLUMN_MAPPING = {
  nameColumn: 'Name',               // Column header for the person's name
  fatherNameColumn: 'Father Name',  // Column header for father's name
  phoneColumn: 'Phone',      // Column header for phone number
  linkColumn: 'Link'          // Column header for any link to include
};

// Delay settings
const DELAY_BETWEEN_MESSAGES = 10000; // Delay between messages in milliseconds

// WhatsApp client configuration
const CLIENT_CONFIG = {
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
};

// ============= WHATSAPP CLIENT SETUP =============
const client = new Client(CLIENT_CONFIG);

client.on('qr', (qr) => {
  qrcode.generate(qr, {small: true});
  console.log('QR code received. Scan with WhatsApp to authenticate.');
});

client.on('ready', async () => {
  console.log('WhatsApp client is ready!');
  
  try {
    const data = await readCSVFile(DATA_FILE_PATH, START_ROW, END_ROW);
    console.log(`Successfully loaded ${data.length} contacts from CSV.`);
    await sendMessages(data);
  } catch (error) {
    console.error('Error in processing:', error);
  }
});

// ============= HELPER FUNCTIONS =============
/**
 * Reads data from a CSV file
 * @param {string} filePath - Path to the CSV file
 * @param {number} startRow - Starting row to read from (1-based index)
 * @param {number} endRow - Ending row to read to
 * @returns {Promise<Array>} Array of contact objects
 */
function readCSVFile(filePath, startRow, endRow) {
  return new Promise((resolve, reject) => {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    
    // Read the CSV file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Parse the CSV
    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          return reject(new Error(`CSV parsing error: ${results.errors[0].message}`));
        }
        
        // Process the data
        const processedData = [];
        const rows = results.data;
        
        // Validate required columns exist
        const headers = results.meta.fields;
        const requiredColumns = Object.values(COLUMN_MAPPING);
        
        const missingColumns = requiredColumns.filter(col => !headers.includes(col));
        if (missingColumns.length > 0) {
          return reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
        }
        
        // Extract data within specified row range
        const dataSlice = rows.slice(
          Math.max(0, startRow - 2),  // -2 because startRow is 1-based and we've already removed header
          Math.min(rows.length, endRow - 1)
        );
        
        dataSlice.forEach(row => {
          const contactData = {
            name: row[COLUMN_MAPPING.nameColumn] || '',
            fathername: row[COLUMN_MAPPING.fatherNameColumn] || '',
            number: row[COLUMN_MAPPING.phoneColumn] || '',
            link: row[COLUMN_MAPPING.linkColumn] || ''
          };
          
          // Only add if we have at least a name or phone number
          if (contactData.name || contactData.number) {
            processedData.push(contactData);
          }
        });
        
        resolve(processedData);
      },
      error: (error) => {
        reject(new Error(`CSV parsing error: ${error.message}`));
      }
    });
  });
}

function formatPhoneNumber(phoneNumber) {
    // Convert to string if it's a number
    let phone = String(phoneNumber);
    
    // Remove any non-numeric characters
    phone = phone.replace(/\D/g, '');
    
    // Handle the specific format from CSV (e.g., "3471729745")
    // These numbers are missing both country code (92) and leading zero
    if (phone.length === 10 && !phone.startsWith('92') && !phone.startsWith('0')) {
      // For Pakistani numbers in format "3471729745", add "92" country code
      phone = '92' + phone;
    }
    
    // If number only has local format without country code (e.g., "03471729745")
    else if (phone.length === 11 && phone.startsWith('0')) {
      // Remove the leading zero and add country code
      phone = '92' + phone.substring(1);
    }
    
    // Handle other common formatting issues
    else if (phone.startsWith('00')) {
      phone = phone.substring(2); // Remove leading 00
    }
    
    // Remove leading 0 after country code (if present)
    if (phone.length >= 3 && phone[2] === '0') {
      phone = phone.substring(0, 2) + phone.substring(3);
    }
    
    // If no country code is detected at all, add 92 (Pakistan)
    if (!phone.startsWith('92')) {
      if (phone.startsWith('0')) {
        phone = '92' + phone.substring(1);
      } else {
        phone = '92' + phone;
      }
    }
    
    console.log(`Formatted phone number: ${phoneNumber} → ${phone}`);
    return phone;
  }

/**
 * Creates a personalized message by replacing template placeholders
 * @param {Object} contact - Contact data object
 * @returns {string} - Personalized message
 */
function createPersonalizedMessage(contact) {
  let message = MESSAGE_TEMPLATE;
  
  // Replace placeholders with contact data
  Object.keys(contact).forEach(key => {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), contact[key] || '');
  });
  
  return message;
}

/**
 * Sends messages to all contacts in the data array
 * @param {Array} contacts - Array of contact objects
 */
async function sendMessages(contacts) {
  console.log(`Preparing to send messages to ${contacts.length} contacts...`);
  
  let successCount = 0;
  let failureCount = 0;
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    
    // Skip if no phone number
    if (!contact.number) {
      console.warn(`Skipping contact #${i+1} (${contact.name}) - No phone number provided`);
      failureCount++;
      continue;
    }
    
    try {
      // Format the phone number correctly
      const formattedNumber = formatPhoneNumber(contact.number);
      const chatId = `${formattedNumber}@c.us`;
      
      // Create personalized message
      const message = createPersonalizedMessage(contact);
      
      // Log progress
      console.log(`Sending message ${i+1}/${contacts.length} to ${contact.name} (${formattedNumber})...`);
      
      // Send the message
      await client.sendMessage(chatId, message);
      
      console.log(`✓ Message sent successfully to ${contact.name} (${formattedNumber})`);
      successCount++;
      
      // Add delay between messages to avoid being blocked
      if (i < contacts.length - 1) {
        console.log(`Waiting ${DELAY_BETWEEN_MESSAGES/1000} seconds before sending next message...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES));
      }
      
    } catch (error) {
      console.error(`✗ Failed to send message to ${contact.name} (${contact.number}):`, error.message);
      failureCount++;
    }
  }
  
  // Print summary
  console.log('\n===== MESSAGE SENDING SUMMARY =====');
  console.log(`Total contacts: ${contacts.length}`);
  console.log(`Successfully sent: ${successCount}`);
  console.log(`Failed to send: ${failureCount}`);
  console.log('=================================');
}

// ============= START THE CLIENT =============
console.log('Starting WhatsApp Bot...');
client.initialize();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await client.destroy();
  process.exit(0);
});