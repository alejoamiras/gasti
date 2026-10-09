import { describe, it, expect } from '@jest/globals';
import { serializeError } from './logger.js';

describe('serializeError', () => {
  it('drops the request a client error carries and masks bot tokens', () => {
    const token = '123456789:AAHk3-fake_token_value_for_tests_0123';
    const err = Object.assign(new Error(`EPARSE: <html>/bot${token}/getFile</html>`), {
      code: 'EPARSE',
      response: { request: { uri: { href: `https://api.telegram.org/bot${token}/getFile` } } },
    });
    const logged = JSON.stringify(serializeError(err));
    expect(logged).toContain('EPARSE: <html>/bot<bot-token>/getFile');
    expect(logged).not.toContain(token);
  });
});
