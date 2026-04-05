import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getNextUser, updateUserPriority } from '../../src/domain/userRotation.js';
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

describe('userRotation', () => {
  describe('getNextUser', () => {
    it('returns null when users array is empty', () => {
      assert.strictEqual(getNextUser([], 30), null);
    });

    it('returns null when no active users', () => {
      const user = makeUser({ active: false });
      assert.strictEqual(getNextUser([user], 30), null);
    });

    it('returns null when all users do not need appointment', () => {
      const user = makeUser({
        current_date: '2025-06-15',
        date_ranges: [{ from: '2025-06-01', to: '2025-06-30' }],
      });
      assert.strictEqual(user.needsAppointment(), false);
      assert.strictEqual(getNextUser([user], 30), null);
    });

    it('returns the only user who needs appointment', () => {
      const user = makeUser({ email: 'only@test.com' });
      const selected = getNextUser([user], 30);
      assert.ok(selected);
      assert.strictEqual(selected.email, 'only@test.com');
    });

    it('prefers user not checked recently over one checked recently', () => {
      const old = makeUser({
        email: 'old@test.com',
        last_checked: new Date(Date.now() - 100 * 1000),
      });
      const neverChecked = makeUser({
        email: 'new@test.com',
        last_checked: null,
      });
      const selected = getNextUser([old, neverChecked], 30);
      assert.ok(selected);
      assert.strictEqual(selected.email, 'new@test.com');
    });

    it('prefers user with longer time since last check', () => {
      const recent = makeUser({
        email: 'recent@test.com',
        last_checked: new Date(Date.now() - 10 * 1000),
      });
      const older = makeUser({
        email: 'older@test.com',
        last_checked: new Date(Date.now() - 60 * 1000),
      });
      const selected = getNextUser([recent, older], 30);
      assert.ok(selected);
      assert.strictEqual(selected.email, 'older@test.com');
    });
  });

  describe('updateUserPriority', () => {
    it('sets priority to 0 and lastChecked', () => {
      const user = makeUser({ priority: 100 });
      const checkedAt = new Date();
      updateUserPriority(user, checkedAt);
      assert.strictEqual(user.priority, 0);
      assert.strictEqual(user.lastChecked, checkedAt);
    });
  });
});
