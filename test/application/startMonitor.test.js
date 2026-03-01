import { describe, it } from 'node:test';
import assert from 'node:assert';
import { startMonitor } from '../../src/application/startMonitor.js';

describe('startMonitor', () => {
  it('calls initializeCache with entries, getCacheStats, and sendNotification', async () => {
    const entries = [{ date: '2025-06-01', provider: 'ais' }];
    let initCalled = false;
    let statsCalled = false;
    let sendCalled = false;
    let sendMsg = '';
    let sendChatId = '';

    await startMonitor(entries, {
      initializeCache: (e) => {
        initCalled = true;
        assert.deepStrictEqual(e, entries);
        return Promise.resolve();
      },
      getCacheStats: () => {
        statsCalled = true;
        return { total: 1, providers: { ais: { entries: 1, available: 0 } } };
      },
      formatMonitorStarted: (users, config, stats) => {
        assert.strictEqual(stats.total, 1);
        return 'Monitor started';
      },
      sendNotification: (msg, chatId) => {
        sendCalled = true;
        sendMsg = msg;
        sendChatId = chatId;
        return Promise.resolve();
      },
      users: [],
      config: { telegramManagerChatId: '123' },
    });

    assert.strictEqual(initCalled, true);
    assert.strictEqual(statsCalled, true);
    assert.strictEqual(sendCalled, true);
    assert.strictEqual(sendMsg, 'Monitor started');
    assert.strictEqual(sendChatId, '123');
  });
});
