const cron = require('node-cron');
const Message = require('../models/Message');

class CronService {
  constructor(io) {
    this.io = io;
  }

  start() {
    console.log('⏰ Cron job initialized...');

    // Run every hour
    // cron.schedule('*/1 * * * *', async () => {    //  after every minute for testing
    cron.schedule('0 * * * *', async () => {    // after every hour
      console.log('Running hourly message cleanup...');

      const now = new Date();

      try {
        // Find and update expired messages using updated field structure
        const expiredMessages = await Message.find({
          expirationDate: { $lte: now },
          isDeleted: false
        });

        if (expiredMessages.length > 0) {
          const ids = expiredMessages.map(m => m._id);

          // Update with new field structure
          await Message.updateMany(
            { _id: { $in: ids } },
            { 
              $set: { 
                isDeleted: true,
                deletedAt: now,
                deleted_at: now, // Updated field name
                updated_at: now
              } 
            }
          );

          console.log(`🗑️ Marked ${expiredMessages.length} messages as deleted`);

          // Notify dashboard in real-time
          this.io.emit('messageDeletedBatch', {
            deletedCount: expiredMessages.length,
            messageIds: ids,
            timestamp: now
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