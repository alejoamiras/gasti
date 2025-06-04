// import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set in environment variables.');
}

export async function extractReceiptDataFromImage(base64Image: string, mimeType: string): Promise<any> {
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
          { type: 'text', text: `
Extract the following fields from this receipt image:
- description (in Spanish, neutral or Argentinian)
- amount
- category (choose one of: 🏡 (home), 🛒 (groceries), 🍾 (dates), 🐱 (pet), 🖼️ (furniture/art), 🛫 (travel), 🤔 (uncategorized, if unsure))
- comments (in Spanish, neutral or Argentinian)

Output the result as a JSON object with these keys.
          `.trim() },
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

  const data = (await response.json()) as any;
  console.log('OpenAI API raw response:', JSON.stringify(data, null, 2));
  if (!data.choices || !data.choices[0]?.message?.content) {
    throw new Error('No response from OpenAI Vision API');
  }

  // Try to parse the JSON from the response
  try {
    const jsonStart = data.choices[0].message.content.indexOf('{');
    const jsonEnd = data.choices[0].message.content.lastIndexOf('}') + 1;
    const jsonString = data.choices[0].message.content.slice(jsonStart, jsonEnd);
    return JSON.parse(jsonString);
  } catch (err) {
    throw new Error('Failed to parse JSON from LLM response: ' + data.choices[0].message.content);
  }
} 