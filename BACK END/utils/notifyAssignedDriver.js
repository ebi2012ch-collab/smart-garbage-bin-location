const telegramBot = require('./telegramBot');

function notifyAssignedDriver(driver, assignment) {
  void telegramBot.notifyAssignment({ driver, ...assignment }).then(result => {
    if (result.status === 'unlinked') {
      console.warn('[Telegram] Assignment notification skipped; the Driver has not linked a Telegram account.');
    }
    if (result.status === 'failed') {
      console.error('[Telegram] Assignment notification failed; the task assignment was saved.');
    }
  }).catch(() => {
    console.error('[Telegram] Assignment notification could not be recorded; the task assignment was saved.');
  });
}

module.exports = notifyAssignedDriver;
