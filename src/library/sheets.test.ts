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
const LIVE_RATE = '=GOOGLEFINANCE("CURRENCY:USDARS")';

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
/** Puts the rate label at a zero-based position, with the rate in the cell to its right. */
const withRate = (grid: unknown[][], row: number, col: number, rate: unknown): unknown[][] => {
  while (grid.length <= row) grid.push([]);
  while (grid[row].length < col) grid[row].push('');
  grid[row][col] = 'Cambio Dólares';
  grid[row][col + 1] = rate;
  return grid;
};

// In-memory spreadsheet; the factory only reads it inside functions called after setup.
const mockSheet = {
  tabs: [] as string[],
  /** Cells of each tab, as the FORMULA rendering returns them. */
  grids: new Map<string, unknown[][]>(),
  /** What a formula cell currently computes to, by A1 range; any other cell reads as an error. */
  computed: new Map<string, number>(),
  /** Requests the API refuses, failing their whole batch. */
  rejects: (request: sheets_v4.Schema$Request): boolean => mockEntered(request) === 'boom',
  duplicatedFrom: [] as number[],
  writtenTo: [] as number[],
  ids: new Map<string, number>(),
};
// Stable per-tab ids, like the real API: inserting a tab never renumbers the others.
const mockSheetId = (title: string) => {
  if (!mockSheet.ids.has(title)) mockSheet.ids.set(title, 100 + mockSheet.ids.size);
  return mockSheet.ids.get(title) as number;
};
const mockTabOf = (range: string) => range.split("'")[1];
const mockCopyOf = (tab: string) => (mockSheet.grids.get(tab) ?? []).map((cells) => [...cells]);
function mockEntered(request: sheets_v4.Schema$Request) {
  const value = request.updateCells?.rows?.[0].values?.[0].userEnteredValue;
  return value?.stringValue ?? value?.numberValue;
}

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn() },
    sheets: () => ({
      spreadsheets: {
        get: async () => ({
          data: {
            sheets: mockSheet.tabs.map((title, index) => ({
              properties: { title, index, sheetId: mockSheetId(title) },
            })),
          },
        }),
        values: {
          get: async ({
            range,
            valueRenderOption,
          }: {
            range: string;
            valueRenderOption: string;
          }) => {
            if (valueRenderOption === 'UNFORMATTED_VALUE') {
              return { data: { values: [[mockSheet.computed.get(range) ?? '#N/A']] } };
            }
            const values = mockCopyOf(mockTabOf(range));
            // Yield so that unserialized writes would interleave and pick the same row.
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { data: { values } };
          },
          batchGet: async ({ ranges }: { ranges: string[] }) => ({
            data: {
              valueRanges: ranges.map((range) => ({ values: mockCopyOf(mockTabOf(range)) })),
            },
          }),
        },
        batchUpdate: async ({
          requestBody,
        }: {
          requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest;
        }) => {
          const requests = requestBody.requests ?? [];
          const duplicate = requests[0].duplicateSheet;
          if (duplicate) {
            const name = duplicate.newSheetName ?? '';
            mockSheet.duplicatedFrom.push(duplicate.sourceSheetId ?? -1);
            mockSheet.tabs.splice(duplicate.insertSheetIndex ?? 0, 0, name);
            mockSheet.grids.set(name, mockCopyOf('template'));
            const sheetId = mockSheetId(name);
            return { data: { replies: [{ duplicateSheet: { properties: { sheetId } } }] } };
          }
          // Atomic like the real call: a rejected request leaves the tab untouched.
          if (requests.some(mockSheet.rejects)) throw new Error('rejected');

          const sheetId = requests[0].updateCells?.range?.sheetId ?? -1;
          const tab = mockSheet.tabs.find((title) => mockSheetId(title) === sheetId) ?? '';
          const grid = mockSheet.grids.get(tab) as unknown[][];
          for (const request of requests) {
            const source = request.copyPaste?.source;
            const target = (request.updateCells?.range ?? request.copyPaste?.destination) as {
              startRowIndex: number;
              startColumnIndex: number;
            };
            const cells = (grid[target.startRowIndex] ??= []);
            cells[target.startColumnIndex] = source
              ? grid[source.startRowIndex ?? -1]?.[source.startColumnIndex ?? -1]
              : mockEntered(request);
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
const gridOf = (tab: string) => mockSheet.grids.get(tab) as unknown[][];

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
      grids: new Map([['noviembre 26', sideLayout('Expensas')]]),
      computed: new Map(),
      rejects: (request: sheets_v4.Schema$Request) => mockEntered(request) === 'boom',
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
    expect(gridOf('noviembre 26').map((cells) => cells[1])).toEqual([
      undefined,
      'Gasto',
      'Expensas',
      'A',
      'C',
    ]);
  });

  it('writes under the headers of a tab laid out differently, dating the row', async () => {
    mockSheet.grids.set('noviembre 26', topLayout('Expensas'));

    await expect(writeExpenseRow(expense('A'))).resolves.toEqual({ tab: 'noviembre 26', row: 7 });
    expect(gridOf('noviembre 26')[6]).toEqual([
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
    mockSheet.tabs = ['enero 24', 'template', 'mari'];
    mockSheet.grids.set('template', sideLayout('Expensas'));
    const templateId = mockSheetId('template');

    const rows = await Promise.all([writeExpenseRow(expense('A')), writeExpenseRow(expense('B'))]);

    expect(rows).toEqual([
      { tab: 'noviembre 26', row: 4 },
      { tab: 'noviembre 26', row: 5 },
    ]);
    expect(mockSheet.tabs).toEqual(['enero 24', 'noviembre 26', 'template', 'mari']);
    const monthId = mockSheetId('noviembre 26');
    expect(mockSheet.duplicatedFrom).toEqual([templateId]);
    expect(mockSheet.writtenTo).toEqual([monthId, monthId]);
    expect(monthId).not.toBe(templateId);
  });

  it('writes nothing without a tab or template, the headers, or the ARS formula', async () => {
    mockSheet.tabs = ['mari'];
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('ni la plantilla');

    mockSheet.tabs = ['noviembre 26'];
    mockSheet.grids.set('noviembre 26', [[], ['', 'Gasto', 'Monto']]);
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('fila de encabezados');

    mockSheet.grids.set('noviembre 26', sideLayout());
    await expect(writeExpenseRow(expense('A'))).rejects.toThrow('fórmula de ARS');

    expect(mockSheet.writtenTo).toEqual([]);
  });

  describe('exchange rate of earlier months', () => {
    it('is fixed at its current value in every month still live, wherever the cell is', async () => {
      const december = new Date('2026-12-01T09:00:00-03:00');
      mockSheet.tabs = ['octubre 26', 'noviembre 26', 'diciembre 26'];
      // Above October's real rate cell (L18) sits an expense titled like the label, in a
      // column order that puts its amount where a rate would be.
      const [gasto, moneda, monto, ...rest] = HEADERS;
      const october = [[], ['', gasto, monto, moneda, ...rest], ['', 'Cambio Dólares', 100, 'ARS']];
      mockSheet.grids.set('octubre 26', withRate(october, 17, 10, LIVE_RATE));
      mockSheet.grids.set('noviembre 26', withRate(topLayout('Expensas'), 3, 0, LIVE_RATE));
      mockSheet.grids.set('diciembre 26', sideLayout('Expensas'));
      mockSheet.computed.set("'octubre 26'!L18", 1500).set("'noviembre 26'!B4", 1550.25);

      await expect(writeExpenseRow(expense('A', december))).resolves.toEqual({
        tab: 'diciembre 26',
        row: 4,
        frozenRates: [
          { tab: 'noviembre 26', rate: 1550.25 },
          { tab: 'octubre 26', rate: 1500 },
        ],
      });
      expect(gridOf('octubre 26')[17][11]).toBe(1500);
      expect(gridOf('noviembre 26')[3][1]).toBe(1550.25);
      expect(gridOf('octubre 26')[2][2]).toBe(100);

      // Now that both are plain numbers, the next write leaves them alone.
      await expect(writeExpenseRow(expense('B', december))).resolves.toEqual({
        tab: 'diciembre 26',
        row: 5,
      });
      expect(mockSheet.writtenTo.filter((id) => id !== mockSheetId('diciembre 26'))).toHaveLength(
        2,
      );
    });

    it('stays live, without failing the expense, until it can be read and written', async () => {
      const january = new Date('2027-01-02T09:00:00-03:00');
      mockSheet.tabs = ['diciembre 26', 'enero 27'];
      mockSheet.grids.set('diciembre 26', withRate(sideLayout('Expensas'), 17, 10, LIVE_RATE));
      mockSheet.grids.set('enero 27', sideLayout('Expensas'));
      const unfixed = { frozenRates: [{ tab: 'diciembre 26', rate: null }] };

      // No quote yet: the formula computes to an error.
      await expect(writeExpenseRow(expense('A', january))).resolves.toEqual({
        tab: 'enero 27',
        row: 4,
        ...unfixed,
      });

      // A quote, but the API refuses to store it.
      mockSheet.computed.set("'diciembre 26'!L18", 1600);
      mockSheet.rejects = (request) => mockEntered(request) === 1600;
      await expect(writeExpenseRow(expense('B', january))).resolves.toEqual({
        tab: 'enero 27',
        row: 5,
        ...unfixed,
      });
      expect(gridOf('diciembre 26')[17][11]).toBe(LIVE_RATE);

      mockSheet.rejects = () => false;
      const retried = await writeExpenseRow(expense('C', january));
      expect(retried.frozenRates).toEqual([{ tab: 'diciembre 26', rate: 1600 }]);
    });
  });
});
