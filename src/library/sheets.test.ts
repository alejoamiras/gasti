import { describe, it, expect } from '@jest/globals';
import { buildRowRequests, firstEmptyRow, monthTabName } from './sheets.js';

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
