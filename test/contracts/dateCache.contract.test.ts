/**
 * Contract tests: verify checkUserWithCache uses DateCache port (getAvailableDates, isCacheStale, isDateAvailable) as expected.
 * See docs/TESTING.md § 4, CONTRACTS.md DateCache.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkUserWithCache } from '../../src/application/checkUserWithCache';
import type { CheckUserUser } from '../../src/application/types';

interface RecordedCall {
  name: string;
  args: unknown[];
}

function makeSpyDeps(record: RecordedCall[]) {
  const recordCall = (name: string, ...args: unknown[]) => record.push({ name, args });
  const availableDates = ['2025-06-01'];
  return {
    bot: { client: {} },
    sessionHeaders: {},
    config: { cacheTtl: 60, facilityId: 134 },
    getAvailableDates: (provider: string) => {
      recordCall('getAvailableDates', provider);
      return availableDates;
    },
    isCacheStale: (date: string, ttl: number, provider: string) => {
      recordCall('isCacheStale', date, ttl, provider);
      return false;
    },
    refreshAllDates: async () => {
      recordCall('refreshAllDates');
      return [];
    },
    isDateAvailable: (dateStr: string, provider: string) => {
      recordCall('isDateAvailable', dateStr, provider);
      return true;
    },
    log: () => {},
  };
}

describe('contract: DateCache usage by checkUserWithCache', () => {
  it('calls getAvailableDates with user provider, isDateAvailable for each candidate date', async () => {
    const user: CheckUserUser = {
      email: 'cache@test.com',
      provider: 'ais',
      scheduleId: 'sched-1',
      isDateValid: (d) => d === '2025-06-01',
    };
    const recorded: RecordedCall[] = [];
    const deps = makeSpyDeps(recorded);

    const result = await checkUserWithCache(user, deps);

    assert.strictEqual(result, '2025-06-01');

    const getDatesCalls = recorded.filter((c) => c.name === 'getAvailableDates');
    assert.ok(getDatesCalls.length >= 1);
    assert.strictEqual(getDatesCalls[0].args[0], 'ais');

    const isAvailableCalls = recorded.filter((c) => c.name === 'isDateAvailable');
    assert.ok(isAvailableCalls.length >= 1);
    assert.strictEqual(isAvailableCalls[0].args[0], '2025-06-01');
    assert.strictEqual(isAvailableCalls[0].args[1], 'ais');
  });

  it('calls isCacheStale with date, ttl, provider when cache has dates', async () => {
    const user: CheckUserUser = {
      email: 'stale@test.com',
      provider: 'ais',
      scheduleId: 'sched-1',
      isDateValid: () => true,
    };
    const recorded: RecordedCall[] = [];
    const deps = makeSpyDeps(recorded);

    await checkUserWithCache(user, deps);

    const staleCalls = recorded.filter((c) => c.name === 'isCacheStale');
    assert.ok(staleCalls.length >= 1);
    assert.strictEqual(staleCalls[0].args[1], 60);
    assert.strictEqual(staleCalls[0].args[2], 'ais');
  });
});
