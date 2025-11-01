// Step 1 & 2: After initializing your project, install whatsapp-web.js
// npm install whatsapp-web.js qrcode-terminal
const cornSched=require("./corn.js");
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const moment = require('moment');
// The ID of the group from which messages will be forwarded
const sourceGroupId = '120363275612831238@g.us';
const cron = require('node-cron');

// The IDs of the groups to which messages will be forwarded
let targetGroupIds = [];
console.log("Application is starting")
const client = new Client({

    authStrategy: new LocalAuth(), // This uses a local authentication strategy to persist login
    //The Following Code is used when we have to deploy to Server
    // puppeteer: {
    //     args: ['--no-sandbox', '--disable-setuid-sandbox']
    // } 
}); 

client.on('qr', qr => {
    // Generate and display the QR code for authentication
    qrcode.generate(qr, {small: true});
});
function makeMessage(data){
    if(data[5]!=null && data[6] != null){
        const formattedExcelDate = moment(new Date(data[1])).format("DD/MM/YYYY");
        let message="*SAEED MDCAT LMS based (Alpha 2.0) CTS Session 2024*\n✅ *Date:* "+formattedExcelDate+"\n     *Day:* "+data[2]+"\n     *SUBJECT*\n☑ *PHYSICS:* "+data[5]+"\n⭕ *LMS Test link*\n👇🏻👇🏻\n"+data[8]+"\n☑ *CHEMISTRY:* "+data[6]+"\n⭕ *LMS Test link*\n👇🏻👇🏻\n"+data[9]+"\n⭕ *Test Time:* 12:00 pm \n*Regards:*\n SAEEDMDCAT TEAM";
        return message;
    }
    else{
        if(data[7]!=null){
            const formattedExcelDate = moment(new Date(data[1])).format("DD/MM/YYYY");
        let message="*SAEED MDCAT LMS based (Alpha 2.0) CTS Session 2024*\n✅ *Date:* "+formattedExcelDate+"\n     *Day:* "+data[2]+"\n     *SUBJECT*\n☑ *BIOLOGY:* "+data[3]+"\n⭕ *LMS Test link*\n👇🏻👇🏻\n"+data[8]+"\n☑ *ENGLISH:* "+data[4]+"\n⭕ *LMS Test link*\n👇🏻👇🏻\n"+data[9]+"\n☑ *Logical Reasioing:* "+data[7]+"\n⭕ *LMS Test link*\n👇🏻👇🏻\n"+data[10]+"\n⭕ *Test Time:* 12:00 pm \n*Regards:*\n SAEEDMDCAT TEAM";
        return message;
        }
        else{
            const formattedExcelDate = moment(new Date(data[1])).format("DD/MM/YYYY");
        let message="*SAEED MDCAT LMS based (Alpha 2.0) CTS Session 2024*\n✅ *Date:* "+formattedExcelDate+"\n     *Day:* "+data[2]+"\n     *SUBJECT*\n☑ *BIOLOGY:* "+data[3]+"\n⭕ *LMS Test link*\n👇🏻👇🏻\n"+data[8]+"\n☑ *ENGLISH:* "+data[4]+"\n⭕ *LMS Test link*\n👇🏻👇🏻\n"+data[9]+"\n⭕ *Test Time:* 12:00 pm \n*Regards:*\n SAEEDMDCAT TEAM";
        return message;
        }
    }
}

async function data(){
    const data=await cornSched();
    const message=makeMessage(data);
    //console.log(message);
    return message;
    //client.sendMessage("923471729745@c.us",message);
    //return makeMessage(data);
    //console.log(message);
}
//data();
client.on('ready', async () => {
    console.log('Client  and Server is ready to listen Whatsapp Message!');
    
    // Fetch all chats
    
    // console.log(name);
});
async function forwardByAdminGrp(message, a) {
    let i = 0;
    for (const groupId of targetGroupIds) {
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            await new Promise(resolve => setTimeout(resolve, 5000)); // 10-second delay
            let options = {};
            if (message.body) {
                options.caption = message.body;
            }

            switch (message.type) {
                case 'image':
                case 'video':
                    await client.sendMessage(groupId, media, options);
                    break;
                case 'audio': // New case for audio
                    await client.sendMessage(groupId, media, { sendAudioAsVoice: true });
                    break;
                default:
                    await client.sendMessage(groupId, media, { sendMediaAsDocument: true, caption: options.caption });
                    break;
            }
        } else {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 10-second delay
            if (a == 0) {
                await client.sendMessage(groupId, message.body);
                console.log(i + ": Message Sent");
            } else {
                await client.sendMessage(groupId, message);
                console.log(i + " Message Sent");
            }
        }
        i++;
    }
}

async function SaeedMdcatGids(){
    const chats = await client.getChats();
    targetGroupIds=[];
    chats.forEach(chat => {
        // if (chat.isGroup) 
        // {
            if(chat.name.substring(0,5)==="SAEED")
            {
                targetGroupIds.push(chat.id._serialized);
                //console.log(`Group NameSS: ${chat.name}, Group ID: ${chat.id._serialized}`);
                
            }
            
        // }
        
    });
}
async function SaeedMdcatGidsView(message){
    const chats = await client.getChats();
    // console.log(chats);
    // console.log("ALl Chats has been fetch");
    // Filter out groups and log their names and IDs
    messageBody="";
    index=0;
    chats.forEach(chat => {
        // if (chat.isGroup) 
        // {
            if(chat.name.substring(0,5)==="SAEED")
            {
                index++;
                messageBody+=`\n${index}-Group Name: ${chat.name}, Group ID: ${chat.id._serialized}`
                // targetGroupIds.push(chat.id._serialized);
                
            }
            //console.log(`Group Name: ${chat.name}, Group ID: ${chat.id._serialized}`);
        // }
        
    });
    
    // console.log(targetGroupIds);
    // console.log(targetGroupIds.length);
    client.sendMessage(message.from,messageBody);
}
async function Groupids(message){
    const chats = await client.getChats();
    // Log the length of the chats array
    console.log(`Total chats fetched: ${chats.length}`);

    // Log the chats array for inspection
    // console.log('Chats response:', chats);
    // Filter out groups and log their names and IDs
    messageBody="";
    index=0;
    chats.forEach(chat => {
        // if (chat.isGroup) 
        // {
            index++;
            messageBody+=`\n${index}-Group Name: ${chat.name}, Group ID: ${chat.id._serialized}`
                // targetGroupIds.push(chat.id._serialized);
                // name.push(chat.name);
            
            // console.log(`Group Name: ${chat.name}, Group ID: ${chat.id._serialized}`);
        // }
       
    });
    // console.log(messageBody);
    client.sendMessage(message.from,messageBody)
    .then((response) => {
        console.log('Message sent successfully:', response.to);
    })
    .catch((error) => {
        console.error('Error sending message:', error);
    });
    
    
}
async function executeScheduledCode() {
    // Your code to be executed goes here
    let mess = await data();
    await SaeedMdcatGids();
    forwardByAdminGrp(mess, 1);
}
cron.schedule('0 10 * * *',async () => {
    console.log('Running the scheduled task at 10.0 PM Pakistan Time...');
    await executeScheduledCode();
}, {
    scheduled: true,
    timezone: "Asia/Karachi" // Setting timezone to Pakistan Time
});

client.on('message',async message => {
    // console.log(message);
    if(message.from==="923471729745@c.us" || message.from==="923487842266@c.us" || message.from=== "120363260003419505@g.us")
    {
        if(message.body===".gids")
        {
            console.log("Sending gids Request");
            Groupids(message);
        }
        else if(message.body===".Sgids"){
            console.log("Sending Sgids Request");
            SaeedMdcatGidsView(message);
        }
        else if(message.body===".todaytest")
        {
            mess= await data();
            client.sendMessage(message.from,mess);
        }
        else if(message.body===".sendtodaytest")
        {
            mess= await data();
            await SaeedMdcatGids();
            //console.log(targetGroupIds);
            forwardByAdminGrp(mess,1);
        }
        
        
    }
    
    if (message.from === sourceGroupId) {
        // Forward the message to all target groups by Admin Pannel Group
        await SaeedMdcatGids();
        //console.log(targetGroupIds);
        forwardByAdminGrp(message,0);
    }
    
});

client.initialize();
