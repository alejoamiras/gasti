import logger from './logger.js';

export async function extractReceiptDataFromImage(
  base64Image: string,
  mimeType: string,
): Promise<Record<string, unknown>> {
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
            text: `Extract the following fields from this receipt image:
- description (in Spanish, neutral or Argentinian)
- amount
- category (choose one of: 🏡 (home), 🛒 (groceries), 🍾 (dates), 🐱 (pet), 🖼️ (furniture/art), 🛫 (travel), 🤔 (uncategorized, if unsure))
- comments (in Spanish, neutral or Argentinian)

Output the result as a JSON object with these keys.`.trim(),
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
    !Array.isArray((data as any).choices) ||
    !(data as any).choices[0]?.message?.content
  ) {
    logger.error({ data }, 'No response from OpenAI Vision API');
    throw new Error('No response from OpenAI Vision API');
  }

  // Try to parse the JSON from the response
  try {
    const content = (data as any).choices[0].message.content;
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}') + 1;
    const jsonString = content.slice(jsonStart, jsonEnd);
    return JSON.parse(jsonString);
  } catch (err) {
    logger.error(
      { err, content: (data as any).choices[0].message.content },
      'Failed to parse JSON from LLM response',
    );
    throw new Error(
      'Failed to parse JSON from LLM response: ' +
        (data as any).choices[0].message.content,
    );
  }
} 