const { Client, LocalAuth } = require('whatsapp-web.js');
const { exec } = require('child_process');
const qrcode = require('qrcode-terminal');
const xlsx = require('xlsx');

//Check if the kernel supports user namespaces
// exec('sysctl -n kernel.unprivileged_userns_clone', (err, stdout, stderr) => {
//     if (stdout.trim() !== '1') {
//         console.warn('Warning: Kernel does not support user namespaces. Puppeteer will be run without sandbox.');
//     }
// });
let Numlist=["9203471729745"];
const client = new Client({
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    // authStrategy: new LocalAuth({ clientId: 'my_custom_client_id' })
});

client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
    console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
    console.log('Client is ready!hdfjf dshfj');
    console.log("Huzaifa");
    // let data=readExcelFile("number.xlsx",5016,6000);
    let data=readExcelFile2("MDCAT Marketing Data.xlsx",1,1000);
    console.log(data.length);
    sendMessages(data,"Heelo");
});
function readExcelFile2(filePath, startRow,endRow) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const range = xlsx.utils.decode_range(worksheet['!ref']);
    
    const data = [];
    for (let rowNum = startRow - 1; rowNum <= startRow+endRow; rowNum++) {
        const cell1 = worksheet[xlsx.utils.encode_cell({ c: 1, r: rowNum })]; // 1st column (A)
        const cell3 = worksheet[xlsx.utils.encode_cell({ c: 2, r: rowNum })]; // 3rd column (C)
        const cell4 = worksheet[xlsx.utils.encode_cell({ c: 4, r: rowNum })]; // 3rd column (D)
        const cell5 = worksheet[xlsx.utils.encode_cell({ c: 6, r: rowNum })]; // 3rd column (D)

        const value1 = cell1 ? cell1.v : undefined;
        const value2 = cell3 ? cell3.v : undefined;
        const value3 = cell4 ? cell4.v : undefined;
        const value4 = cell5 ? cell5.v : undefined;

        if (value1 !== undefined || value2 !== undefined || value3 !== undefined ||value4 !== undefined) {
            data.push({ name: value1, fathername: value2,number:value3 ,link:value4});
        }
    }
    return data;
}
function readExcelFile(filePath, startRow,endRow) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const range = xlsx.utils.decode_range(worksheet['!ref']);
    
    const data = [];
    for (let rowNum = startRow - 1; rowNum <= startRow+endRow; rowNum++) {
        const cell1 = worksheet[xlsx.utils.encode_cell({ c: 0, r: rowNum })]; // 1st column (A)
        const cell3 = worksheet[xlsx.utils.encode_cell({ c: 2, r: rowNum })]; // 3rd column (C)
        const cell4 = worksheet[xlsx.utils.encode_cell({ c: 3, r: rowNum })]; // 3rd column (D)

        const value1 = cell1 ? cell1.v : undefined;
        const value2 = cell3 ? cell3.v : undefined;
        const value3 = cell4 ? cell4.v : undefined;

        if (value1 !== undefined || value2 !== undefined || value3 !== undefined) {
            data.push({ name: value1, fathername: value2,number:value3 });
        }
    }
    return data;
}
function removeZeroAtThirdIndex(str) {
    // Check if the string consists of exactly 12 digits
    const isValid = str.length === 13;
    
    if (isValid && str[2] === '0') {
        // Remove the character at the 3rd index
        return str.slice(0, 2) + str.slice(3);
    }
    
    // Return the original string if conditions are not met
    return str;
}
const sendMessages = async (dataBulk, msg) => {
    for(data of dataBulk){
        // data.number="923418729745"
        // Ensure the number includes the correct country code and is in E.164 format
        let message=`*Dear ${data.name} S/O ${data.fathername}:* \n*Join this group if you are preparing for MDCAT 2024 and also Share with MDCAT Students*\n✅ *SAEED MDCAT BETA 1.0 SESSION 2024*\n👉🏻 Free 🆓 Of Cost\n👉🏻 Topic Wise MCQs\n👉🏻 Recorded Discussion Videos\n👉🏻 All academy Lecture Support (Step,Kips)\n👉🏻 HandMade Notes\n🔯 Join this Whatsapp Group to Join Free of cost Session\nhttps://chat.whatsapp.com/KQ4TRCsPxAR5ADPsemxlxi\n*Share with MDCAT STUDENTS*`
        updatedNumber=removeZeroAtThirdIndex(data.number);
        console.log(updatedNumber);
        const chatId = updatedNumber + '@c.us';


        client.sendMessage(chatId, message)
            .then(response => {
                console.log(`Message sent to ${data.number}`);
            })
            .catch(err => {
                console.error(`Failed to send message to ${data.number}:`, err);
            });
            await new Promise(resolve => setTimeout(resolve, 100000)); // 10-minute delay
    }
}
client.initialize();
