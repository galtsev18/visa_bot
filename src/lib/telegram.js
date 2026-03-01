import TelegramBot from 'node-telegram-bot-api';
import { log } from './utils.js';

let bot = null;

/**
 * Initialize Telegram bot
 * @param {string} token - Telegram bot token
 * @param {string} managerChatId - Manager chat ID
 */
export function initializeTelegram(token, managerChatId) {
  if (!token || !managerChatId) {
    log('Telegram not initialized: missing token or chat ID');
    return null;
  }

  try {
    bot = new TelegramBot(token, { polling: false });
    log(`Telegram bot initialized for chat ID: ${managerChatId}`);
    return bot;
  } catch (error) {
    log(`Failed to initialize Telegram bot: ${error.message}`);
    return null;
  }
}

/**
 * Send a notification to the manager
 * @param {string} message - Message to send
 * @param {string} managerChatId - Manager chat ID
 * @returns {Promise<boolean>}
 */
export async function sendNotification(message, managerChatId) {
  if (!bot || !managerChatId) {
    log('Telegram not available, message not sent: ' + message);
    return false;
  }

  try {
    await bot.sendMessage(managerChatId, message, { parse_mode: 'HTML' });
    log('Telegram notification sent');
    return true;
  } catch (error) {
    log(`Failed to send Telegram notification: ${error.message}`);
    return false;
  }
}

/**
 * Format a booking success notification
 * @param {Object} user - User object
 * @param {string} oldDate - Previous appointment date
 * @param {string} newDate - New appointment date
 * @returns {string}
 */
export function formatBookingSuccess(user, oldDate, newDate) {
  return `
<b>✅ Appointment Booked Successfully</b>

<b>User:</b> ${user.email}
<b>Previous Date:</b> ${oldDate || 'None'}
<b>New Date:</b> ${newDate}
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format an error notification
 * @param {Object} user - User object
 * @param {Error|string} error - Error object or message
 * @returns {string}
 */
export function formatError(user, error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return `
<b>❌ Error for User</b>

<b>User:</b> ${user.email}
<b>Error:</b> ${errorMessage}
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format a general notification
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @returns {string}
 */
export function formatNotification(title, message) {
  return `
<b>${title}</b>

${message}
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format notification when a matching time slot is found (before booking attempt)
 * @param {Object} user - User object
 * @param {string} date - Date that matches criteria (YYYY-MM-DD)
 * @returns {string}
 */
export function formatSlotFound(user, date) {
  return `
<b>🔔 Matching Slot Found</b>

<b>User:</b> ${user.email}
<b>Current appointment:</b> ${user.currentDate || 'None'}
<b>Found date:</b> ${date}
<b>Criteria:</b> In range, after reaction time (${user.reactionTime} days)
<b>Action:</b> Attempting to book...
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format notification for failed booking attempt (with details)
 * @param {Object} user - User object
 * @param {string} date - Date that was attempted (YYYY-MM-DD)
 * @param {string} reason - Failure reason
 * @returns {string}
 */
export function formatBookingFailure(user, date, reason) {
  return `
<b>❌ Booking Attempt Failed</b>

<b>User:</b> ${user.email}
<b>Date attempted:</b> ${date}
<b>Reason:</b> ${reason}
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format notification for successful booking (with optional time slot detail)
 * @param {Object} user - User object
 * @param {string} oldDate - Previous appointment date
 * @param {string} newDate - New appointment date
 * @param {string} [timeSlot] - Optional time slot (e.g. "09:00")
 * @returns {string}
 */
export function formatBookingSuccessWithDetails(user, oldDate, newDate, timeSlot = null) {
  let msg = `
<b>✅ Appointment Booked Successfully</b>

<b>User:</b> ${user.email}
<b>Previous Date:</b> ${oldDate || 'None'}
<b>New Date:</b> ${newDate}`;
  if (timeSlot) {
    msg += `\n<b>Time slot:</b> ${timeSlot}`;
  }
  msg += `
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
  return msg;
}
