import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import logger from './library/logger.js';
import { randomBytes } from 'crypto';
import type { Logger } from 'pino';
import {
  extractUserInfo,
  extractUserInfoFromText,
  processPhotoInput,
  processPdfInput,
  processTextInput,
  handleReceiptProcessing,
  handleTextExpenseProcessing,
} from './library/bot-helpers.js';

// Generate unique instance ID for tracking
const INSTANCE_ID = `${Date.now()}-${randomBytes(4).toString('hex')}`;

// Create instance-aware logger using Pino's child logger (inherits ALL Logger methods)
const instanceLogger: Logger = logger.child({ instanceId: INSTANCE_ID });

const token = process.env.TELEGRAM_BOT_TOKEN || '';

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables.');
}

instanceLogger.info(`🚀 Bot instance starting with ID: ${INSTANCE_ID}`);
instanceLogger.info(`🐳 Process PID: ${process.pid}, Platform: ${process.platform}`);
instanceLogger.info(`📋 Process title: ${process.title}, Node version: ${process.version}`);

// Check if we're PID 1 (crucial for signal handling in containers)
if (process.pid === 1) {
  instanceLogger.info(`✅ Running as PID 1 - signals should work correctly`);
} else {
  instanceLogger.warn(`⚠️ Running as PID ${process.pid} - signal forwarding may not work`);
}

// Declare bot variable to be accessible globally
let bot: TelegramBot;
let isShuttingDown = false;
let heartbeatInterval: NodeJS.Timeout;

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    instanceLogger.warn('⚠️ Shutdown already in progress, ignoring signal:', signal);
    return;
  }

  isShuttingDown = true;
  instanceLogger.info(`🛑 Received ${signal}. Starting graceful shutdown...`);

  try {
    // Clear heartbeat interval
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    // Stop polling to prevent new messages - be more aggressive
    instanceLogger.info('🔄 Stopping Telegram polling...');
    await bot.stopPolling({ cancel: true, reason: 'Graceful shutdown' });
    instanceLogger.info('✅ Telegram polling stopped successfully');

    // Give more time for any ongoing operations to complete and polling to fully stop
    instanceLogger.info('⏳ Waiting 5 seconds for operations to complete...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    instanceLogger.info('✅ Graceful shutdown completed - exiting cleanly');
    process.exit(0);
  } catch (error) {
    instanceLogger.error('❌ Error during graceful shutdown:', error);
    // Force exit even if there's an error to avoid hanging
    setTimeout(() => {
      instanceLogger.error('💥 Force exiting due to shutdown timeout');
      process.exit(1);
    }, 2000);
  }
};

// Setup bot event handlers
const setupBotHandlers = () => {
  bot.on('polling_error', (error) => {
    instanceLogger.error('🚨 POLLING ERROR:', error.message);
    if (error.message.includes('409') || error.message.includes('Conflict')) {
      instanceLogger.error('🔥 DETECTED POLLING CONFLICT - Multiple instances running!');
    }
  });

  bot.on('webhook_error', (error) => {
    instanceLogger.error('🚨 WEBHOOK ERROR:', error);
  });

  bot.on('photo', async (msg: TelegramBot.Message) => {
    // Prevent processing during shutdown
    if (isShuttingDown) {
      instanceLogger.warn('⚠️ Ignoring message during shutdown');
      return;
    }

    const userInfo = extractUserInfo(msg);

    instanceLogger.info(
      { username: userInfo.username, chatId: userInfo.chatId, messageText: userInfo.messageText },
      '📸 Received a receipt photo',
    );
    bot.sendMessage(
      userInfo.chatId,
      `💭 Recibímos la foto del recibo, y empezamos a procesarlo...`,
    );

    try {
      // Get the highest resolution photo
      const photo = msg.photo?.[msg.photo.length - 1];
      if (!photo) throw new Error('💁🏽 No se encontró ninguna foto en los mensajes');

      const processedInput = await processPhotoInput(photo, bot, token);
      await handleReceiptProcessing(userInfo, processedInput, bot, instanceLogger);
    } catch (err) {
      instanceLogger.error({ err }, '❌ Failed to process receipt');
      bot.sendMessage(userInfo.chatId, `❌ Failed to process receipt: ${err}`);
    }
  });

  bot.on('document', async (msg: TelegramBot.Message) => {
    // Prevent processing during shutdown
    if (isShuttingDown) {
      instanceLogger.warn('⚠️ Ignoring message during shutdown');
      return;
    }

    const userInfo = extractUserInfo(msg);

    // Check if it's a PDF
    if (!msg.document?.mime_type?.includes('pdf')) {
      bot.sendMessage(userInfo.chatId, '❌ Please send a PDF file.');
      return;
    }

    instanceLogger.info(
      { username: userInfo.username, chatId: userInfo.chatId, messageText: userInfo.messageText },
      '📄 Received a PDF receipt',
    );
    bot.sendMessage(userInfo.chatId, `💭 Recibímos el PDF del recibo, y empezamos a procesarlo...`);

    try {
      const processedInput = await processPdfInput(msg.document, bot, token, instanceLogger);
      await handleReceiptProcessing(userInfo, processedInput, bot, instanceLogger);
    } catch (err) {
      instanceLogger.error({ err }, '❌ Failed to process PDF receipt');
      bot.sendMessage(userInfo.chatId, `❌ Failed to process PDF receipt: ${err}`);
    }
  });

  bot.on('text', async (msg: TelegramBot.Message) => {
    // Prevent processing during shutdown
    if (isShuttingDown) {
      instanceLogger.warn('⚠️ Ignoring message during shutdown');
      return;
    }

    // Ignore commands (starting with /)
    if (msg.text?.startsWith('/')) {
      return;
    }

    const userInfo = extractUserInfoFromText(msg);
    const text = msg.text || '';

    instanceLogger.info(
      { username: userInfo.username, chatId: userInfo.chatId, text },
      '💬 Received a text expense',
    );
    bot.sendMessage(userInfo.chatId, `💭 Procesando tu gasto...`);

    try {
      await handleTextExpenseProcessing(userInfo, text, bot, instanceLogger);
    } catch (err) {
      instanceLogger.error({ err }, '❌ Failed to process text expense');
      bot.sendMessage(userInfo.chatId, `❌ Failed to process expense: ${err}`);
    }
  });
};

// Initialize bot with startup delay
const initializeBot = async () => {
  try {
    // Add startup delay to allow previous instance to shutdown cleanly
    instanceLogger.info('⏳ Waiting 15 seconds for any previous instance to shutdown...');
    await new Promise((resolve) => setTimeout(resolve, 15000));
    instanceLogger.info('🚀 Starting Telegram polling...');

    // Initialize bot
    bot = new TelegramBot(token, { polling: true });

    // Setup all event handlers
    setupBotHandlers();

    instanceLogger.info('✅ Telegram bot polling started successfully');

    // Heartbeat to track instance lifecycle (every 1 minute)
    heartbeatInterval = setInterval(() => {
      if (!isShuttingDown) {
        instanceLogger.info(`💗 Instance heartbeat - uptime: ${Math.floor(process.uptime())}s`);
      }
    }, 60000);
  } catch (error) {
    instanceLogger.error('❌ Failed to initialize bot:', error);
    process.exit(1);
  }
};

// Register signal handlers
process.on('SIGTERM', () => {
  instanceLogger.info('📨 Received SIGTERM signal');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  instanceLogger.info('📨 Received SIGINT signal');
  gracefulShutdown('SIGINT');
});

// Debug: Log other signals that might be sent
process.on('SIGHUP', () => {
  instanceLogger.info('🎯 Received SIGHUP signal');
});

process.on('SIGQUIT', () => {
  instanceLogger.info('🎯 Received SIGQUIT signal');
});

// Debug: Log process events
process.on('beforeExit', (code) => {
  instanceLogger.info(`🚪 Process beforeExit with code: ${code}`);
});

process.on('disconnect', () => {
  instanceLogger.info('🔌 Process disconnect event');
});

// Log when the process is about to exit
process.on('exit', (code) => {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  instanceLogger.info(`🏁 Process exiting with code: ${code}`);
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  instanceLogger.error('💥 Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  instanceLogger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Start the bot (only if not in test environment)
if (process.env.NODE_ENV !== 'test') {
  initializeBot();
}
