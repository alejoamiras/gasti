import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Message } from 'node-telegram-bot-api';
import { authorize, parseAllowedUsers, processExpense } from '../../library/bot-helpers.js';

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
    it('maps telegram user ids to payers', () => {
      expect(parseAllowedUsers(' 111:alejo, 222:mora ,')).toEqual(
        new Map([
          [111, 'alejo'],
          [222, 'mora'],
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
    const allowed = new Map([[111, 'alejo']]);

    it('accepts allowlisted senders, taking the caption or the text', () => {
      const photo = { chat: { id: 123 }, from: { id: 111 }, caption: 'Café' } as Message;
      const text = { chat: { id: 123 }, from: { id: 111 }, text: 'Café 2800' } as Message;

      expect(authorize(photo, allowed)).toEqual({ ...userInfo, messageText: 'Café' });
      expect(authorize(text, allowed)?.messageText).toBe('Café 2800');
    });

    it('rejects anyone else, whatever their username', () => {
      const msg = {
        chat: { id: 9 },
        from: { id: 999, username: 'alejoamiras' },
        text: 'x',
      } as unknown as Message;
      expect(authorize(msg, allowed)).toBeNull();
      expect(authorize({ chat: { id: 9 }, text: 'x' } as Message, allowed)).toBeNull();
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
