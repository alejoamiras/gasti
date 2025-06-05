import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { writeExpenseRow } from './library/sheets.js';
import { extractReceiptDataFromImage } from './library/llm.js';
import logger from './library/logger.js';
import { convertPdfToImages } from './library/pdf.js';

const USERNAME_TO_PAYER: Record<string, string> = {
  alejoamiras: 'alejo',
  // Add your girlfriend's username here when available
};

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
  const messageText = msg.caption || ''; // Extract the caption text

  logger.info({ username, chatId, messageText }, 'Received a receipt photo');
  bot.sendMessage(chatId, `Received a receipt from ${username}. Processing with AI...`);

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
    const llmResult = await extractReceiptDataFromImage(base64Image, mimeType, messageText);
    logger.debug({ llmResult }, 'LLM extracted receipt data');

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
    logger.info({ username, row }, 'Expense added to Google Sheets');
    bot.sendMessage(chatId, '✅ Expense added to Google Sheets!');
  } catch (err) {
    logger.error({ err }, 'Failed to process receipt');
    bot.sendMessage(chatId, `❌ Failed to process receipt: ${err}`);
  }
});

bot.on('document', async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username || msg.from?.first_name || 'Unknown';
  const payer = USERNAME_TO_PAYER[username] || username;
  const messageText = msg.caption || ''; // Extract the caption text

  // Check if it's a PDF
  if (!msg.document?.mime_type?.includes('pdf')) {
    bot.sendMessage(chatId, '❌ Please send a PDF file.');
    return;
  }

  logger.info({ username, chatId, messageText }, 'Received a PDF receipt');
  bot.sendMessage(chatId, `Received a PDF receipt from ${username}. Processing with AI...`);

  try {
    // Get the PDF file
    const file = await bot.getFile(msg.document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    logger.debug('Buffer received');
    // Convert PDF to images
    const image = await convertPdfToImages(buffer);
    logger.debug('Converted PDF to image');

    // Process only the first page (one-page PDF assumption)
    const { base64Image, mimeType } = image;
    // Extract receipt data using LLM
    const llmResult = await extractReceiptDataFromImage(base64Image, mimeType, messageText);
    logger.debug({ llmResult }, 'LLM extracted receipt data from PDF');

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
    logger.info({ username, row }, 'Expense added to Google Sheets');
    bot.sendMessage(chatId, `✅ Processed PDF and added to Google Sheets!`);
  } catch (err) {
    logger.error({ err }, 'Failed to process PDF receipt');
    bot.sendMessage(chatId, `❌ Failed to process PDF receipt: ${err}`);
  }
});
