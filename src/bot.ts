import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { writeExpenseRow } from './googleSheets';
import { extractReceiptDataFromImage } from './llmReceiptExtractor';
import logger from './logger';
// import fetch from 'node-fetch'; // Use native fetch

const USERNAME_TO_PAYER: Record<string, string> = {
  alejoamiras: 'alejo',
  // Add your girlfriend's username here when available
};

// TODO: Replace with your actual Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN || '';

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables.');
}

const bot = new TelegramBot(token, { polling: true });

logger.info('Telegram bot started.');

bot.on('photo', async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username || msg.from?.first_name || 'Unknown';
  const payer = USERNAME_TO_PAYER[username] || username;

  logger.info({ username, chatId }, 'Received a receipt photo');
  bot.sendMessage(
    chatId,
    `Received a receipt from ${username}. Processing with AI...`,
  );

  try {
    // Get the highest resolution photo
    const photo = msg.photo?.[msg.photo.length - 1];
    if (!photo) throw new Error('No photo found in message.');
    const file = await bot.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = 'image/jpeg'; // Telegram always sends JPEGs
    const base64Image = buffer.toString('base64');

    // Extract receipt data using LLM
    const llmResult = await extractReceiptDataFromImage(base64Image, mimeType);
    logger.debug({ llmResult }, 'LLM extracted receipt data');

    // Compose row for Google Sheets
    const row = [
      llmResult.description || '',
      'ARS', // Moneda (always ARS)
      llmResult.amount || '',
      llmResult.amount || '', // ARS (repeat for test)
      payer,
      llmResult.category || '🤔',
      llmResult.comments || '',
    ];
    await writeExpenseRow(row);
    logger.info({ username, row }, 'Expense added to Google Sheets');
    bot.sendMessage(chatId, '✅ Expense added to Google Sheets!');
  } catch (err) {
    logger.error({ err }, 'Failed to process receipt');
    bot.sendMessage(chatId, `❌ Failed to process receipt: ${err}`);
  }
});
