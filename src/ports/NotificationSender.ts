/**
 * Port: send notifications (e.g. Telegram).
 * Single method: send message to a chat.
 */
export interface NotificationSender {
  send(message: string, chatId: string): Promise<boolean>;
}
