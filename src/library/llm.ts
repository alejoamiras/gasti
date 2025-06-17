import logger from './logger.js';

// Logger interface to support instance tracking
interface Logger {
  info: (msg: any, ...args: any[]) => void;
  error: (msg: any, ...args: any[]) => void;
  warn: (msg: any, ...args: any[]) => void;
  debug: (msg: any, ...args: any[]) => void;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}
interface LLMResult {
  title: string;
  amount: number;
  category: string;
  description: string;
  summary: string;
}

export async function extractReceiptDataFromImage(
  base64Image: string,
  mimeType: string,
  messageText: string,
  instanceLogger?: Logger,
): Promise<LLMResult> {
  const log = instanceLogger || logger; // Use instanceLogger if provided, fallback to default
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables.');
  }
  const payload = {
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: [
          { type: 'text', text: 'You are an expert at extracting expense data from receipts.' },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `📸 Receipt Extraction Prompt
🎯 Mission
You are a helpful assistant designed to extract structured data from photos of receipts. You must also consider the additional context provided by the user in text, which may help clarify the receipt.

🌍 Context
Users are from Argentina. Receipts are in Spanish (neutral or Argentinian). You may encounter local slang such as:
- "Super" = supermercado (grocery store)
- "Chino" = supermercado chino (Chinese-owned grocery store)
- "Verdu" = verdulería (produce store)

🧾 Instructions
From the receipt image, extract the following fields as a JSON object:
- title
- amount
- category
- description
- summary

📌 Field Guidelines:
- title:
If the user-provided text gives a clear title, use it. Otherwise, infer it from the receipt image.
If the store or company name is identifiable, use it (e.g. "Carrefour", "Freddo").
If not, assign a generic label like: "Supermercado", "Restaurante", "Café", "Tienda de ropa", "Cine", "Hotel", "Educación", "Salud", "Ocio", "Transporte", "Otros".

- amount:
Total amount paid. Use the final total in Argentine pesos (ARS), ignoring discounts, loyalty points, etc.

- category:
Choose only one of the following emojis:

🏡 (home)
🛒 (groceries)
🍾 (dates)
🐱 (pet)
🖼️ (furniture/art)
🛫 (travel)
🤔 (uncategorized, if unsure)

- description:
A brief, human-readable summary of the items or services purchased. Use Spanish (neutral or Argentinian).

- summary:
One short sentence in Spanish summarizing the purchase. Include the fact that the expense was added, the amount, name and maybe category.
Example: "Compra de $35.200 en supermercado chino agregada como gasto.", "Compra en Carrefour agregada como gasto.", "Compra de $10.000 en cita agregada como gasto."

🧠 Additional Context
Use this text provided by the user to help interpret the receipt:
${messageText}

⚠️ Notes
Ignore irrelevant information such as QR codes, app promotions, or non-purchase data.

If any field is missing or unclear, do your best to infer or leave it empty with null.

🧾 Example Output
{
  "title": "Supermercado Chino",
  "amount": 8432.50,
  "category": "🛒",
  "description": "Compra de alimentos y productos de limpieza",
  "summary": "Gasto de $15.300 en supermercado chino agregado."
}
`.trim(),
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    max_tokens: 1000,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as unknown;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('choices' in data) ||
    !Array.isArray((data as OpenAIResponse).choices) ||
    !(data as OpenAIResponse).choices[0]?.message?.content
  ) {
    log.error({ data }, '🚨 No response from OpenAI Vision API');
    throw new Error('No response from OpenAI Vision API');
  }

  // Try to parse the JSON from the response
  try {
    const content = (data as OpenAIResponse).choices[0].message.content;
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}') + 1;
    const jsonString = content.slice(jsonStart, jsonEnd);
    return JSON.parse(jsonString);
  } catch (err) {
    log.error(
      { err, content: (data as OpenAIResponse).choices[0].message.content },
      '❌ Failed to parse JSON from LLM response',
    );
    throw new Error(
      'Failed to parse JSON from LLM response: ' +
        (data as OpenAIResponse).choices[0].message.content,
    );
  }
}
