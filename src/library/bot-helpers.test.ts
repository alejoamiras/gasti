import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Message } from 'node-telegram-bot-api';
import {
  extractUserInfo,
  extractUserInfoFromText,
  processTextInput,
  processExpense,
} from './bot-helpers.js';

// Mock dependencies
jest.mock('./sheets.js', () => ({
  writeExpenseRow: jest.fn(),
}));

const mockBot = {
  sendMessage: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
};

describe('Bot Helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractUserInfo', () => {
    it('should extract user info from message with username', () => {
      const msg = {
        chat: { id: 123 },
        from: { username: 'alejoamiras' },
        caption: 'Test caption',
      } as unknown as Message;

      const result = extractUserInfo(msg);

      expect(result).toEqual({
        chatId: 123,
        username: 'alejoamiras',
        payer: 'alejo',
        messageText: 'Test caption',
      });
    });

    it('should extract user info from message with first name', () => {
      const msg = {
        chat: { id: 456 },
        from: { first_name: 'John' },
        caption: '',
      } as unknown as Message;

      const result = extractUserInfo(msg);

      expect(result).toEqual({
        chatId: 456,
        username: 'John',
        payer: 'John',
        messageText: '',
      });
    });

    it('should handle unknown user', () => {
      const msg = {
        chat: { id: 789 },
        from: {},
        caption: 'Some text',
      } as unknown as Message;

      const result = extractUserInfo(msg);

      expect(result).toEqual({
        chatId: 789,
        username: 'Unknown',
        payer: 'Unknown',
        messageText: 'Some text',
      });
    });
  });

  describe('extractUserInfoFromText', () => {
    it('should extract user info from text message', () => {
      const msg = {
        chat: { id: 123 },
        from: { username: 'morafreaza' },
        text: 'Almuerzo 1500',
      } as unknown as Message;

      const result = extractUserInfoFromText(msg);

      expect(result).toEqual({
        chatId: 123,
        username: 'morafreaza',
        payer: 'mora',
        messageText: 'Almuerzo 1500',
      });
    });
  });

  describe('processTextInput', () => {
    it('should return the input text unchanged', () => {
      const text = 'Some expense text';
      const result = processTextInput(text);
      expect(result).toBe(text);
    });
  });

  describe('processExpense', () => {
    const { writeExpenseRow } = require('./sheets.js');

    it('should process expense and send success message', async () => {
      const llmResult = {
        title: 'Supermercado',
        amount: 1500,
        category: '🛒',
        description: 'Compras del super',
        summary: 'Gasto de $1.500 agregado ✅',
      };

      const userInfo = {
        chatId: 123,
        username: 'alejoamiras',
        payer: 'alejo',
        messageText: 'super 1500',
      };

      await processExpense(llmResult, userInfo, mockBot as any, mockLogger as any);

      expect(writeExpenseRow).toHaveBeenCalledWith(
        ['Supermercado', 'ARS', '1500', '1500', 'alejo', '🛒', 'Compras del super'],
        mockLogger,
      );
      expect(mockBot.sendMessage).toHaveBeenCalledWith(123, 'Gasto de $1.500 agregado ✅');
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle errors when saving expense', async () => {
      const error = new Error('Database error');
      writeExpenseRow.mockRejectedValueOnce(error);

      const llmResult = {
        title: 'Test',
        amount: 100,
        category: '🤔',
        description: 'Test',
        summary: 'Test summary',
      };

      const userInfo = {
        chatId: 456,
        username: 'test',
        payer: 'test',
        messageText: 'test',
      };

      await expect(
        processExpense(llmResult, userInfo, mockBot as any, mockLogger as any),
      ).rejects.toThrow('Database error');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
