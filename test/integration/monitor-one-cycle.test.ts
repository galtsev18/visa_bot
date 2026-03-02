/**
 * Integration tests: monitor flow with mocked ports.
 * See docs/TESTING.md "Целевой сценарий: интеграционный тест команды monitor".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { User } from '../../src/lib/user';
import { checkUserWithCache } from '../../src/application/checkUserWithCache';
import { createDateCache } from '../../src/lib/dateCache';
import { DateCacheAdapter } from '../../src/adapters/DateCacheAdapter';
import { UserBotManager } from '../../src/lib/userBotManager';
import type { UserRepository } from '../../src/ports/UserRepository';
import type { DateCache } from '../../src/ports/DateCache';
import type { NotificationSender } from '../../src/ports/NotificationSender';

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cacheTtl: 60,
    facilityId: 134,
    telegramManagerChatId: 'test-chat',
    aisRequestDelaySec: 2,
    rotationCooldown: 30,
    refreshInterval: 3,
    sheetsRefreshInterval: 300,
    ...overrides,
  };
}

function makeMockUser(): User {
  return new User({
    email: 'integration@test.com',
    password: 'secret',
    country_code: 'kz',
    schedule_id: 'sched-1',
    current_date: '2025-08-01',
    reaction_time: 0,
    date_ranges: [{ from: '2025-06-01', to: '2025-06-30' }],
    active: true,
    provider: 'ais',
    rowIndex: 1,
  });
}

describe('integration: monitor one cycle', () => {
  it('createDateCache + DateCacheAdapter + checkUserWithCache returns valid date from cache', async () => {
    const config = makeConfig();
    const mockUser = makeMockUser();
    const logCalls: string[] = [];

    const dateCacheBackend = createDateCache({
      persist: async () => {},
    });
    await dateCacheBackend.initializeCache([
      {
        date: '2025-06-01',
        available: true,
        provider: 'ais',
        cache_valid_until: new Date(Date.now() + 120000).toISOString(),
      },
    ]);
    const dateCache = new DateCacheAdapter(dateCacheBackend);

    const date = await checkUserWithCache(mockUser, {
      bot: { client: {} },
      sessionHeaders: {},
      config,
      getAvailableDates: (provider: string) => dateCache.getAvailableDates(provider),
      isCacheStale: (dateStr: string, ttl: number, provider: string) =>
        dateCache.isCacheStale(dateStr, ttl, provider),
      refreshAllDates: (a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f?: unknown, g?: unknown) =>
        dateCache.refreshAllDates(a as never, b as never, c as never, d as never, e as never, f as never, g as never),
      isDateAvailable: (dateStr: string, provider: string) =>
        dateCache.isDateAvailable(dateStr, provider),
      log: (msg: string) => logCalls.push(msg),
    });

    assert.strictEqual(date, '2025-06-01', 'checkUserWithCache should return the only valid date from cache');
    assert.strictEqual(dateCache.getCacheStats().total, 1);
  });

  it('UserBotManager.runOneCycle: startMonitor + one user check with mocked repo, dateCache, notifications', async () => {
    const user = makeMockUser();
    const sent: string[] = [];
    const notif: NotificationSender = {
      send: async (msg: string) => {
        sent.push(msg);
        return true;
      },
    };

    const repo: UserRepository = {
      initialize: async () => {},
      getActiveUsers: async () => [user],
      getSettingsOverrides: async () => ({}),
      getInitialData: async () => ({ users: [user], cacheEntries: [] }),
      updateUserLastChecked: async () => {},
      updateUserCurrentDate: async () => {},
      updateUserLastBooked: async () => {},
      updateUserPriority: async () => {},
      logBookingAttempt: async () => {},
      updateAvailableDate: async () => {},
    };

    const dateCacheBackend = createDateCache({ persist: async () => {} });
    await dateCacheBackend.initializeCache([
      {
        date: '2025-06-01',
        available: true,
        provider: 'ais',
        cache_valid_until: new Date(Date.now() + 120000).toISOString(),
      },
    ]);
    const dateCache: DateCache = new DateCacheAdapter(dateCacheBackend);

    const config = makeConfig();
    const manager = new UserBotManager(config, { repo, dateCache, notifications: notif });
    manager.users = [user];
    manager.bots.set(user.email, { client: {} } as never);
    manager.sessions.set(user.email, {});

    await manager.runOneCycle([], { skipSheetsRefresh: true });

    assert.ok(sent.some((m) => m.includes('Monitor Started')), 'should send Monitor started');
    assert.ok(sent.some((m) => m.includes('Matching Slot Found')), 'should send slot found for cached date');
    assert.ok(sent.length >= 2, 'at least Monitor started and Slot found');
  });
});
