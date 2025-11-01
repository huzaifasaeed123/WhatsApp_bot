const cron = require('node-cron');
const Message = require('../models/Message');

class CronService {
  constructor(io) {
    this.io = io;
  }

  start() {
    console.log('⏰ Cron job initialized...');

    // Run every hour
    // cron.schedule('*/1 * * * *', async () => {    //  after every mintues for testing just
    cron.schedule('0 * * * *', async () => {    // after every hour
      console.log('Running hourly message cleanup...');

      const now = new Date();

      try {
        // Find and update expired messages
        const expiredMessages = await Message.find({
          expirationDate: { $lte: now },
          isDeleted: false
        });

        if (expiredMessages.length > 0) {
          const ids = expiredMessages.map(m => m._id);

          await Message.updateMany(
            { _id: { $in: ids } },
            { $set: { isDeleted: true } }
          );

          console.log(`🗑️ Marked ${expiredMessages.length} messages as deleted`);

          // Notify dashboard in real-time
          this.io.emit('messageDeletedBatch', {
            deletedCount: expiredMessages.length,
            messageIds: ids
          });
        } else {
          console.log('✅ No expired messages found this hour');
        }
      } catch (err) {
        console.error('❌ Error running cron job:', err);
      }
    });
  }
}

module.exports = CronService;
