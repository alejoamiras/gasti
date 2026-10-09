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

/** Used when TELEGRAM_ALLOWED_USERS is unset. */
export const DEFAULT_ALLOWED_USERS = '@alejoamiras:alejo,@morafreaza:mora';

/**
 * Parses TELEGRAM_ALLOWED_USERS ("<telegram user id>:<payer>" or "@<username>:<payer>", comma
 * separated) into a sender → payer map. Numeric ids are safer: a username that its owner
 * gives up can be claimed by someone else.
 */
export function parseAllowedUsers(value: string): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of value.split(',').filter((e) => e.trim())) {
    const [sender, payer] = entry.split(':').map((part) => part.trim());
    if (!/^(\d+|@\w{5,32})$/.test(sender ?? '') || !payer) {
      throw new Error(`Invalid TELEGRAM_ALLOWED_USERS entry: "${entry}"`);
    }
    users.set(sender.toLowerCase(), payer);
  }
  return users;
}

/** Returns the sender's info, or null when they are not on the allowlist. */
export function authorize(
  msg: TelegramBot.Message,
  allowedUsers: Map<string, string>,
): UserInfo | null {
  const from = msg.from;
  if (!from) return null;
  // Telegram usernames are case-insensitive.
  const payer =
    allowedUsers.get(String(from.id)) ??
    (from.username ? allowedUsers.get(`@${from.username.toLowerCase()}`) : undefined);
  if (!payer) return null;
  return {
    chatId: msg.chat.id,
    userId: from.id,
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

/** Downloads a Telegram file. Errors never include the URL, which embeds the bot token. */
async function downloadTelegramFile(fileId: string, bot: TelegramBot, token: string) {
  const file = await bot.getFile(fileId);
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el archivo de Telegram (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Processes photo input from Telegram and returns standardized data
 */
export async function processPhotoInput(
  photo: TelegramBot.PhotoSize,
  bot: TelegramBot,
  token: string,
): Promise<ProcessedInput> {
  const buffer = await downloadTelegramFile(photo.file_id, bot, token);
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
  const buffer = await downloadTelegramFile(document.file_id, bot, token);
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
