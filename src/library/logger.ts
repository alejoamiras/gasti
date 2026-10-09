import pino from 'pino';

// Set log level from environment variable, default to 'info'
/**
 * Telegram and Google client errors carry their request (bot token in the URL, OAuth bearer
 * in the headers), so only fields that cannot hold either are logged.
 */
export function serializeError(err: Error & { code?: unknown; status?: unknown }) {
  return {
    type: err.name,
    message: err.message,
    code: err.code,
    status: err.status,
    stack: err.stack,
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
