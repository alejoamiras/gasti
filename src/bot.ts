import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { writeExpenseRow } from './library/sheets.js';
import { extractReceiptDataFromImage } from './library/llm.js';
import logger from './library/logger.js';
import { convertPdfToImages } from './library/pdf.js';
import { randomBytes } from 'crypto';

// Generate unique instance ID for tracking
const INSTANCE_ID = `${Date.now()}-${randomBytes(4).toString('hex')}`;

// Create instance-aware logger
const instanceLogger = {
  info: (msg: any, ...args: any[]) => logger.info(`[${INSTANCE_ID}] ${msg}`, ...args),
  error: (msg: any, ...args: any[]) => logger.error(`[${INSTANCE_ID}] ${msg}`, ...args),
  warn: (msg: any, ...args: any[]) => logger.warn(`[${INSTANCE_ID}] ${msg}`, ...args),
  debug: (msg: any, ...args: any[]) => logger.debug(`[${INSTANCE_ID}] ${msg}`, ...args),
};

const USERNAME_TO_PAYER: Record<string, string> = {
  alejoamiras: 'alejo',
  morafreaza: 'mora',
};

const token = process.env.TELEGRAM_BOT_TOKEN || '';

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables.');
}

instanceLogger.info(`🚀 Bot instance starting with ID: ${INSTANCE_ID}`);

// Add error handling to detect polling conflicts
const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
  instanceLogger.error('🚨 POLLING ERROR:', error.message);
  if (error.message.includes('409') || error.message.includes('Conflict')) {
    instanceLogger.error('🔥 DETECTED POLLING CONFLICT - Multiple instances running!');
  }
});

bot.on('webhook_error', (error) => {
  instanceLogger.error('🚨 WEBHOOK ERROR:', error);
});

instanceLogger.info('✅ Telegram bot polling started successfully');

// Heartbeat to track instance lifecycle (every 30 seconds)
const heartbeatInterval = setInterval(() => {
  if (!isShuttingDown) {
    instanceLogger.info(`💗 Instance heartbeat - uptime: ${Math.floor(process.uptime())}s`);
  }
}, 30000);

// Log when the process is about to exit
process.on('exit', (code) => {
  clearInterval(heartbeatInterval);
  instanceLogger.info(`🏁 Process exiting with code: ${code}`);
});

// Graceful shutdown handling
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    instanceLogger.warn('⚠️ Shutdown already in progress, ignoring signal:', signal);
    return;
  }

  isShuttingDown = true;
  instanceLogger.info(`🛑 Received ${signal}. Starting graceful shutdown...`);

  try {
    // Clear heartbeat interval
    clearInterval(heartbeatInterval);

    // Stop polling to prevent new messages - be more aggressive
    instanceLogger.info('🔄 Stopping Telegram polling...');
    await bot.stopPolling({ cancel: true, reason: 'Graceful shutdown' });
    instanceLogger.info('✅ Telegram polling stopped successfully');

    // Give more time for any ongoing operations to complete and polling to fully stop
    instanceLogger.info('⏳ Waiting 8 seconds for operations to complete...');
    await new Promise((resolve) => setTimeout(resolve, 8000));

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

// Register signal handlers AFTER gracefulShutdown is defined
process.on('SIGTERM', () => {
  instanceLogger.info('📨 Received SIGTERM signal');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  instanceLogger.info('📨 Received SIGINT signal');
  gracefulShutdown('SIGINT');
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

bot.on('photo', async (msg: TelegramBot.Message) => {
  // Prevent processing during shutdown
  if (isShuttingDown) {
    instanceLogger.warn('⚠️ Ignoring message during shutdown');
    return;
  }

  const chatId = msg.chat.id;
  const username = msg.from?.username || msg.from?.first_name || 'Unknown';
  const payer = USERNAME_TO_PAYER[username] || username;
  const messageText = msg.caption || ''; // Extract the caption text

  instanceLogger.info({ username, chatId, messageText }, '📸 Received a receipt photo');
  bot.sendMessage(chatId, `💭 Recibímos la foto del recibo, y empezamos a procesarlo...`);

  try {
    // Get the highest resolution photo
    const photo = msg.photo?.[msg.photo.length - 1];
    if (!photo) throw new Error('💁🏽 No se encontró ninguna foto en los mensajes');
    const file = await bot.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = 'image/jpeg'; // Telegram always sends JPEGs
    const base64Image = buffer.toString('base64');

    // Extract receipt data using LLM
    const llmResult = await extractReceiptDataFromImage(base64Image, mimeType, messageText);
    instanceLogger.debug({ llmResult }, '🧠 LLM extracted receipt data');

    // Compose row for Google Sheets
    const row = [
      llmResult.title || '',
      'ARS', // Moneda (always ARS)
      llmResult.amount || '',
      llmResult.amount || '', // ARS (repeat for test)
      payer,
      llmResult.category || '🤔',
      llmResult.description || '',
    ] as string[];
    await writeExpenseRow(row);
    instanceLogger.info({ username, row }, '📊 Expense added to Google Sheets');
    bot.sendMessage(chatId, llmResult.summary);
  } catch (err) {
    instanceLogger.error({ err }, '❌ Failed to process receipt');
    bot.sendMessage(chatId, `❌ Failed to process receipt: ${err}`);
  }
});

bot.on('document', async (msg: TelegramBot.Message) => {
  // Prevent processing during shutdown
  if (isShuttingDown) {
    instanceLogger.warn('⚠️ Ignoring message during shutdown');
    return;
  }

  const chatId = msg.chat.id;
  const username = msg.from?.username || msg.from?.first_name || 'Unknown';
  const payer = USERNAME_TO_PAYER[username] || username;
  const messageText = msg.caption || ''; // Extract the caption text

  // Check if it's a PDF
  if (!msg.document?.mime_type?.includes('pdf')) {
    bot.sendMessage(chatId, '❌ Please send a PDF file.');
    return;
  }

  instanceLogger.info({ username, chatId, messageText }, '📄 Received a PDF receipt');
  bot.sendMessage(chatId, `💭 Recibímos el PDF del recibo, y empezamos a procesarlo...`);

  try {
    // Get the PDF file
    const file = await bot.getFile(msg.document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    instanceLogger.debug('📦 Buffer received');
    // Convert PDF to images
    const image = await convertPdfToImages(buffer);
    instanceLogger.debug('🖼️ Converted PDF to image');

    // Process only the first page (one-page PDF assumption)
    const { base64Image, mimeType } = image;
    // Extract receipt data using LLM
    const llmResult = await extractReceiptDataFromImage(base64Image, mimeType, messageText);
    instanceLogger.debug({ llmResult }, '🧠 LLM extracted receipt data from PDF');

    // Compose row for Google Sheets
    const row = [
      llmResult.title || '',
      'ARS', // Moneda (always ARS)
      llmResult.amount || '',
      llmResult.amount || '', // ARS (repeat for test)
      payer,
      llmResult.category || '🤔',
      llmResult.description || '',
    ] as string[];
    await writeExpenseRow(row);
    instanceLogger.info({ username, row }, '📊 Expense added to Google Sheets');
    bot.sendMessage(chatId, llmResult.summary);
  } catch (err) {
    instanceLogger.error({ err }, '❌ Failed to process PDF receipt');
    bot.sendMessage(chatId, `❌ Failed to process PDF receipt: ${err}`);
  }
});
