/**
 * Contract tests: verify use cases call UserRepository with expected signatures and shapes.
 * See docs/TESTING.md § 4, docs/ROADMAP.md item 2, CONTRACTS.md UserRepository.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { attemptBooking } from '../../src/application/attemptBooking';
import type { UserRepository } from '../../src/ports/UserRepository';
import type { AttemptBookingUser } from '../../src/application/types';

interface RecordedCall {
  method: string;
  args: unknown[];
}

function createSpyRepo(record: RecordedCall[]): UserRepository {
  const recordCall = (method: string, ...args: unknown[]) => {
    record.push({ method, args });
  };
  return {
    initialize: async () => {},
    getActiveUsers: async () => [],
    getSettingsOverrides: async () => ({}),
    getInitialData: async () => ({ users: [], cacheEntries: [] }),
    updateUserLastChecked: async (...args) => recordCall('updateUserLastChecked', ...args),
    updateUserCurrentDate: async (...args) => recordCall('updateUserCurrentDate', ...args),
    updateUserLastBooked: async (...args) => recordCall('updateUserLastBooked', ...args),
    updateUserPriority: async (...args) => recordCall('updateUserPriority', ...args),
    logBookingAttempt: async (attempt) => recordCall('logBookingAttempt', attempt),
    updateAvailableDate: async () => {},
  };
}

describe('contract: UserRepository usage by use cases', () => {
  it('attemptBooking success calls updateUserCurrentDate, updateUserLastBooked, logBookingAttempt with expected shapes', async () => {
    const user: AttemptBookingUser = {
      email: 'contract@test.com',
      currentDate: '2025-07-01',
      lastBooked: null,
      rowIndex: 2,
    };
    const recorded: RecordedCall[] = [];
    const repo = createSpyRepo(recorded);

    await attemptBooking(
      user,
      '2025-06-15',
      {
        bot: {
          bookAppointment: async () => ({ success: true, time: '09:00' }),
        },
        sessionHeaders: {},
        config: { telegramManagerChatId: 'chat-1' },
        updateUserCurrentDate: (e, d, t, r) => repo.updateUserCurrentDate(e, d, t ?? null, r),
        updateUserLastBooked: (e, d, t, r) => repo.updateUserLastBooked(e, d, t ?? null, r),
        logBookingAttempt: (a) => repo.logBookingAttempt(a),
        sendNotification: async () => {},
        formatBookingSuccessWithDetails: () => 'Booked',
        formatBookingFailure: () => 'Failed',
        log: () => {},
      }
    );

    const updateCurrent = recorded.find((c) => c.method === 'updateUserCurrentDate');
    const updateLastBooked = recorded.find((c) => c.method === 'updateUserLastBooked');
    const logAttempt = recorded.find((c) => c.method === 'logBookingAttempt');

    assert.ok(updateCurrent, 'updateUserCurrentDate should be called');
    assert.strictEqual(updateCurrent!.args[0], 'contract@test.com');
    assert.strictEqual(updateCurrent!.args[1], '2025-06-15');
    assert.strictEqual(updateCurrent!.args[2], '09:00');
    assert.strictEqual(updateCurrent!.args[3], 2);

    assert.ok(updateLastBooked, 'updateUserLastBooked should be called');
    assert.strictEqual(updateLastBooked!.args[0], 'contract@test.com');
    assert.strictEqual(updateLastBooked!.args[1], '2025-06-15');

    assert.ok(logAttempt, 'logBookingAttempt should be called');
    const attempt = logAttempt!.args[0] as Record<string, unknown>;
    assert.strictEqual(attempt.user_email, 'contract@test.com');
    assert.strictEqual(attempt.result, 'success');
    assert.strictEqual(attempt.new_date, '2025-06-15');
    assert.strictEqual(attempt.new_time, '09:00');
  });

  it('attemptBooking failure (no bot) calls logBookingAttempt with result failure', async () => {
    const user: AttemptBookingUser = {
      email: 'nobot@test.com',
      currentDate: '2025-07-01',
      lastBooked: null,
    };
    const recorded: RecordedCall[] = [];
    const repo = createSpyRepo(recorded);

    await attemptBooking(user, '2025-06-15', {
      bot: null,
      sessionHeaders: null,
      config: {},
      updateUserCurrentDate: async () => {},
      updateUserLastBooked: async () => {},
      logBookingAttempt: (a) => repo.logBookingAttempt(a),
      sendNotification: async () => {},
      formatBookingSuccessWithDetails: () => '',
      formatBookingFailure: () => '',
      log: () => {},
    });

    const logAttempt = recorded.find((c) => c.method === 'logBookingAttempt');
    assert.ok(logAttempt);
    const attempt = logAttempt!.args[0] as Record<string, unknown>;
    assert.strictEqual(attempt.result, 'failure');
    assert.ok(typeof attempt.reason === 'string');
  });
});
