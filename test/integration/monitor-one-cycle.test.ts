/**
 * Integration test: one cycle of monitor flow with mocked ports.
 * See docs/TESTING.md "Целевой сценарий: интеграционный тест команды monitor".
 * Uses real createDateCache + DateCacheAdapter + checkUserWithCache use case; no UserBotManager
 * (to avoid pulling in lib/telegram and node-telegram-bot-api). No real Sheets, Telegram, or AIS.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { User } from '../../src/lib/user.js';
import { checkUserWithCache } from '../../src/application/checkUserWithCache.js';
import { createDateCache } from '../../src/lib/dateCache.js';
import { DateCacheAdapter } from '../../src/adapters/DateCacheAdapter.js';

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cacheTtl: 60,
    facilityId: 134,
    aisRequestDelaySec: 2,
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
});
