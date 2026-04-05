/**
 * Monitor-style integration with a single vfsglobal user and vfsglobal cache rows only (no AIS/US sheet paths).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createUser, User } from '../../src/lib/user.js';
import { checkUserWithCache } from '../../src/application/checkUserWithCache.js';
import { createDateCache } from '../../src/lib/dateCache.js';
import { DateCacheAdapter } from '../../src/adapters/DateCacheAdapter.js';
import { UserBotManager } from '../../src/lib/userBotManager.js';
import type { UserRepository } from '../../src/ports/UserRepository.js';
import type { DateCache } from '../../src/ports/DateCache.js';
import type { NotificationSender } from '../../src/ports/NotificationSender.js';

function makeVfsUser(): User {
  return createUser({
    email: 'vfs-monitor@test.com',
    password: 'secret',
    country_code: 'rus/en/fra',
    schedule_id: '',
    current_date: '2025-08-01',
    reaction_time: 0,
    date_ranges: [{ from: '2025-06-01', to: '2025-06-30' }],
    active: true,
    provider: 'vfsglobal',
    vfs_centre: 'Test Centre',
    vfs_category: 'Visit',
    vfs_subcategory: 'Standard',
    rowIndex: 1,
  });
}

function makeConfig(): Record<string, unknown> {
  return {
    cacheTtl: 60,
    facilityId: 134,
    telegramManagerChatId: 'test-chat',
    aisRequestDelaySec: 2,
    vfsRequestDelaySec: 2,
    rotationCooldown: 30,
    refreshInterval: 3,
    sheetsRefreshInterval: 300,
  };
}

describe('VFS: monitor one cycle (mocked)', () => {
  it('checkUserWithCache returns cached date for provider vfsglobal', async () => {
    const config = makeConfig();
    const mockUser = makeVfsUser();
    const logCalls: string[] = [];

    const dateCacheBackend = createDateCache({
      persist: async () => {},
    });
    await dateCacheBackend.initializeCache([
      {
        date: '2025-06-01',
        available: true,
        provider: 'vfsglobal',
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

    assert.strictEqual(date, '2025-06-01');
    assert.strictEqual(mockUser.provider, 'vfsglobal');
  });

  it('UserBotManager.runOneCycle with vfsglobal user sends notifications (mocked repo)', async () => {
    const user = makeVfsUser();
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
      updateUserAfterCheck: async () => {},
      logBookingAttempt: async () => {},
      updateAvailableDate: async () => {},
    };

    const dateCacheBackend = createDateCache({ persist: async () => {} });
    await dateCacheBackend.initializeCache([
      {
        date: '2025-06-01',
        available: true,
        provider: 'vfsglobal',
        cache_valid_until: new Date(Date.now() + 120000).toISOString(),
      },
    ]);
    const dateCache: DateCache = new DateCacheAdapter(dateCacheBackend);

    const manager = new UserBotManager(makeConfig(), { repo, dateCache, notifications: notif });
    manager.users = [user];
    manager.bots.set(user.email, { client: {} } as never);
    manager.sessions.set(user.email, {});

    await manager.runOneCycle([], { skipSheetsRefresh: true });

    assert.ok(sent.some((m) => m.includes('Monitor Started')));
    assert.ok(sent.some((m) => m.includes('Matching Slot Found')));
  });
});
