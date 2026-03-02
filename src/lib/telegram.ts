import { log, formatErrorForLog } from './utils';

const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramSender {
  send(message: string, chatId: string): Promise<boolean>;
}

/**
 * Create a Telegram sender (no global state). Uses Bot API via fetch, like get-chat-id.
 */
export function createTelegramSender(
  token: string,
  defaultChatId: string
): TelegramSender | null {
  const cleanToken = token?.trim().replace(/^["']|["']$/g, '');
  const chatId = String(defaultChatId).trim();
  if (!cleanToken || !chatId) {
    log('Telegram not initialized: missing token or chat ID');
    return null;
  }
  log(`Telegram sender created for chat ID: ${chatId}`);
  return {
    async send(message: string, targetChatId?: string): Promise<boolean> {
      const id = (targetChatId && String(targetChatId).trim()) || chatId;
      if (!id) {
        log('Telegram: no chat ID, message not sent');
        return false;
      }
      try {
        const url = `${TELEGRAM_API}/bot${cleanToken}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: id,
            text: message,
            parse_mode: 'HTML',
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!data.ok) {
          log(`Telegram send failed: ${data.description ?? res.status}`);
          return false;
        }
        log('Telegram notification sent');
        return true;
      } catch (error) {
        log(`Failed to send Telegram notification: ${formatErrorForLog(error)}`);
        return false;
      }
    },
  };
}

export interface UserLike {
  email: string;
  currentDate?: string | null;
  reactionTime?: number;
}

export interface MonitorConfigLike {
  telegramManagerChatId?: string;
}

export interface CacheStatsLike {
  total: number;
  providers: Record<string, { entries: number; available: number }>;
}

/**
 * Format a booking success notification
 */
export function formatBookingSuccess(
  user: UserLike,
  oldDate: string | null,
  newDate: string
): string {
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
 */
export function formatError(user: UserLike, error: Error | string): string {
  const errorMessage = formatErrorForLog(error);
  return `
<b>❌ Error for User</b>

<b>User:</b> ${user.email}
<b>Error:</b> ${errorMessage}
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format a general notification
 */
export function formatNotification(title: string, message: string): string {
  return `
<b>${title}</b>

${message}
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format notification when a matching time slot is found (before booking attempt)
 */
export function formatSlotFound(user: UserLike, date: string): string {
  return `
<b>🔔 Matching Slot Found</b>

<b>User:</b> ${user.email}
<b>Current appointment:</b> ${user.currentDate || 'None'}
<b>Found date:</b> ${date}
<b>Criteria:</b> In range, after reaction time (${user.reactionTime ?? 0} days)
<b>Action:</b> Attempting to book...
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format notification for failed booking attempt (with details)
 */
export function formatBookingFailure(
  user: UserLike,
  date: string,
  reason: string
): string {
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
 */
export function formatBookingSuccessWithDetails(
  user: UserLike,
  oldDate: string | null,
  newDate: string,
  timeSlot: string | null = null
): string {
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

/**
 * Format "Monitor started" notification
 */
export function formatMonitorStarted(
  users: unknown[],
  _config: MonitorConfigLike,
  stats: CacheStatsLike
): string {
  return `
<b>🚀 Monitor Started</b>

<b>Users:</b> ${users.length}
<b>Cache:</b> ${stats.total} entries (${Object.entries(stats.providers)
    .map(([p, s]) => `${p}: ${s.available} available`)
    .join(', ')})
<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}
