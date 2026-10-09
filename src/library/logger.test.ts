import { describe, it, expect } from '@jest/globals';
import { serializeError } from './logger.js';

describe('serializeError', () => {
  it('drops the request a client error carries', () => {
    const err = Object.assign(new Error('ETELEGRAM: 400 Bad Request'), {
      code: 'ETELEGRAM',
      response: { request: { uri: { href: 'https://api.telegram.org/botSECRET-TOKEN/getFile' } } },
    });
    const logged = JSON.stringify(serializeError(err));
    expect(logged).toContain('ETELEGRAM: 400 Bad Request');
    expect(logged).not.toContain('SECRET-TOKEN');
  });
});
