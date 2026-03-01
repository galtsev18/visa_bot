/**
 * Port: send notifications (e.g. Telegram).
 * Single method: send message to a chat.
 * @implemented_by TelegramNotificationAdapter (adapters)
 */
export interface NotificationSender {
  send(message: string, chatId: string): Promise<boolean>;
}
