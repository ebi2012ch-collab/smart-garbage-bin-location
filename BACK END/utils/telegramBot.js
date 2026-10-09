const crypto = require('crypto');
const User = require('../models/User');
const TelegramNotification = require('../models/TelegramNotification');

const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

function createTelegramBot({
  token = process.env.TELEGRAM_BOT_TOKEN,
  dashboardUrl = process.env.DRIVER_DASHBOARD_URL || 'http://localhost:5500/SMART%20GARBAGE%20BIN%20LOCATION/FRONT%20END/driver.html',
  UserModel = User,
  NotificationModel = TelegramNotification,
  fetchImpl = global.fetch,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  let stopped = false;
  let pollingStarted = false;
  let offset = 0;

  async function request(method, payload) {
    if (!token) throw new Error('Telegram bot is not configured.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), method === 'getUpdates' ? 25000 : 10000);
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let result;
      try {
        result = await response.json();
      } catch (_) {
        throw new Error('Telegram returned an invalid response.');
      }
      if (!response.ok || !result.ok) {
        const error = new Error('Telegram API request failed.');
        error.code = result.error_code || response.status;
        throw error;
      }
      return result.result;
    } catch (error) {
      if (error.code) throw error;
      const safeError = new Error('Telegram API request failed.');
      safeError.code = 'NETWORK_ERROR';
      throw safeError;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function reply(chatId, text) {
    return request('sendMessage', { chat_id: String(chatId), text });
  }

  async function startLink(driverId) {
    if (!token) return null;
    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now().getTime() + LINK_TOKEN_TTL_MS);
    const result = await UserModel.updateOne(
      { _id: driverId, role: 'driver' },
      {
        $set: {
          telegramLinkTokenHash: crypto.createHash('sha256').update(code).digest('hex'),
          telegramLinkExpiresAt: expiresAt,
        },
      }
    );
    if (!result.matchedCount) return null;
    return { code, expiresAt };
  }

  async function handleUpdate(update) {
    const message = update && update.message;
    if (!message || !message.chat || message.chat.type !== 'private' || typeof message.text !== 'string') return;

    const chatId = String(message.chat.id);
    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(message.text.trim())) {
      return reply(chatId, 'Welcome to SmartBin driver notifications. To link your account, request a one-time code from the authenticated Driver dashboard, then send /link followed by that code here.');
    }

    const match = message.text.trim().match(/^\/link(?:@\w+)?\s+([A-Za-z0-9_-]{43})$/i);
    if (!match) {
      return reply(chatId, 'To link your driver account, send /link followed by the one-time code requested while signed in to SmartBin.');
    }

    const tokenHash = crypto.createHash('sha256').update(match[1]).digest('hex');
    try {
      const linked = await UserModel.findOneAndUpdate(
        {
          role: 'driver',
          telegramLinkTokenHash: tokenHash,
          telegramLinkExpiresAt: { $gt: now() },
        },
        {
          $set: { telegramChatId: chatId },
          $unset: { telegramLinkTokenHash: 1, telegramLinkExpiresAt: 1 },
        },
        { returnDocument: 'after', runValidators: true }
      );
      if (!linked) {
        return reply(chatId, 'That link code is invalid or expired. Request a new code from your authenticated Driver dashboard.');
      }
      return reply(chatId, 'Your Telegram account is now linked to your SmartBin driver account.');
    } catch (error) {
      if (error.code === 11000) {
        return reply(chatId, 'This Telegram account cannot be linked to another driver. Contact your administrator if you need to change the account.');
      }
      throw error;
    }
  }

  function assignmentMessage({ taskType, location, binId, priority }) {
    const lines = [
      `New ${taskType === 'report' ? 'waste report' : 'collection task'} assigned`,
      `Location: ${String(location || 'Not provided').slice(0, 500)}`,
      `Bin ID: ${binId ? String(binId).slice(0, 100) : 'Not available'}`,
      `Priority: ${String(priority || 'Standard').slice(0, 40)}`,
      `Driver dashboard: ${dashboardUrl}`,
    ];
    return lines.join('\n');
  }

  async function notifyAssignment({ driver, taskType, taskId, assignedAt, location, binId, priority }) {
    if (!token) return { status: 'disabled' };
    if (!driver || !driver.telegramChatId) return { status: 'unlinked' };

    const eventId = crypto.createHash('sha256')
      .update(`${taskType}:${taskId}:${new Date(assignedAt).toISOString()}`)
      .digest('hex');
    let claim;
    try {
      claim = await NotificationModel.updateOne(
        { eventId },
        { $setOnInsert: { eventId, status: 'sending', sentAt: null } },
        { upsert: true }
      );
    } catch (error) {
      if (error.code === 11000) return { status: 'duplicate' };
      throw error;
    }
    if (!claim.upsertedCount) return { status: 'duplicate' };

    try {
      await reply(driver.telegramChatId, assignmentMessage({ taskType, location, binId, priority }));
    } catch (error) {
      await NotificationModel.updateOne({ eventId }, { $set: { status: 'failed' } });
      return { status: 'failed', errorCode: error.code || 'TELEGRAM_ERROR' };
    }

    await NotificationModel.updateOne(
      { eventId },
      { $set: { status: 'sent', sentAt: now() } }
    );
    return { status: 'sent' };
  }

  async function startPolling() {
    if (!token || pollingStarted) return;
    pollingStarted = true;
    stopped = false;
    let retryDelay = 5000;
    while (!stopped) {
      try {
        const updates = await request('getUpdates', {
          offset,
          timeout: 20,
          allowed_updates: ['message'],
        });
        retryDelay = 5000;
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          try {
            await handleUpdate(update);
          } catch (_) {
            console.error('[Telegram] Could not process a bot update.');
          }
        }
      } catch (_) {
        console.error('[Telegram] Bot polling failed; check the bot token and ensure no webhook is configured.');
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 60000);
      }
    }
    pollingStarted = false;
  }

  function stopPolling() {
    stopped = true;
  }

  return {
    isConfigured: () => Boolean(token),
    startLink,
    handleUpdate,
    notifyAssignment,
    startPolling,
    stopPolling,
  };
}

module.exports = createTelegramBot();
module.exports.createTelegramBot = createTelegramBot;
