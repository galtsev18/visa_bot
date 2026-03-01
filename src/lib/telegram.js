import fetch from 'node-fetch';
import { log, formatErrorForLog } from './utils.js';

const TELEGRAM_API = 'https://api.telegram.org';
let telegramToken = null;

/**
 * Initialize Telegram (store token for sendNotification).
 */
export function initializeTelegram(token, managerChatId) {
  if (!token || !managerChatId) {
    log('Telegram not initialized: missing token or chat ID');
    return null;
  }
  telegramToken = token.trim().replace(/^["']|["']$/g, '');
  log(`Telegram bot initialized for chat ID: ${managerChatId}`);
  return true;
}

/**
 * Send a notification via Telegram Bot API (fetch only).
 */
export async function sendNotification(message, managerChatId) {
  if (!telegramToken || !managerChatId) {
    log('Telegram not available, message not sent: ' + message);
    return false;
  }
  try {
    const url = `${TELEGRAM_API}/bot${telegramToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(managerChatId).trim(),
        text: message,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      log(`Failed to send Telegram notification: ${data.description || res.status}`);
      return false;
    }
    log('Telegram notification sent');
    return true;
  } catch (error) {
    log(`Failed to send Telegram notification: ${formatErrorForLog(error)}`);
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
 * Format "monitor started" notification with pool and cache info
 */
export function formatMonitorStarted(users, config, cacheStats) {
  const providerCounts = {};
  for (const u of users) {
    const p = (u.provider || 'ais').toLowerCase();
    providerCounts[p] = (providerCounts[p] || 0) + 1;
  }
  const providerLines = Object.entries(providerCounts)
    .map(([p, n]) => `${p}: ${n} account(s)`)
    .join(', ');
  const cacheLines = Object.entries(cacheStats.providers || {}).length
    ? Object.entries(cacheStats.providers)
        .map(([p, s]) => `${p}: ${s.available}/${s.entries} available`)
        .join('\n')
    : 'No cache entries yet';
  return `
<b>🚀 Monitor started</b>

<b>Accounts in pool:</b> ${users.length}
<b>By provider:</b> ${providerLines}

<b>Cache:</b> ${cacheStats.total} record(s)
${cacheLines}

<b>Settings:</b>
Refresh: ${config.refreshInterval}s · Cache TTL: ${config.cacheTtl}s
Sheets refresh: ${config.sheetsRefreshInterval}s · Rotation cooldown: ${config.rotationCooldown}s

<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format notification for successful booking (with optional time slot detail)
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
