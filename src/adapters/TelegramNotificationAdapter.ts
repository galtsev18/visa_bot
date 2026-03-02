import type { NotificationSender } from '../ports/NotificationSender';
import type { TelegramSender } from '../lib/telegram';
import { createTelegramSender } from '../lib/telegram';

/**
 * Adapter: Telegram Bot API as NotificationSender.
 * Creates sender in constructor (no global state).
 */
export class TelegramNotificationAdapter implements NotificationSender {
  private sender: TelegramSender | null;

  constructor(options: { token: string; defaultChatId: string }) {
    this.sender = createTelegramSender(options.token, options.defaultChatId);
  }

  async send(message: string, chatId: string): Promise<boolean> {
    if (!this.sender) return false;
    return this.sender.send(message, chatId);
  }
}
