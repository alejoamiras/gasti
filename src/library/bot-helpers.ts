import TelegramBot from 'node-telegram-bot-api';
import type { Logger } from 'pino';
import { writeExpenseRow } from './sheets.js';
import { extractReceiptDataFromImage, extractReceiptDataFromText } from './llm.js';
import { convertPdfToImages } from './pdf.js';

// Map of Telegram usernames to payer names
const USERNAME_TO_PAYER: Record<string, string> = {
  alejoamiras: 'alejo',
  morafreaza: 'mora',
};

// Interface for user information extracted from messages
export interface UserInfo {
  chatId: number;
  username: string;
  payer: string;
  messageText: string;
}

// Interface for processed input data
export interface ProcessedInput {
  base64Image: string;
  mimeType: string;
}

/**
 * Extracts user information from a Telegram message
 */
export function extractUserInfo(msg: TelegramBot.Message): UserInfo {
  const chatId = msg.chat.id;
  const username = msg.from?.username || msg.from?.first_name || 'Unknown';
  const payer = USERNAME_TO_PAYER[username] || username;
  const messageText = msg.caption || '';

  return {
    chatId,
    username,
    payer,
    messageText,
  };
}

/**
 * Processes expense data and saves it to Google Sheets
 */
export async function processExpense(
  llmResult: {
    title: string;
    amount: number;
    category: string;
    description: string;
    summary: string;
  },
  userInfo: UserInfo,
  bot: TelegramBot,
  instanceLogger: Logger,
): Promise<void> {
  try {
    // Compose row for Google Sheets
    const row = [
      llmResult.title || '',
      'ARS', // Moneda (always ARS)
      llmResult.amount?.toString() || '',
      llmResult.amount?.toString() || '', // ARS (repeat for current sheet structure)
      userInfo.payer,
      llmResult.category || '🤔',
      llmResult.description || '',
    ] as string[];

    await writeExpenseRow(row, instanceLogger);
    instanceLogger.info({ username: userInfo.username, row }, '📊 Expense added to Google Sheets');

    // Send success message to user
    await bot.sendMessage(userInfo.chatId, llmResult.summary);
  } catch (err) {
    instanceLogger.error({ err }, '❌ Failed to save expense to Google Sheets');
    throw err;
  }
}

/**
 * Processes photo input from Telegram and returns standardized data
 */
export async function processPhotoInput(
  photo: TelegramBot.PhotoSize,
  bot: TelegramBot,
  token: string,
): Promise<ProcessedInput> {
  const file = await bot.getFile(photo.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(fileUrl);
  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    base64Image: buffer.toString('base64'),
    mimeType: 'image/jpeg', // Telegram always sends JPEGs
  };
}

/**
 * Processes PDF document input from Telegram and returns standardized data
 */
export async function processPdfInput(
  document: TelegramBot.Document,
  bot: TelegramBot,
  token: string,
  instanceLogger: Logger,
): Promise<ProcessedInput> {
  const file = await bot.getFile(document.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  instanceLogger.debug('📦 Buffer received');

  // Convert PDF to image
  const image = await convertPdfToImages(buffer, instanceLogger);
  instanceLogger.debug('🖼️ Converted PDF to image');

  return {
    base64Image: image.base64Image,
    mimeType: image.mimeType,
  };
}

/**
 * Common handler for processing any type of receipt input
 */
export async function handleReceiptProcessing(
  userInfo: UserInfo,
  processedInput: ProcessedInput,
  bot: TelegramBot,
  instanceLogger: Logger,
): Promise<void> {
  try {
    // Extract receipt data using LLM
    const llmResult = await extractReceiptDataFromImage(
      processedInput.base64Image,
      processedInput.mimeType,
      userInfo.messageText,
      instanceLogger,
    );

    instanceLogger.debug({ llmResult }, '🧠 LLM extracted receipt data');

    // Process and save expense
    await processExpense(llmResult, userInfo, bot, instanceLogger);
  } catch (err) {
    instanceLogger.error({ err }, '❌ Failed to process receipt');
    await bot.sendMessage(userInfo.chatId, `❌ Failed to process receipt: ${err}`);
  }
}

/**
 * Processes text-only expense messages
 */
export function processTextInput(text: string): string {
  // Simply return the text, no processing needed for text input
  return text;
}

/**
 * Common handler for processing text-only expenses
 */
export async function handleTextExpenseProcessing(
  userInfo: UserInfo,
  text: string,
  bot: TelegramBot,
  instanceLogger: Logger,
): Promise<void> {
  try {
    // Extract expense data from text using LLM
    const llmResult = await extractReceiptDataFromText(text, instanceLogger);

    instanceLogger.debug({ llmResult }, '🧠 LLM extracted expense data from text');

    // Process and save expense
    await processExpense(llmResult, userInfo, bot, instanceLogger);
  } catch (err) {
    instanceLogger.error({ err }, '❌ Failed to process text expense');
    await bot.sendMessage(userInfo.chatId, `❌ Failed to process expense: ${err}`);
  }
}

/**
 * Extracts user information from text messages (without caption)
 */
export function extractUserInfoFromText(msg: TelegramBot.Message): UserInfo {
  const chatId = msg.chat.id;
  const username = msg.from?.username || msg.from?.first_name || 'Unknown';
  const payer = USERNAME_TO_PAYER[username] || username;
  const messageText = msg.text || '';

  return {
    chatId,
    username,
    payer,
    messageText,
  };
}
