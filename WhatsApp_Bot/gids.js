const cron = require('node-cron');


cron.schedule('43 20 * * *', () => {
    console.log('Running the scheduled task at 8:43 PM Pakistan Time...');
    yourTaskFunction();
}, {
    scheduled: true,
    timezone: "Asia/Karachi" // Setting timezone to Pakistan Time
});