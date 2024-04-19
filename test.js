const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client();

client.on('qr', (qr) => {
    // Generate and print the QR code with qrcode-terminal
    console.log('QR RECEIVED');
    qrcode.generate(qr, { small: true });  // This will output the QR code to the terminal
});
client.on('authenticated', () => {
    console.log('Authentication successful!');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});


client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('message', msg => {
    if (msg.body == '!ping') {
        msg.reply('pong');
    }
});

client.initialize();
