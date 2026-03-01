/**
 * Use case: attempt to book an appointment for a user on a given date.
 * On success: updates user state, sheets, logs attempt, sends Telegram notification.
 *
 * @param {{ email: string; currentDate: string | null; lastBooked: string | null; rowIndex?: number | null }} user - Mutated on success
 * @param {string} date - YYYY-MM-DD to book
 * @param {{
 *   bot: { bookAppointment: (headers: unknown, date: string) => Promise<{ success: boolean; time?: string } | null> } | null;
 *   sessionHeaders: Record<string, unknown> | null;
 *   config: { telegramManagerChatId?: string };
 *   updateUserCurrentDate: (email: string, date: string, timeSlot: string | null, rowIndex?: number | null) => Promise<void>;
 *   updateUserLastBooked: (email: string, date: string, timeSlot: string | null, rowIndex?: number | null) => Promise<void>;
 *   logBookingAttempt: (attempt: { user_email: string; date_attempted: string | null; result: string; reason?: string }) => Promise<void>;
 *   sendNotification: (msg: string, chatId: string) => Promise<unknown>;
 *   formatBookingSuccessWithDetails: (user: unknown, oldDate: string, newDate: string, timeSlot: string | null) => string;
 *   formatBookingFailure: (user: unknown, date: string, reason: string) => string;
 *   log: (msg: string) => void;
 * }} deps
 * @returns {Promise<boolean>} - true if booked successfully
 */
export async function attemptBooking(user, date, deps) {
  const {
    bot,
    sessionHeaders,
    config,
    updateUserCurrentDate,
    updateUserLastBooked,
    logBookingAttempt,
    sendNotification,
    formatBookingSuccessWithDetails,
    formatBookingFailure,
    log,
  } = deps;

  if (!bot || !sessionHeaders) {
    const parts = [];
    if (!bot) parts.push('bot not initialized');
    if (!sessionHeaders) parts.push('session not initialized (not logged in)');
    const reason = `Cannot book: ${parts.join(', ')} for ${user.email} (login may have failed at startup)`;
    await logBookingAttempt({
      user_email: user.email,
      date_attempted: date,
      result: 'failure',
      reason,
    });
    log(`User ${user.email}: ${reason}`);
    return false;
  }

  try {
    const oldDate = user.currentDate;
    const result = await bot.bookAppointment(sessionHeaders, date);

    if (result && result.success) {
      const newDate = date;
      const timeSlot = result.time ?? null;

      log(
        `Booking successful for ${user.email}: ${oldDate} -> ${newDate}${timeSlot ? ` ${timeSlot}` : ''}`
      );

      user.currentDate = newDate;
      user.lastBooked = newDate;

      await Promise.all([
        updateUserCurrentDate(user.email, newDate, timeSlot, user.rowIndex),
        updateUserLastBooked(user.email, newDate, timeSlot, user.rowIndex),
        logBookingAttempt({
          user_email: user.email,
          date_attempted: newDate,
          time_attempted: timeSlot,
          result: 'success',
          reason: 'Appointment booked successfully',
          old_date: oldDate,
          new_date: newDate,
          new_time: timeSlot,
        }),
      ]);

      const message = formatBookingSuccessWithDetails(user, oldDate, newDate, timeSlot);
      await sendNotification(message, config.telegramManagerChatId);
      return true;
    }

    await logBookingAttempt({
      user_email: user.email,
      date_attempted: date,
      result: 'failure',
      reason: 'Booking failed - no time slot available',
    });
    const failureMsg = formatBookingFailure(user, date, 'Booking failed - no time slot available');
    await sendNotification(failureMsg, config.telegramManagerChatId);
    return false;
  } catch (error) {
    const errMsg = error?.message ?? String(error);
    log(`Booking failed for ${user.email} on ${date}: ${errMsg}`);

    await logBookingAttempt({
      user_email: user.email,
      date_attempted: date,
      result: 'failure',
      reason: errMsg,
    });

    const message = formatBookingFailure(user, date, errMsg);
    await sendNotification(message, config.telegramManagerChatId);
    return false;
  }
}
