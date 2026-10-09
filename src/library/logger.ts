import pino from 'pino';

// Set log level from environment variable, default to 'info'
// A Telegram bot token: "<bot id>:<secret>".
const BOT_TOKEN = /\d{5,}:[\w-]{30,}/g;

export function maskBotTokens(text: string): string {
  return text.replace(BOT_TOKEN, '<bot-token>');
}

/**
 * Telegram and Google client errors carry their request (bot token in the URL, OAuth bearer
 * in the headers), so only a few fields are logged, and the Telegram client can quote a raw
 * response body in its message, so bot tokens are masked there too.
 */
export function serializeError(err: Error & { code?: unknown; status?: unknown }) {
  return {
    type: err.name,
    message: err.message && maskBotTokens(err.message),
    code: err.code,
    status: err.status,
    stack: err.stack && maskBotTokens(err.stack),
  };
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: { err: serializeError },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true },
        },
});

export default logger;
