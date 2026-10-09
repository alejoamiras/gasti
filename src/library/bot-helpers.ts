import TelegramBot from 'node-telegram-bot-api';
import type { Logger } from 'pino';
import { writeExpenseRow } from './sheets.js';
import { extractExpense, type ExpenseInput, type ExtractedExpense } from './llm.js';
import { convertPdfToImages } from './pdf.js';
import { maskBotTokens } from './logger.js';

// Interface for user information extracted from messages
export interface UserInfo {
  chatId: number;
  userId: number;
  payer: string;
  messageText: string;
}

// Interface for processed input data
export interface ProcessedInput {
  base64Image: string;
  mimeType: string;
}

/**
 * Parses TELEGRAM_ALLOWED_USERS ("<telegram user id>:<payer>,...") into a user id → payer map.
 * Keyed by numeric id because usernames can be changed or claimed by someone else.
 */
export function parseAllowedUsers(value: string): Map<number, string> {
  const users = new Map<number, string>();
  for (const entry of value.split(',').filter((e) => e.trim())) {
    const [id, payer] = entry.split(':').map((part) => part.trim());
    if (!/^\d+$/.test(id ?? '') || !payer) {
      throw new Error(`Invalid TELEGRAM_ALLOWED_USERS entry: "${entry}"`);
    }
    users.set(Number(id), payer);
  }
  return users;
}

/** Returns the sender's info, or null when they are not on the allowlist. */
export function authorize(
  msg: TelegramBot.Message,
  allowedUsers: Map<number, string>,
): UserInfo | null {
  const userId = msg.from?.id;
  const payer = userId === undefined ? undefined : allowedUsers.get(userId);
  if (userId === undefined || !payer) return null;
  return {
    chatId: msg.chat.id,
    userId,
    payer,
    messageText: msg.caption || msg.text || '',
  };
}

/**
 * Sends a chat message without throwing: a failed reply must not read as a failed write,
 * and an unhandled rejection would trigger the process-wide shutdown handler. Error text
 * is masked because the chat may be a group with people outside the allowlist.
 */
export async function notify(
  bot: TelegramBot,
  chatId: number,
  text: string,
  instanceLogger: Logger,
): Promise<void> {
  try {
    await bot.sendMessage(chatId, maskBotTokens(text));
  } catch (err) {
    instanceLogger.error({ err, chatId }, '❌ Failed to send Telegram message');
  }
}

export function formatConfirmation(expense: ExtractedExpense, tab: string, row: number): string {
  const amount = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(
    expense.amount,
  );
  return `✅ Gasto agregado: ${expense.title} · $${amount} · ${expense.category} (${tab}, fila ${row})`;
}

/**
 * Saves an extracted expense to Google Sheets and confirms it to the user
 */
export async function processExpense(
  expense: ExtractedExpense,
  userInfo: UserInfo,
  bot: TelegramBot,
  instanceLogger: Logger,
): Promise<void> {
  const { tab, row } = await writeExpenseRow(
    {
      title: expense.title,
      amount: expense.amount,
      payer: userInfo.payer,
      category: expense.category,
      description: expense.description,
    },
    instanceLogger,
  );
  instanceLogger.info({ userId: userInfo.userId, tab, row }, '📊 Expense added to Google Sheets');

  await notify(bot, userInfo.chatId, formatConfirmation(expense, tab, row), instanceLogger);
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
 * Extracts an expense from a text message or receipt and saves it
 */
export async function handleExpense(
  userInfo: UserInfo,
  receipt: ProcessedInput | undefined,
  bot: TelegramBot,
  instanceLogger: Logger,
): Promise<void> {
  try {
    const input: ExpenseInput = { text: userInfo.messageText };
    if (receipt) input.image = { base64: receipt.base64Image, mimeType: receipt.mimeType };

    const expense = await extractExpense(input, instanceLogger);
    instanceLogger.debug({ expense }, '🧠 LLM extracted expense data');

    await processExpense(expense, userInfo, bot, instanceLogger);
  } catch (err) {
    instanceLogger.error({ err }, '❌ Failed to process expense');
    await notify(bot, userInfo.chatId, `❌ No se pudo agregar el gasto: ${err}`, instanceLogger);
  }
}
