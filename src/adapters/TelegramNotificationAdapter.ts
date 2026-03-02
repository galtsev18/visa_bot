import type { NotificationSender } from '../ports/NotificationSender';
import {
  initializeTelegram,
  sendNotification,
} from '../lib/telegram';

/**
 * Adapter: Telegram Bot API as NotificationSender.
 * Call init() once (or ensure token/chatId set) before send().
 */
export class TelegramNotificationAdapter implements NotificationSender {
  private token: string;
  private defaultChatId: string;

  constructor(options: { token: string; defaultChatId: string }) {
    this.token = options.token.trim().replace(/^["']|["']$/g, '');
    this.defaultChatId = String(options.defaultChatId).trim();
  }

  /** Initialize the underlying Telegram module (global state). Call once at startup. */
  init(): void {
    initializeTelegram(this.token, this.defaultChatId);
  }

  async send(message: string, chatId: string): Promise<boolean> {
    const targetChatId = String(chatId).trim();
    return sendNotification(message, targetChatId);
  }
}
