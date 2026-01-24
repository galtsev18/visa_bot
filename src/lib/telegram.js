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
