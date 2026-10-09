const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createTelegramBot } = require('../utils/telegramBot');

function mockModels() {
  const drivers = new Map([
    ['driver-one', { _id: 'driver-one', role: 'driver', username: 'one' }],
    ['driver-two', { _id: 'driver-two', role: 'driver', username: 'two' }],
  ]);
  const notifications = new Map();

  const UserModel = {
    async updateOne(filter, update) {
      const driver = drivers.get(String(filter._id));
      if (!driver || driver.role !== filter.role) return { matchedCount: 0 };
      Object.assign(driver, update.$set);
      return { matchedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      const driver = [...drivers.values()].find(user =>
        user.role === filter.role &&
        user.telegramLinkTokenHash === filter.telegramLinkTokenHash &&
        user.telegramLinkExpiresAt > filter.telegramLinkExpiresAt.$gt
      );
      if (!driver) return null;
      const existingChatOwner = [...drivers.values()].find(user =>
        user !== driver && user.telegramChatId === update.$set.telegramChatId
      );
      if (existingChatOwner) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      Object.assign(driver, update.$set);
      delete driver.telegramLinkTokenHash;
      delete driver.telegramLinkExpiresAt;
      return driver;
    },
  };

  const NotificationModel = {
    async updateOne(filter, update, options) {
      const id = filter.eventId;
      if (options && options.upsert && !notifications.has(id)) {
        notifications.set(id, Object.assign({}, update.$setOnInsert));
        return { upsertedCount: 1 };
      }
      if (notifications.has(id) && update.$set) {
        Object.assign(notifications.get(id), update.$set);
      }
      return { upsertedCount: 0 };
    },
  };

  return { drivers, notifications, UserModel, NotificationModel };
}

function telegramOk(result = {}) {
  return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
}

test('a one-time account-bound code links the authenticated driver without username matching', async () => {
  const models = mockModels();
  const sent = [];
  const now = new Date('2026-10-09T12:00:00Z');
  const bot = createTelegramBot({
    token: 'mock-test-token',
    UserModel: models.UserModel,
    NotificationModel: models.NotificationModel,
    now: () => now,
    randomBytes: () => Buffer.alloc(32, 7),
    fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return telegramOk();
    },
  });

  const link = await bot.startLink('driver-one');
  assert.equal(link.code.length, 43);
  assert.equal(models.drivers.get('driver-one').telegramLinkTokenHash, crypto.createHash('sha256').update(link.code).digest('hex'));
  assert.notEqual(models.drivers.get('driver-one').telegramLinkTokenHash, link.code);
  assert.equal(link.expiresAt.getTime() - now.getTime(), 10 * 60 * 1000);

  await bot.handleUpdate({
    message: {
      chat: { id: 123456, type: 'private' },
      from: { username: 'a-different-telegram-name' },
      text: `/link ${link.code}`,
    },
  });

  assert.equal(models.drivers.get('driver-one').telegramChatId, '123456');
  assert.equal(models.drivers.get('driver-two').telegramChatId, undefined);
  assert.equal(models.drivers.get('driver-one').telegramLinkTokenHash, undefined);
  assert.match(sent[0].text, /linked to your SmartBin driver account/);

  await bot.handleUpdate({
    message: { chat: { id: 789, type: 'private' }, text: `/link ${link.code}` },
  });
  assert.equal(models.drivers.get('driver-two').telegramChatId, undefined);
  assert.match(sent[1].text, /invalid or expired/);
});

test('a valid code cannot be used from a group chat', async () => {
  const models = mockModels();
  const sent = [];
  const bot = createTelegramBot({
    token: 'mock-test-token',
    UserModel: models.UserModel,
    NotificationModel: models.NotificationModel,
    randomBytes: () => Buffer.alloc(32, 9),
    fetchImpl: async (_url, options) => {
      sent.push(options.body);
      return telegramOk();
    },
  });
  const link = await bot.startLink('driver-one');

  await bot.handleUpdate({
    message: { chat: { id: -123, type: 'group' }, text: `/link ${link.code}` },
  });

  assert.equal(models.drivers.get('driver-one').telegramChatId, undefined);
  assert.equal(sent.length, 0);
});

test('link codes expire after ten minutes', async () => {
  const models = mockModels();
  const sent = [];
  let currentTime = new Date('2026-10-09T12:00:00Z');
  const bot = createTelegramBot({
    token: 'mock-test-token',
    UserModel: models.UserModel,
    NotificationModel: models.NotificationModel,
    now: () => currentTime,
    randomBytes: () => Buffer.alloc(32, 5),
    fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return telegramOk();
    },
  });
  const link = await bot.startLink('driver-one');
  currentTime = new Date(currentTime.getTime() + 10 * 60 * 1000 + 1);

  await bot.handleUpdate({
    message: { chat: { id: 456, type: 'private' }, text: `/link ${link.code}` },
  });

  assert.equal(models.drivers.get('driver-one').telegramChatId, undefined);
  assert.match(sent[0].text, /invalid or expired/);
});

test('assignment notification includes task details and deduplicates the same assignment', async () => {
  const models = mockModels();
  const sent = [];
  const bot = createTelegramBot({
    token: 'mock-test-token',
    dashboardUrl: 'https://smartbin.example/driver.html',
    NotificationModel: models.NotificationModel,
    fetchImpl: async (url, options) => {
      sent.push({ method: url.split('/').pop(), body: JSON.parse(options.body) });
      return telegramOk();
    },
  });
  const assignment = {
    driver: { telegramChatId: 'driver-chat-1' },
    taskType: 'report',
    taskId: 'report-123',
    assignedAt: new Date('2026-10-09T12:00:00Z'),
    location: 'Adama Central',
    binId: 'BIN-007',
    priority: 'urgent',
  };

  assert.deepEqual(await bot.notifyAssignment(assignment), { status: 'sent' });
  assert.deepEqual(await bot.notifyAssignment(assignment), { status: 'duplicate' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].body.chat_id, 'driver-chat-1');
  assert.match(sent[0].body.text, /waste report assigned/);
  assert.match(sent[0].body.text, /Location: Adama Central/);
  assert.match(sent[0].body.text, /Bin ID: BIN-007/);
  assert.match(sent[0].body.text, /Priority: urgent/);
  assert.match(sent[0].body.text, /https:\/\/smartbin\.example\/driver\.html/);
  assert.equal([...models.notifications.values()][0].status, 'sent');
});

test('unlinked drivers are skipped without calling Telegram', async () => {
  const models = mockModels();
  let apiCalls = 0;
  const bot = createTelegramBot({
    token: 'mock-test-token',
    UserModel: models.UserModel,
    NotificationModel: models.NotificationModel,
    fetchImpl: async () => { apiCalls += 1; return telegramOk(); },
  });

  const result = await bot.notifyAssignment({
    driver: { _id: 'driver-one' },
    taskType: 'collection',
    taskId: 'task-1',
    assignedAt: new Date(),
  });

  assert.deepEqual(result, { status: 'unlinked' });
  assert.equal(apiCalls, 0);
});

test('Telegram API failure is reported as a delivery failure without throwing', async () => {
  const models = mockModels();
  const bot = createTelegramBot({
    token: 'mock-test-token',
    NotificationModel: models.NotificationModel,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, error_code: 429 }),
    }),
  });

  const result = await bot.notifyAssignment({
    driver: { telegramChatId: 'driver-chat-2' },
    taskType: 'collection',
    taskId: 'task-2',
    assignedAt: new Date('2026-10-09T12:05:00Z'),
    location: 'Adama East',
    priority: 'Standard',
  });

  assert.deepEqual(result, { status: 'failed', errorCode: 429 });
  assert.equal([...models.notifications.values()][0].status, 'failed');
});

test('Telegram features report disabled when no server token is configured', async () => {
  const models = mockModels();
  const bot = createTelegramBot({
    token: '',
    UserModel: models.UserModel,
    NotificationModel: models.NotificationModel,
  });

  assert.equal(bot.isConfigured(), false);
  assert.equal(await bot.startLink('driver-one'), null);
  assert.deepEqual(await bot.notifyAssignment({
    driver: { telegramChatId: 'driver-chat-1' },
    taskType: 'report',
    taskId: 'report-1',
    assignedAt: new Date(),
  }), { status: 'disabled' });
});
