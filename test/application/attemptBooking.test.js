import { describe, it } from 'node:test';
import assert from 'node:assert';
import { attemptBooking } from '../../src/application/attemptBooking.js';

function makeUser(overrides = {}) {
  return {
    email: 'u@test.com',
    currentDate: '2025-08-01',
    lastBooked: null,
    rowIndex: 2,
    ...overrides,
  };
}

describe('attemptBooking', () => {
  it('returns false and logs when bot is not initialized', async () => {
    const logAttemptCalls = [];
    const user = makeUser();
    const result = await attemptBooking(user, '2025-06-15', {
      bot: null,
      sessionHeaders: null,
      config: { telegramManagerChatId: '123' },
      updateUserCurrentDate: async () => {},
      updateUserLastBooked: async () => {},
      logBookingAttempt: async (a) => logAttemptCalls.push(a),
      sendNotification: async () => {},
      formatBookingSuccessWithDetails: () => '',
      formatBookingFailure: () => '',
      log: () => {},
    });
    assert.strictEqual(result, false);
    assert.strictEqual(logAttemptCalls.length, 1);
    assert.strictEqual(logAttemptCalls[0].result, 'failure');
  });

  it('returns true and updates user when booking succeeds', async () => {
    const user = makeUser();
    const updates = [];
    const logs = [];
    const notifications = [];

    const result = await attemptBooking(user, '2025-06-15', {
      bot: {
        bookAppointment: async () => ({ success: true, time: '09:00' }),
      },
      sessionHeaders: {},
      config: { telegramManagerChatId: '123' },
      updateUserCurrentDate: async (email, date, timeSlot, rowIndex) => {
        updates.push({ type: 'currentDate', email, date, timeSlot, rowIndex });
      },
      updateUserLastBooked: async (email, date, timeSlot, rowIndex) => {
        updates.push({ type: 'lastBooked', email, date, timeSlot, rowIndex });
      },
      logBookingAttempt: async (a) => logs.push(a),
      sendNotification: async (msg) => notifications.push(msg),
      formatBookingSuccessWithDetails: () => 'Booked!',
      formatBookingFailure: () => '',
      log: () => {},
    });

    assert.strictEqual(result, true);
    assert.strictEqual(user.currentDate, '2025-06-15');
    assert.strictEqual(user.lastBooked, '2025-06-15');
    assert.strictEqual(updates.length, 2);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].result, 'success');
    assert.strictEqual(notifications.length, 1);
  });

  it('returns false when bookAppointment returns no success', async () => {
    const user = makeUser();
    const logs = [];

    const result = await attemptBooking(user, '2025-06-15', {
      bot: { bookAppointment: async () => null },
      sessionHeaders: {},
      config: { telegramManagerChatId: '123' },
      updateUserCurrentDate: async () => {},
      updateUserLastBooked: async () => {},
      logBookingAttempt: async (a) => logs.push(a),
      sendNotification: async () => {},
      formatBookingSuccessWithDetails: () => '',
      formatBookingFailure: () => 'Failed',
      log: () => {},
    });

    assert.strictEqual(result, false);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].result, 'failure');
  });
});
