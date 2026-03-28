import type { NotificationSender } from '../ports/NotificationSender';
import { logger } from '../lib/logger';

/**
 * Wraps a NotificationSender and thins out consecutive identical messages:
 * - Pending message is sent when: 1) cooldown passed and a new (possibly same) message arrives, or 2) a different message arrives (flush previous), or 3) cooldown timer fires (flush pending so last batch is never lost).
 * - setTimeout is used so that when the cooldown expires with no new message, the pending is sent anyway.
 */
export interface ThrottledNotificationSenderOptions {
  inner: NotificationSender;
  /** Cooldown between sends in ms (e.g. 5000). */
  cooldownMs: number;
  /** Max count to show (e.g. 99 → "×99+"). */
  maxCountDisplay?: number;
}

export class ThrottledNotificationSender implements NotificationSender {
  private readonly inner: NotificationSender;
  private readonly cooldownMs: number;
  private readonly maxCount: number;

  private lastSendTime = 0;
  private pendingText: string | null = null;
  private pendingChatId: string = '';
  private pendingCount = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ThrottledNotificationSenderOptions) {
    this.inner = options.inner;
    this.cooldownMs = options.cooldownMs;
    this.maxCount = options.maxCountDisplay ?? 99;
  }

  async send(message: string, chatId: string): Promise<boolean> {
    const now = Date.now();
    const pastCooldown = now - this.lastSendTime >= this.cooldownMs;

    if (pastCooldown) {
      this.clearFlushTimer();
      if (this.pendingText !== null) {
        const sameAsPending = this.pendingText === message && this.pendingChatId === chatId;
        if (sameAsPending) {
          this.pendingCount++;
          const text = this.formatWithCount(this.pendingText, this.pendingCount);
          const ok = await this.inner.send(text, chatId);
          if (!ok) {
            logger.warn(
              'ThrottledNotificationSender: underlying send returned false (Telegram may have rejected the message)'
            );
          }
          this.lastSendTime = Date.now();
          this.pendingCount = 1;
          this.scheduleFlush();
          return true;
        }
        await this.doFlush();
      }
      const ok = await this.inner.send(message, chatId);
      if (!ok) {
        logger.warn(
          'ThrottledNotificationSender: underlying send returned false (Telegram may have rejected the message)'
        );
      }
      this.lastSendTime = Date.now();
      // Do not set pending + scheduleFlush here: that caused a duplicate send of the same text after cooldownMs.
      return true;
    }

    if (message === this.pendingText) {
      this.pendingCount++;
      return true;
    }

    this.clearFlushTimer();
    await this.doFlush();
    this.pendingText = message;
    this.pendingChatId = chatId;
    this.pendingCount = 1;
    this.scheduleFlush();
    return true;
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private scheduleFlush(): void {
    this.clearFlushTimer();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.doFlush();
    }, this.cooldownMs);
  }

  private async doFlush(): Promise<void> {
    if (this.pendingText === null) return;
    const text = this.formatWithCount(this.pendingText, this.pendingCount);
    const chatId = this.pendingChatId;
    this.pendingText = null;
    this.pendingChatId = '';
    this.pendingCount = 0;
    const ok = await this.inner.send(text, chatId);
    if (!ok) {
      logger.warn(
        'ThrottledNotificationSender: flush send returned false (Telegram may have rejected the message)'
      );
    }
    this.lastSendTime = Date.now();
  }

  private formatWithCount(text: string, count: number): string {
    if (count <= 1) return text;
    const suffix = count > this.maxCount ? `×${this.maxCount}+` : `×${count}`;
    return `${text} <i>(${suffix} подряд)</i>`;
  }
}
