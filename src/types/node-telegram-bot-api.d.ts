declare module 'node-telegram-bot-api' {
  interface TelegramBotOptions {
    polling?: boolean;
  }
  export default class TelegramBot {
    constructor(token: string, options?: TelegramBotOptions);
    sendMessage(chatId: string, text: string, options?: { parse_mode?: string }): Promise<unknown>;
  }
}
