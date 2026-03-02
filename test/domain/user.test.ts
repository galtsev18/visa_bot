import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createUser } from '../../src/lib/user.js';

describe('User', () => {
  describe('isDateEarlierThanCurrent', () => {
    it('returns true when user has no current date', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: null,
        date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
      });
      assert.strictEqual(user.isDateEarlierThanCurrent('2025-06-15'), true);
    });

    it('returns true when date is earlier than current', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-08-01',
        date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
      });
      assert.strictEqual(user.isDateEarlierThanCurrent('2025-06-15'), true);
    });

    it('returns false when date is same as current', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-06-15',
        date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
      });
      assert.strictEqual(user.isDateEarlierThanCurrent('2025-06-15'), false);
    });

    it('returns false when date is later than current', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-06-01',
        date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
      });
      assert.strictEqual(user.isDateEarlierThanCurrent('2025-08-01'), false);
    });
  });

  describe('isDateInRange', () => {
    it('returns true when date is inside a range', () => {
      const user = createUser({
        email: 'a@b.com',
        date_ranges: [{ from: '2025-06-01', to: '2025-06-30' }],
      });
      assert.strictEqual(user.isDateInRange('2025-06-15'), true);
    });

    it('returns false when date is outside ranges', () => {
      const user = createUser({
        email: 'a@b.com',
        date_ranges: [{ from: '2025-06-01', to: '2025-06-30' }],
      });
      assert.strictEqual(user.isDateInRange('2025-07-01'), false);
    });

    it('returns false when no date ranges', () => {
      const user = createUser({ email: 'a@b.com', date_ranges: [] });
      assert.strictEqual(user.isDateInRange('2025-06-15'), false);
    });
  });

  describe('isDateAfterReactionTime', () => {
    it('returns true when reactionTime is 0', () => {
      const user = createUser({
        email: 'a@b.com',
        reaction_time: 0,
      });
      assert.strictEqual(user.isDateAfterReactionTime('2025-01-01'), true);
    });

    it('returns true when date is at or after today + reaction_time', () => {
      const user = createUser({
        email: 'a@b.com',
        reaction_time: 1,
      });
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const y = tomorrow.getFullYear();
      const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const d = String(tomorrow.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      assert.strictEqual(user.isDateAfterReactionTime(dateStr), true);
    });
  });

  describe('isDateValid', () => {
    it('returns true when date is earlier, in range, and after reaction time', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-12-01',
        reaction_time: 0,
        date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
      });
      assert.strictEqual(user.isDateValid('2025-06-15'), true);
    });

    it('returns false when date is not in range', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-12-01',
        reaction_time: 0,
        date_ranges: [{ from: '2025-01-01', to: '2025-05-31' }],
      });
      assert.strictEqual(user.isDateValid('2025-06-15'), false);
    });

    it('returns false when date is not earlier than current', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-06-01',
        reaction_time: 0,
        date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
      });
      assert.strictEqual(user.isDateValid('2025-08-01'), false);
    });
  });

  describe('needsAppointment', () => {
    it('returns true when user has no current date', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: null,
        date_ranges: [{ from: '2025-01-01', to: '2025-12-31' }],
      });
      assert.strictEqual(user.needsAppointment(), true);
    });

    it('returns true when current date is outside ranges', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-07-15',
        date_ranges: [{ from: '2025-01-01', to: '2025-06-30' }],
      });
      assert.strictEqual(user.needsAppointment(), true);
    });

    it('returns false when current date is inside a range', () => {
      const user = createUser({
        email: 'a@b.com',
        current_date: '2025-06-15',
        date_ranges: [{ from: '2025-06-01', to: '2025-06-30' }],
      });
      assert.strictEqual(user.needsAppointment(), false);
    });
  });
});
