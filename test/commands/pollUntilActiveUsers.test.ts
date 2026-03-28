import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createUser, User } from '../../src/lib/user.js';
import { createDateCache } from '../../src/lib/dateCache.js';
import { DateCacheAdapter } from '../../src/adapters/DateCacheAdapter.js';
import { pollUntilActiveUsersFromSheets } from '../../src/commands/pollUntilActiveUsers.js';

function makeUser(): User {
  return createUser({
    email: 'u@test.com',
    password: 'p',
    country_code: 'kz',
    schedule_id: '1',
    current_date: '2025-08-01',
    reaction_time: 0,
    date_ranges: [{ from: '2025-06-01', to: '2025-06-30' }],
    active: true,
    provider: 'ais',
  });
}

describe('pollUntilActiveUsersFromSheets', () => {
  it('returns immediately when initial users non-empty', async () => {
    const u = makeUser();
    const backend = createDateCache({ persist: async () => {} });
    await backend.initializeCache([]);
    const dateCache = new DateCacheAdapter(backend);
    let calls = 0;
    const repo = {
      getInitialData: async () => {
        calls++;
        return { users: [u], cacheEntries: [] };
      },
    };
    const out = await pollUntilActiveUsersFromSheets(
      { sheetsRefreshInterval: 1 },
      repo,
      dateCache,
      { users: [u], cacheEntries: [] }
    );
    assert.strictEqual(out.users.length, 1);
    assert.strictEqual(calls, 0);
  });

  it('polls until getInitialData returns at least one user', async () => {
    const u = makeUser();
    const backend = createDateCache({ persist: async () => {} });
    await backend.initializeCache([]);
    const dateCache = new DateCacheAdapter(backend);
    let n = 0;
    const repo = {
      getInitialData: async () => {
        n++;
        if (n < 2) return { users: [], cacheEntries: [] };
        return { users: [u], cacheEntries: [] };
      },
    };
    const out = await pollUntilActiveUsersFromSheets(
      { sheetsRefreshInterval: 1 },
      repo,
      dateCache,
      { users: [], cacheEntries: [] }
    );
    assert.strictEqual(out.users.length, 1);
    assert.strictEqual(out.users[0].email, u.email);
    assert.strictEqual(n, 2);
  });
});
