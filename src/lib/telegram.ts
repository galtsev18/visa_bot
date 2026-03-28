import { logger } from './logger';
import { formatErrorForLog } from './utils';

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
    logger.warn('Telegram not initialized: missing token or chat ID');
    return null;
  }
  logger.info(`Telegram sender created for chat ID: ${chatId}`);
  return {
    async send(message: string, targetChatId?: string): Promise<boolean> {
      const id = (targetChatId && String(targetChatId).trim()) || chatId;
      if (!id) {
        logger.warn('Telegram: no chat ID, message not sent');
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
          logger.error(`Telegram send failed: ${data.description ?? res.status}`);
          return false;
        }
        logger.info('Telegram notification sent');
        return true;
      } catch (error) {
        logger.error(`Failed to send Telegram notification: ${formatErrorForLog(error)}`);
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
 * Sent as soon as the monitor process has users from Sheets, **before** long-running `initializeUsers`
 * (VFS browser login etc.). Explains why "Monitor Started" may arrive minutes later.
 */
export function formatMonitorProcessStarted(userCount: number): string {
  return `
<b>🚀 Monitor process started</b>

<b>Active users:</b> ${userCount}
Initializing sessions (logins can take several minutes). A second message <b>Monitor Started</b> with cache stats arrives when the first loop iteration begins.

<b>Time:</b> ${new Date().toLocaleString()}
  `.trim();
}

/**
 * Format "Monitor started" notification (first monitoring loop iteration — after bot sessions are ready).
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

function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface DailyStatsForReport {
  activeUsersCount: number;
  dailySlotsMissed: number;
  dailyBookings: number;
  dailyErrorCounts: Record<string, number>;
  /** Суммарно с момента записи метрик в файл (между перезапусками накапливается). */
  checksTotal?: number;
  bookingsTotal?: number;
  /** Текущий баланс 2Captcha (USD), если ключ задан и API ответил. */
  captchaBalanceUsd?: string;
  /** Текст ошибки запроса баланса 2Captcha. */
  captchaBalanceError?: string;
}

/**
 * Формат ежедневного отчёта (10:00): активные пользователи, слоты не записались / записались, ошибки, баланс 2Captcha.
 */
export function formatDailyStatsReport(stats: DailyStatsForReport): string {
  const errors =
    Object.keys(stats.dailyErrorCounts).length === 0
      ? 'Нет'
      : Object.entries(stats.dailyErrorCounts)
          .map(([msg, count]) => `• ${count}× ${escapeTelegramHtml(msg.slice(0, 80))}${msg.length > 80 ? '…' : ''}`)
          .join('\n');

  const captchaLine =
    stats.captchaBalanceUsd !== undefined
      ? `<b>2Captcha баланс (USD):</b> ${escapeTelegramHtml(stats.captchaBalanceUsd)}`
      : stats.captchaBalanceError !== undefined
        ? `<b>2Captcha баланс:</b> не удалось — ${escapeTelegramHtml(stats.captchaBalanceError)}`
        : `<b>2Captcha баланс:</b> ключ не задан (CAPTCHA_2CAPTCHA_API_KEY в Settings / .env)`;

  const totals =
    stats.checksTotal !== undefined || stats.bookingsTotal !== undefined
      ? `
<b>Всего проверок (метрики):</b> ${stats.checksTotal ?? '—'}
<b>Всего успешных записей (метрики):</b> ${stats.bookingsTotal ?? '—'}`
      : '';

  return `
<b>📊 Ежедневный отчёт</b>

${captchaLine}
${totals}

<b>Активных пользователей:</b> ${stats.activeUsersCount}
<b>Подходящих слотов, на которые не успели записаться (за сутки):</b> ${stats.dailySlotsMissed}
<b>Успешно записались (за сутки):</b> ${stats.dailyBookings}

<b>Ошибки (агрегировано за сутки):</b>
${errors}

<b>Время отчёта:</b> ${new Date().toLocaleString()}
  `.trim();
}
