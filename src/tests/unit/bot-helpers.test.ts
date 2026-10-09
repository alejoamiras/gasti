import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Message } from 'node-telegram-bot-api';
import { authorize, notify, parseAllowedUsers, processExpense } from '../../library/bot-helpers.js';

// Mock dependencies
jest.mock('../../library/sheets.js', () => ({
  writeExpenseRow: jest.fn(),
}));

import { writeExpenseRow } from '../../library/sheets.js';

const mockBot = {
  sendMessage: jest.fn(),
} as { sendMessage: jest.Mock };

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
} as {
  info: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
  warn: jest.Mock;
};

const userInfo = { chatId: 123, userId: 111, payer: 'alejo', messageText: 'super 1500' };

describe('Bot Helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseAllowedUsers', () => {
    it('maps telegram user ids and usernames to payers', () => {
      expect(parseAllowedUsers(' 111:alejo, @MoraFreaza:mora ,')).toEqual(
        new Map([
          ['111', 'alejo'],
          ['@morafreaza', 'mora'],
        ]),
      );
      expect(parseAllowedUsers('')).toEqual(new Map());
    });

    it('rejects malformed entries', () => {
      expect(() => parseAllowedUsers('alejoamiras:alejo')).toThrow('alejoamiras:alejo');
      expect(() => parseAllowedUsers('111')).toThrow('111');
    });
  });

  describe('authorize', () => {
    const allowed = parseAllowedUsers('111:alejo,@morafreaza:mora');

    it('accepts allowlisted ids and usernames, taking the caption or the text', () => {
      const photo = { chat: { id: 123 }, from: { id: 111 }, caption: 'Café' } as Message;
      const text = {
        chat: { id: 123 },
        from: { id: 222, username: 'MoraFreaza' },
        text: 'Café 2800',
      } as unknown as Message;

      expect(authorize(photo, allowed)).toEqual({ ...userInfo, messageText: 'Café' });
      expect(authorize(text, allowed)).toMatchObject({ payer: 'mora', messageText: 'Café 2800' });
    });

    it('rejects anyone else', () => {
      const stranger = {
        chat: { id: 9 },
        from: { id: 999, username: 'someone' },
        text: 'x',
      } as unknown as Message;
      expect(authorize(stranger, allowed)).toBeNull();
      expect(authorize({ chat: { id: 9 }, text: 'x' } as Message, allowed)).toBeNull();
    });
  });

  describe('notify', () => {
    it('masks bot tokens, since the chat may include people outside the allowlist', async () => {
      await notify(
        mockBot as never,
        123,
        '❌ EPARSE /bot123456789:AAHk3-fake_token_value_for_tests_0123/getFile',
        mockLogger as never,
      );
      expect(mockBot.sendMessage).toHaveBeenCalledWith(123, '❌ EPARSE /bot<bot-token>/getFile');
    });
  });

  describe('processExpense', () => {
    it('writes the row and confirms what was written', async () => {
      jest.mocked(writeExpenseRow).mockResolvedValueOnce({ tab: 'octubre 26', row: 13 });

      await processExpense(
        {
          title: 'Supermercado',
          amount: 15300.5,
          category: '🛒',
          description: 'Compras del super',
        },
        userInfo,
        mockBot as never,
        mockLogger as never,
      );

      expect(writeExpenseRow).toHaveBeenCalledWith(
        {
          title: 'Supermercado',
          amount: 15300.5,
          payer: 'alejo',
          category: '🛒',
          description: 'Compras del super',
        },
        mockLogger,
      );
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        123,
        '✅ Gasto agregado: Supermercado · $15.300,5 · 🛒 (octubre 26, fila 13)',
      );
    });

    it('does not report a failed confirmation as a failed write', async () => {
      jest.mocked(writeExpenseRow).mockResolvedValueOnce({ tab: 'octubre 26', row: 13 });
      mockBot.sendMessage.mockImplementationOnce(async () => {
        throw new Error('telegram down');
      });

      await expect(
        processExpense(
          { title: 'Café', amount: 2800, category: '🍾', description: 'Café' },
          userInfo,
          mockBot as never,
          mockLogger as never,
        ),
      ).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('propagates sheet errors', async () => {
      jest.mocked(writeExpenseRow).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        processExpense(
          { title: 'Test', amount: 100, category: '🤔', description: 'Test' },
          userInfo,
          mockBot as never,
          mockLogger as never,
        ),
      ).rejects.toThrow('Database error');
      expect(mockBot.sendMessage).not.toHaveBeenCalled();
    });
  });
});
