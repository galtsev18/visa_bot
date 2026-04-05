/**
 * VFS-only domain checks (pause flags, vfsglobal provider). Does not exercise AIS/US-specific flows.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { filterUsersForRotation } from '../../src/domain/userRotation.js';
import { createUser, User } from '../../src/lib/user.js';
import type { RawUserInput } from '../../src/lib/user.js';

function makeUser(overrides: Partial<RawUserInput> = {}): User {
  return createUser({
    email: 'u@test.com',
    active: true,
    current_date: null,
    last_checked: null,
    last_booked: null,
    priority: 0,
    date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
    ...overrides,
  });
}

describe('VFS: filterUsersForRotation', () => {
  it('when pause US is true, only vfsglobal users remain', () => {
    const ais = makeUser({ email: 'ais@test.com', provider: 'ais' });
    const vfs = makeUser({ email: 'vfs@test.com', provider: 'vfsglobal' });
    const out = filterUsersForRotation([ais, vfs], true, false);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].email, 'vfs@test.com');
    assert.strictEqual(out[0].provider, 'vfsglobal');
  });

  it('when pause VFS is true, vfsglobal users are excluded', () => {
    const ais = makeUser({ email: 'ais@test.com', provider: 'ais' });
    const vfs = makeUser({ email: 'vfs@test.com', provider: 'vfsglobal' });
    const out = filterUsersForRotation([ais, vfs], false, true);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].email, 'ais@test.com');
  });

  it('keeps both providers when neither pause is set', () => {
    const ais = makeUser({ email: 'ais@test.com', provider: 'ais' });
    const vfs = makeUser({ email: 'vfs@test.com', provider: 'vfsglobal' });
    assert.strictEqual(filterUsersForRotation([ais, vfs], false, false).length, 2);
  });
});
