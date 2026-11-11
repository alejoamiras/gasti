import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { sheets_v4 } from 'googleapis';
import {
  buildRowRequests,
  findLayout,
  firstEmptyRow,
  monthTabName,
  sheetDateSerial,
  writeExpenseRow,
} from './sheets.js';

const HEADERS = ['Gasto', 'Moneda', 'Monto', 'ARS', 'Paga', 'Categoría', 'Tipo', 'Comments'];
const ARS_FORMULA = '=IF(C3="USD";MULTIPLY($D3;$L$18);$D3)';

// Summary beside the expenses: headers on row 2 from column B, no Fecha.
const sideLayout = (...titles: unknown[]): unknown[][] => [
  [],
  ['', ...HEADERS, '', 'Ingresos'],
  ...titles.map((title) => ['', title, 'ARS', 100, ARS_FORMULA]),
];
// Summary above the expenses: headers on row 5 from column A, starting with Fecha.
const topLayout = (...titles: unknown[]): unknown[][] => [
  ['Mora le debe a Alejo $1'],
  ['', 'ARS', '', '', '', 'USD'],
  ['Pagó', 100, 200],
  [],
  ['Fecha', ...HEADERS],
  ...titles.map((title) => ['', title, 'ARS', 100, ARS_FORMULA]),
];

type Rate = { entered: string | number; effective?: number };

// In-memory spreadsheet; the factory only reads it inside functions called after setup.
const mockSheet = {
  tabs: [] as string[],
  /** Cells of the tab being written, as the FORMULA rendering returns them. */
  grid: [] as unknown[][],
  /** Exchange-rate cell (L18, labelled in K18) of other tabs. */
  rates: new Map<string, Rate>(),
  rateReads: 0,
  duplicatedFrom: [] as number[],
  writtenTo: [] as number[],
  ids: new Map<string, number>(),
};
// Stable per-tab ids, like the real API: inserting a tab never renumbers the others.
const mockSheetId = (title: string) => {
  if (!mockSheet.ids.has(title)) mockSheet.ids.set(title, 100 + mockSheet.ids.size);
  return mockSheet.ids.get(title) as number;
};

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn() },
    sheets: () => ({
      spreadsheets: {
        get: async ({ ranges }: { ranges?: string[] }) => {
          if (!ranges) {
            return {
              data: {
                sheets: mockSheet.tabs.map((title, index) => ({
                  properties: { title, index, sheetId: mockSheetId(title) },
                })),
              },
            };
          }
          mockSheet.rateReads += 1;
          const rate = mockSheet.rates.get(ranges[0].split("'")[1]) as Rate;
          const cell: sheets_v4.Schema$CellData =
            typeof rate.entered === 'number'
              ? { userEnteredValue: { numberValue: rate.entered } }
              : {
                  userEnteredValue: { formulaValue: rate.entered },
                  effectiveValue:
                    rate.effective === undefined
                      ? { errorValue: { type: 'N_A' } }
                      : { numberValue: rate.effective },
                };
          const rowData: sheets_v4.Schema$RowData[] = Array.from({ length: 17 }, () => ({}));
          rowData.push({
            values: [
              ...Array.from({ length: 10 }, () => ({})),
              { userEnteredValue: { stringValue: 'Cambio Dólares' } },
              cell,
            ],
          });
          return { data: { sheets: [{ data: [{ rowData }] }] } };
        },
        values: {
          get: async () => {
            const values = mockSheet.grid.map((cells) => [...cells]);
            // Yield so that unserialized writes would interleave and pick the same row.
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { data: { values } };
          },
        },
        batchUpdate: async ({
          requestBody,
        }: {
          requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest;
        }) => {
          const requests = requestBody.requests ?? [];
          const duplicate = requests[0].duplicateSheet;
          if (duplicate) {
            mockSheet.duplicatedFrom.push(duplicate.sourceSheetId ?? -1);
            mockSheet.tabs.splice(duplicate.insertSheetIndex ?? 0, 0, duplicate.newSheetName ?? '');
            const sheetId = mockSheetId(duplicate.newSheetName ?? '');
            return { data: { replies: [{ duplicateSheet: { properties: { sheetId } } }] } };
          }
          const value = (request: sheets_v4.Schema$Request) =>
            request.updateCells?.rows?.[0].values?.[0].userEnteredValue;
          const sheetId = requests[0].updateCells?.range?.sheetId ?? -1;

          const rateTab = [...mockSheet.rates.keys()].find((tab) => mockSheetId(tab) === sheetId);
          if (rateTab) {
            const { startRowIndex, startColumnIndex } = requests[0].updateCells?.range ?? {};
            expect([startRowIndex, startColumnIndex]).toEqual([17, 11]);
            mockSheet.rates.set(rateTab, { entered: value(requests[0])?.numberValue as number });
            return { data: {} };
          }

          // Atomic like the real call: a rejected request leaves the grid untouched.
          if (requests.some((r) => value(r)?.stringValue === 'boom')) throw new Error('rejected');
          for (const request of requests) {
            const range = (request.updateCells?.range ?? request.copyPaste?.destination) as {
              startRowIndex: number;
              startColumnIndex: number;
            };
            const cells = (mockSheet.grid[range.startRowIndex] ??= []);
            cells[range.startColumnIndex] = request.copyPaste
              ? ARS_FORMULA
              : (value(request)?.stringValue ?? value(request)?.numberValue);
          }
          mockSheet.writtenTo.push(sheetId);
          return { data: {} };
        },
      },
    }),
  },
}));

const NOVEMBER = new Date('2026-11-11T12:00:00-03:00');
const expense = (title: string, date = NOVEMBER) => ({
  title,
  amount: 100,
  payer: 'alejo',
  category: '🛒',
  description: '',
  date,
});
const titlesOf = (grid: unknown[][], column: number, fromRow: number) =>
  grid.slice(fromRow - 1).map((cells) => cells[column]);

describe('monthTabName', () => {
  it('names the tab in Argentina time, with the year', () => {
    // 23:30 in Buenos Aires is already November and 2027 in UTC.
    expect(monthTabName(new Date('2026-10-31T23:30:00-03:00'))).toBe('octubre 26');
    expect(monthTabName(new Date('2026-12-31T23:30:00-03:00'))).toBe('diciembre 26');
    expect(monthTabName(new Date('2027-01-01T00:30:00-03:00'))).toBe('enero 27');
  });

  it('names earlier months across a year boundary', () => {
    expect(monthTabName(new Date('2027-01-15T12:00:00-03:00'), 1)).toBe('diciembre 26');
    expect(monthTabName(NOVEMBER, 1)).toBe('octubre 26');
  });
});

describe('sheetDateSerial', () => {
  it("is the Sheets serial of the instant's day in Argentina", () => {
    // 2024-01-01 is serial 45292; late on the 31st in Buenos Aires is already the 1st in UTC.
    expect(sheetDateSerial(new Date('2024-01-01T12:00:00-03:00'))).toBe(45292);
    expect(sheetDateSerial(new Date('2026-10-31T23:30:00-03:00'))).toBe(46326);
  });
});

describe('findLayout', () => {
  it('finds the expense table by its headers, wherever the tab puts it', () => {
    expect(findLayout(sideLayout('Expensas'))).toEqual({
      firstDataRow: 3,
      cols: {
        title: 1,
        currency: 2,
        amount: 3,
        ars: 4,
        payer: 5,
        category: 6,
        type: 7,
        comments: 8,
      },
    });
    // The summary's own "ARS" label on row 2 is not mistaken for the header row.
    expect(findLayout(topLayout('Expensas'))).toMatchObject({
      firstDataRow: 6,
      cols: { date: 0, title: 1, ars: 4, comments: 8 },
    });
    expect(findLayout([[], ['', 'Gasto', 'Monto']])).toBeNull();
  });
});

describe('firstEmptyRow', () => {
  it('returns the first gap in Gasto, or the row after the last one', () => {
    const row = (grid: unknown[][]) =>
      firstEmptyRow(grid, findLayout(grid) as NonNullable<ReturnType<typeof findLayout>>);

    expect(row(sideLayout())).toBe(3);
    expect(row(sideLayout('Expensas', '', 'Verdu'))).toBe(4);
    expect(row(sideLayout('Expensas', 'Personal'))).toBe(5);
    expect(row(sideLayout(0, false, ''))).toBe(5);
    expect(row(topLayout('Expensas'))).toBe(7);
  });
});

describe('buildRowRequests', () => {
  const layout = findLayout(topLayout('Expensas')) as NonNullable<ReturnType<typeof findLayout>>;
  const row = { sheetId: 42, startRowIndex: 12, endRowIndex: 13 };
  const cellAt = (col: number) => ({ ...row, startColumnIndex: col, endColumnIndex: col + 1 });

  it('fills each column of the target row, verbatim, and copies the ARS formula', () => {
    const requests = buildRowRequests(42, 13, layout, {
      title: 'Chino',
      amount: 8432.5,
      payer: 'mora',
      category: '🛒',
      description: '=HYPERLINK("x")',
      date: new Date('2026-10-31T23:30:00-03:00'),
    });

    const written = requests.flatMap(({ updateCells }) =>
      updateCells ? [[updateCells.range, updateCells.rows?.[0].values?.[0].userEnteredValue]] : [],
    );
    expect(written).toEqual([
      [cellAt(1), { stringValue: 'Chino' }],
      [cellAt(2), { stringValue: 'ARS' }],
      [cellAt(3), { numberValue: 8432.5 }],
      [cellAt(5), { stringValue: 'mora' }],
      [cellAt(6), { stringValue: '🛒' }],
      [cellAt(7), { stringValue: 'variable' }],
      [cellAt(8), { stringValue: '=HYPERLINK("x")' }],
      [cellAt(0), { numberValue: 46326 }],
    ]);

    const date = requests[requests.length - 1].updateCells;
    expect(date?.rows?.[0].values?.[0].userEnteredFormat).toEqual({
      numberFormat: { type: 'DATE', pattern: 'dd/mm' },
    });
    expect(date?.fields).toBe('userEnteredValue,userEnteredFormat.numberFormat');

    const ars = requests.find((request) => request.copyPaste)?.copyPaste;
    expect(ars?.source).toEqual({ ...cellAt(4), startRowIndex: 5, endRowIndex: 6 });
    expect(ars?.destination).toEqual(cellAt(4));
    expect(ars?.pasteType).toBe('PASTE_FORMULA');
  });

  it('writes no date on a tab without a Fecha column', () => {
    const noDate = findLayout(sideLayout('Expensas')) as typeof layout;
    const columns = buildRowRequests(42, 13, noDate, expense('Chino')).map(
      (r) => (r.updateCells?.range ?? r.copyPaste?.destination)?.startColumnIndex,
    );
    expect(columns).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('writeExpenseRow', () => {
  beforeEach(() => {
    process.env.BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS = Buffer.from('{}').toString('base64');
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet';
    Object.assign(mockSheet, {
      tabs: ['noviembre 26'],
      grid: sideLayout('Expensas'),
      rates: new Map(),
      rateReads: 0,
      duplicatedFrom: [],
      writtenTo: [],
      ids: new Map(),
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
    expect(titlesOf(mockSheet.grid, 1, 3)).toEqual(['Expensas', 'A', 'C']);
  });

  it('writes under the headers of a tab laid out differently, dating the row', async () => {
    mockSheet.grid = topLayout('Expensas');

    await expect(writeExpenseRow(expense('A'))).resolves.toEqual({ tab: 'noviembre 26', row: 7 });
    expect(mockSheet.grid[6]).toEqual([
      46337,
      'A',
      'ARS',
      100,
      ARS_FORMULA,
      'alejo',
      '🛒',
      'variable',
      '',
    ]);
  });

  it("creates the month's tab once from the template, just before it, and writes there", async () => {
    mockSheet.tabs = ['septiembre 26', 'template', 'mari'];
    const templateId = mockSheetId('template');

    const rows = await Promise.all([writeExpenseRow(expense('A')), writeExpenseRow(expense('B'))]);

    expect(rows).toEqual([
      { tab: 'noviembre 26', row: 4 },
      { tab: 'noviembre 26', row: 5 },
    ]);
    expect(mockSheet.tabs).toEqual(['septiembre 26', 'noviembre 26', 'template', 'mari']);
    const monthId = mockSheetId('noviembre 26');
    expect(mockSheet.duplicatedFrom).toEqual([templateId]);
    expect(mockSheet.writtenTo).toEqual([monthId, monthId]);
    expect(monthId).not.toBe(templateId);
  });

  it('writes nothing without a tab or template, the headers, or the ARS formula', async () => {
    mockSheet.tabs = ['mari'];
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('ni la plantilla');

    mockSheet.tabs = ['noviembre 26'];
    mockSheet.grid = [[], ['', 'Gasto', 'Monto']];
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('fila de encabezados');

    mockSheet.grid = sideLayout();
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('fórmula de ARS');

    expect(mockSheet.writtenTo).toEqual([]);
  });

  // Each case uses its own month: the module remembers which tabs it has already fixed.
  describe('exchange rate of the previous month', () => {
    const live = '=GOOGLEFINANCE("CURRENCY:USDARS")';

    it('is fixed at its current value once, and reported', async () => {
      const december = new Date('2026-12-01T09:00:00-03:00');
      mockSheet.tabs = ['noviembre 26', 'diciembre 26'];
      mockSheet.rates.set('noviembre 26', { entered: live, effective: 1550.25 });

      await expect(writeExpenseRow(expense('A', december))).resolves.toEqual({
        tab: 'diciembre 26',
        row: 4,
        frozenRate: { tab: 'noviembre 26', rate: 1550.25 },
      });
      expect(mockSheet.rates.get('noviembre 26')).toEqual({ entered: 1550.25 });

      await expect(writeExpenseRow(expense('B', december))).resolves.toEqual({
        tab: 'diciembre 26',
        row: 5,
      });
      expect(mockSheet.rateReads).toBe(1);
    });

    it('stays live while it has no value, without failing the expense, and is retried', async () => {
      const january = new Date('2027-01-02T09:00:00-03:00');
      mockSheet.tabs = ['diciembre 26', 'enero 27'];
      mockSheet.rates.set('diciembre 26', { entered: live });

      await expect(writeExpenseRow(expense('A', january))).resolves.toEqual({
        tab: 'enero 27',
        row: 4,
        frozenRate: { tab: 'diciembre 26', rate: null },
      });
      expect(mockSheet.rates.get('diciembre 26')).toEqual({ entered: live });

      mockSheet.rates.set('diciembre 26', { entered: live, effective: 1600 });
      const retried = await writeExpenseRow(expense('B', january));
      expect(retried.frozenRate).toEqual({ tab: 'diciembre 26', rate: 1600 });
    });

    it('is left alone when it is already a fixed number', async () => {
      const february = new Date('2027-02-02T09:00:00-03:00');
      mockSheet.tabs = ['enero 27', 'febrero 27'];
      mockSheet.rates.set('enero 27', { entered: 1700 });

      await expect(writeExpenseRow(expense('A', february))).resolves.toEqual({
        tab: 'febrero 27',
        row: 4,
      });
      expect(mockSheet.rates.get('enero 27')).toEqual({ entered: 1700 });
    });
  });
});
