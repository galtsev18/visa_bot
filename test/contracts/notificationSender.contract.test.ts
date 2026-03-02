/**
 * Contract tests: verify use cases call NotificationSender.send with expected usage.
 * See docs/TESTING.md § 4, CONTRACTS.md NotificationSender.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { startMonitor } from '../../src/application/startMonitor';
import type { CacheEntry } from '../../src/application/types';

describe('contract: NotificationSender usage by use cases', () => {
  it('startMonitor calls sendNotification with non-empty message and config chatId', async () => {
    const entries: CacheEntry[] = [{ date: '2025-06-01', provider: 'ais' }];
    let sentMsg = '';
    let sentChatId = '';

    await startMonitor(entries, {
      initializeCache: async () => {},
      getCacheStats: () => ({ total: 1, providers: { ais: { entries: 1, available: 0 } } }),
      formatMonitorStarted: () => 'Monitor started',
      sendNotification: async (msg, chatId) => {
        sentMsg = msg;
        sentChatId = chatId;
      },
      users: [],
      config: { telegramManagerChatId: 'manager-123' },
    });

    assert.strictEqual(sentMsg, 'Monitor started');
    assert.strictEqual(sentChatId, 'manager-123');
  });

  it('startMonitor passes getCacheStats result to formatMonitorStarted', async () => {
    const entries: CacheEntry[] = [];
    let formatReceivedStats: { total: number } | null = null;

    await startMonitor(entries, {
      initializeCache: async () => {},
      getCacheStats: () => ({ total: 42, providers: {} }),
      formatMonitorStarted: (_users, _config, stats) => {
        formatReceivedStats = stats;
        return 'Started';
      },
      sendNotification: async () => {},
      users: [],
      config: {},
    });

    assert.ok(formatReceivedStats);
    assert.strictEqual(formatReceivedStats!.total, 42);
  });
});
