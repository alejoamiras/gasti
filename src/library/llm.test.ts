import { describe, it, expect } from '@jest/globals';
import { buildRequest, extractExpense, parseCompletion } from './llm.js';

const completion = (content: string, finish_reason = 'stop') => ({
  choices: [{ finish_reason, message: { content, refusal: null } }],
});

describe('buildRequest', () => {
  it('asks for strict structured output and attaches the receipt image', () => {
    const request = buildRequest(
      { text: 'super', image: { base64: 'AAAA', mimeType: 'image/jpeg' } },
      'gpt-6-luna',
    );

    expect(request.model).toBe('gpt-6-luna');
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.properties.category.enum).toContain('🤔');
    expect(request.messages[1].content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA', detail: 'high' },
    });
  });
});

describe('parseCompletion', () => {
  it('returns the extracted expense', () => {
    const expense = { title: 'Chino', amount: 2500, category: '🛒', description: 'Compras' };
    expect(parseCompletion(completion(JSON.stringify(expense)))).toEqual(expense);
  });

  it('repairs values the sheet would mishandle', () => {
    const expense = { title: '  ', amount: 1, category: '❓', description: 'X' };
    const parsed = parseCompletion(completion(JSON.stringify(expense)));
    expect(parsed.category).toBe('🤔');
    expect(parsed.title).toBe('Otros');
  });

  it('rejects refusals, truncated output and missing amounts', () => {
    expect(() =>
      parseCompletion({ choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }),
    ).toThrow('rechazó');
    expect(() => parseCompletion(completion('{"title":', 'length'))).toThrow('incompleta');
    expect(() =>
      parseCompletion(
        completion('{"title":"Café","amount":0,"category":"🍾","description":"Café"}'),
      ),
    ).toThrow('monto');
  });
});

(process.env.OPENAI_API_KEY ? describe : describe.skip)('extractExpense (real API)', () => {
  it('reads an Argentinian text expense', async () => {
    const expense = await extractExpense({ text: 'Pagué 2.5k en el chino' });
    expect(expense.amount).toBe(2500);
    expect(expense.category).toBe('🛒');
  }, 60_000);
});
