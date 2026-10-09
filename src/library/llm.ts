import logger from './logger.js';
import type { Logger } from 'pino';

/** Must match the Categoría dropdown in the sheet, which rejects anything else. */
export const CATEGORIES = ['🏡', '🛒', '🍾', '🐱', '🖼️', '🛫', '🤔'] as const;

const DEFAULT_MODEL = 'gpt-6-luna';

export interface ExtractedExpense {
  title: string;
  amount: number;
  category: (typeof CATEGORIES)[number];
  description: string;
}

export interface ExpenseInput {
  text: string;
  image?: { base64: string; mimeType: string };
}

const EXPENSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'amount', 'category', 'description'],
  properties: {
    title: { type: 'string' },
    amount: { type: 'number' },
    category: { type: 'string', enum: CATEGORIES },
    description: { type: 'string' },
  },
};

const SYSTEM_PROMPT = `You extract one expense from a message, and from a receipt photo when one is attached, for a couple in Argentina who track shared expenses.

Messages are in Spanish (neutral or Argentinian) and may use local slang:
- "super" = supermercado, "chino" = supermercado chino, "verdu" = verdulería
- "morfi" = comida, "birra" = cerveza

Fields:
- title: if the user's text gives a clear title, use it. Otherwise use the store or company name when identifiable (e.g. "Carrefour", "Freddo"), or a generic label such as "Supermercado", "Restaurante", "Café", "Tienda de ropa", "Transporte", "Salud", "Ocio", "Otros".
- amount: the final total paid in ARS as a plain number, ignoring discounts, loyalty points and subtotals. Examples: "$1.500" → 1500, "3,200 pesos" → 3200, "2.5k" → 2500, "1k" → 1000, "2m" → 2000. Use 0 if no amount can be found.
- category: 🏡 home/utilities, 🛒 groceries/supermarket, 🍾 dates/restaurants/bars, 🐱 pet, 🖼️ furniture/art/decoration, 🛫 travel/transport, 🤔 if unsure.
- description: a brief Spanish summary of what was bought.

On a receipt, ignore QR codes, app promotions and anything that is not the purchase. The user's text, when present, is context for reading the receipt.`;

interface ChatCompletion {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  error?: { message?: string };
}

export function buildRequest(input: ExpenseInput, model: string) {
  const content: unknown[] = [{ type: 'text', text: `Mensaje del usuario: "${input.text}"` }];
  if (input.image) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${input.image.mimeType};base64,${input.image.base64}`,
        detail: 'high',
      },
    });
  }
  return {
    model,
    reasoning_effort: 'low',
    max_completion_tokens: 4000,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'expense', strict: true, schema: EXPENSE_SCHEMA },
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
  };
}

/** Throws a user-facing error when the model refuses, is cut off, or finds no amount. */
export function parseCompletion(data: ChatCompletion): ExtractedExpense {
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) {
    throw new Error(`El modelo rechazó el pedido: ${choice.message.refusal}`);
  }
  if (choice?.finish_reason !== 'stop' || !choice.message?.content) {
    throw new Error(
      `Respuesta incompleta del modelo (${choice?.finish_reason ?? 'sin respuesta'})`,
    );
  }
  const expense = JSON.parse(choice.message.content) as ExtractedExpense;
  if (!(expense.amount > 0)) {
    throw new Error('No encontré el monto del gasto');
  }
  // Strict schemas enforce the enum, but OPENAI_MODEL may name a model that ignores them.
  if (!CATEGORIES.includes(expense.category)) expense.category = '🤔';
  return expense;
}

export async function extractExpense(
  input: ExpenseInput,
  instanceLogger?: Logger,
): Promise<ExtractedExpense> {
  const log = instanceLogger || logger;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRequest(input, process.env.OPENAI_MODEL || DEFAULT_MODEL)),
  });
  const data = (await response.json()) as ChatCompletion;
  if (!response.ok) {
    log.error({ status: response.status, error: data.error }, '🚨 OpenAI API error');
    throw new Error(`OpenAI API error ${response.status}: ${data.error?.message ?? 'unknown'}`);
  }
  return parseCompletion(data);
}
