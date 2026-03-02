import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkUserWithCache } from '../../src/application/checkUserWithCache.js';

function makeUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: 'u@test.com',
    provider: 'ais',
    scheduleId: '123',
    isDateValid: (date: string) => date >= '2025-06-01' && date <= '2025-06-30',
    ...overrides,
  };
}

describe('checkUserWithCache', () => {
  it('returns null when bot is not initialized', async () => {
    const logCalls: string[] = [];
    const result = await checkUserWithCache(makeUser(), {
      bot: null,
      sessionHeaders: null,
      config: { cacheTtl: 60 },
      getAvailableDates: () => [],
      isCacheStale: () => false,
      refreshAllDates: async () => {},
      isDateAvailable: () => true,
      log: (msg: string) => logCalls.push(msg),
    });
    assert.strictEqual(result, null);
    assert.ok(logCalls.some((m) => m.includes('bot not initialized')));
  });

  it('returns first valid date when cache has dates', async () => {
    const result = await checkUserWithCache(makeUser(), {
      bot: { client: {} },
      sessionHeaders: {},
      config: { cacheTtl: 60, facilityId: 134 },
      getAvailableDates: () => ['2025-06-15', '2025-06-20'],
      isCacheStale: () => false,
      refreshAllDates: async () => {},
      isDateAvailable: (date: string) => date === '2025-06-15' || date === '2025-06-20',
      log: () => {},
    });
    assert.strictEqual(result, '2025-06-15');
  });

  it('returns null when no valid dates in cache', async () => {
    const result = await checkUserWithCache(makeUser(), {
      bot: { client: {} },
      sessionHeaders: {},
      config: { cacheTtl: 60 },
      getAvailableDates: () => ['2025-07-15'],
      isCacheStale: () => false,
      refreshAllDates: async () => {},
      isDateAvailable: () => true,
      log: () => {},
    });
    assert.strictEqual(result, null);
  });
});
