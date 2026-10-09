import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { sheets_v4 } from 'googleapis';
import { buildRowRequests, firstEmptyRow, monthTabName, writeExpenseRow } from './sheets.js';

// In-memory month tab; the factory only reads it inside functions called after setup.
const mockSheet = {
  tabs: [] as string[],
  e3: '',
  titles: [] as string[][],
  writes: 0,
};

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn() },
    sheets: () => ({
      spreadsheets: {
        get: async () => ({
          data: {
            sheets: mockSheet.tabs.map((title, sheetId) => ({ properties: { title, sheetId } })),
          },
        }),
        values: {
          batchGet: async () => {
            const titles = mockSheet.titles.map((cells) => [...cells]);
            // Yield so that unserialized writes would interleave and pick the same row.
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { data: { valueRanges: [{ values: titles }, { values: [[mockSheet.e3]] }] } };
          },
        },
        batchUpdate: async ({
          requestBody,
        }: {
          requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest;
        }) => {
          const cells = requestBody.requests?.[0].updateCells;
          const title = cells?.rows?.[0].values?.[0].userEnteredValue?.stringValue ?? '';
          if (title === 'boom') throw new Error('rejected');
          mockSheet.titles[(cells?.range?.startRowIndex ?? 0) - 2] = [title];
          mockSheet.writes += 1;
        },
      },
    }),
  },
}));

const expense = (title: string) => ({
  title,
  amount: 100,
  payer: 'alejo',
  category: '🛒',
  description: '',
});

describe('monthTabName', () => {
  it('names the tab in Argentina time, with the year', () => {
    // 23:30 in Buenos Aires is already November and 2027 in UTC.
    expect(monthTabName(new Date('2026-10-31T23:30:00-03:00'))).toBe('octubre 26');
    expect(monthTabName(new Date('2026-12-31T23:30:00-03:00'))).toBe('diciembre 26');
    expect(monthTabName(new Date('2027-01-01T00:30:00-03:00'))).toBe('enero 27');
  });
});

describe('firstEmptyRow', () => {
  it('returns the first gap in Gasto, or the row after the last one', () => {
    expect(firstEmptyRow([])).toBe(3);
    expect(firstEmptyRow([['Expensas'], [], ['Verdu']])).toBe(4);
    expect(firstEmptyRow([['Expensas'], ['Personal']])).toBe(5);
    expect(firstEmptyRow([[0], [false], ['']])).toBe(5);
  });
});

describe('buildRowRequests', () => {
  it('fills B:D and F:I of the target row and copies the ARS formula into E', () => {
    const [left, ars, right] = buildRowRequests(42, 13, {
      title: 'Chino',
      amount: 8432.5,
      payer: 'mora',
      category: '🛒',
      description: '=HYPERLINK("x")',
    });

    const target = { sheetId: 42, startRowIndex: 12, endRowIndex: 13 };
    expect(left.updateCells?.range).toEqual({ ...target, startColumnIndex: 1, endColumnIndex: 4 });
    expect(left.updateCells?.rows?.[0].values).toEqual([
      { userEnteredValue: { stringValue: 'Chino' } },
      { userEnteredValue: { stringValue: 'ARS' } },
      { userEnteredValue: { numberValue: 8432.5 } },
    ]);

    expect(ars.copyPaste?.source).toEqual({
      sheetId: 42,
      startRowIndex: 2,
      endRowIndex: 3,
      startColumnIndex: 4,
      endColumnIndex: 5,
    });
    expect(ars.copyPaste?.destination).toEqual({
      ...target,
      startColumnIndex: 4,
      endColumnIndex: 5,
    });
    expect(ars.copyPaste?.pasteType).toBe('PASTE_FORMULA');

    expect(right.updateCells?.range).toEqual({ ...target, startColumnIndex: 5, endColumnIndex: 9 });
    expect(right.updateCells?.rows?.[0].values).toEqual([
      { userEnteredValue: { stringValue: 'mora' } },
      { userEnteredValue: { stringValue: '🛒' } },
      { userEnteredValue: { stringValue: 'variable' } },
      { userEnteredValue: { stringValue: '=HYPERLINK("x")' } },
    ]);
  });
});

describe('writeExpenseRow', () => {
  beforeEach(() => {
    process.env.BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS = Buffer.from('{}').toString('base64');
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet';
    Object.assign(mockSheet, {
      tabs: [monthTabName()],
      e3: '=IF(C3="USD";MULTIPLY($D3;$L$18);$D3)',
      titles: [['Expensas']],
      writes: 0,
    });
  });

  it('gives concurrent writes consecutive rows and keeps going after a failure', async () => {
    const results = await Promise.allSettled([
      writeExpenseRow(expense('A')),
      writeExpenseRow(expense('boom')),
      writeExpenseRow(expense('C')),
    ]);

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value.row : 'failed'))).toEqual([
      4,
      'failed',
      5,
    ]);
    expect(mockSheet.titles).toEqual([['Expensas'], ['A'], ['C']]);
  });

  it('writes nothing when the month tab or the ARS formula is missing', async () => {
    mockSheet.tabs = ['template'];
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('No existe la pestaña');

    mockSheet.tabs = [monthTabName()];
    mockSheet.e3 = '';
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('fórmula de ARS');

    expect(mockSheet.writes).toBe(0);
  });
});
