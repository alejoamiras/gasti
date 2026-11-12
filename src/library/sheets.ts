import { google, sheets_v4 } from 'googleapis';
import logger from './logger.js';
import type { Logger } from 'pino';

const MONTHS_IN_SPANISH = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const TIME_ZONE = 'America/Argentina/Buenos_Aires';
const TEMPLATE_TAB = 'template';
// Label of the cell to the left of a tab's USD→ARS rate.
const RATE_LABEL = 'Cambio Dólares';

// Header text of each expense column. The expense table is found by these names, not by
// position, so a tab may place it anywhere.
const HEADERS = {
  title: 'Gasto',
  currency: 'Moneda',
  amount: 'Monto',
  ars: 'ARS',
  payer: 'Paga',
  category: 'Categoría',
  type: 'Tipo',
  comments: 'Comments',
} as const;
// Optional: tabs created before the column existed don't have it.
const DATE_HEADER = 'Fecha';

type Field = keyof typeof HEADERS;

export interface TabLayout {
  /** 1-based row of the first expense. */
  firstDataRow: number;
  /** Zero-based column of each field; `date` is absent on tabs without a Fecha column. */
  cols: Record<Field, number> & { date?: number };
}

export interface ExpenseRow {
  title: string;
  amount: number;
  payer: string;
  category: string;
  description: string;
  /** When the expense was sent. Its day in Argentina fills Fecha and picks the month tab. */
  date: Date;
}

export interface WrittenRow {
  tab: string;
  row: number;
  /**
   * Earlier months whose exchange rate this write found still live: the value each was
   * fixed at, or null when fixing it failed.
   */
  frozenRates?: FrozenRate[];
}

export interface FrozenRate {
  tab: string;
  rate: number | null;
}

interface SheetsConfig {
  credentials: object;
  spreadsheetId: string;
}

let config: SheetsConfig | undefined;
let client: sheets_v4.Sheets | undefined;

/** Reads and validates the Sheets env vars; throws if any is missing. */
export function loadSheetsConfig(): SheetsConfig {
  if (config) return config;
  const encoded = process.env.BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!encoded) {
    throw new Error(
      'BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS is not set in environment variables.',
    );
  }
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is not set in environment variables.');
  }
  const credentials = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  config = { credentials, spreadsheetId };
  return config;
}

function getSheetsClient(): sheets_v4.Sheets {
  if (client) return client;
  const auth = new google.auth.GoogleAuth({
    credentials: loadSheetsConfig().credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

/** Calendar day of an instant in Argentina; `month` is 1-12. */
function argentinaDay(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/**
 * Month tabs are named "<mes> <yy>" in Argentina time, e.g. "octubre 26". `monthsBack`
 * names an earlier month's tab instead.
 */
export function monthTabName(date: Date = new Date(), monthsBack = 0): string {
  const { year, month } = argentinaDay(date);
  const index = year * 12 + (month - 1) - monthsBack;
  return `${MONTHS_IN_SPANISH[index % 12]} ${String(Math.floor(index / 12)).slice(-2)}`;
}

/** Google Sheets serial number (days since 1899-12-30) of an instant's day in Argentina. */
export function sheetDateSerial(date: Date): number {
  const { year, month, day } = argentinaDay(date);
  return Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
}

/**
 * Locates the expense table in a tab's cells: the first row holding every required header
 * is the header row, and expenses start right under it.
 */
export function findLayout(grid: unknown[][]): TabLayout | null {
  for (const [index, row] of grid.entries()) {
    const column = (header: string) =>
      row.findIndex((cell) => typeof cell === 'string' && cell.trim() === header);
    const cols = Object.fromEntries(
      Object.entries(HEADERS).map(([field, header]) => [field, column(header)]),
    ) as Record<Field, number>;
    if (Object.values(cols).includes(-1)) continue;
    const date = column(DATE_HEADER);
    return { firstDataRow: index + 2, cols: date === -1 ? cols : { ...cols, date } };
  }
  return null;
}

/** 1-based row of the first expense row whose Gasto cell is empty. */
export function firstEmptyRow(grid: unknown[][], layout: TabLayout): number {
  let row = layout.firstDataRow;
  while (row <= grid.length) {
    const cell = grid[row - 1]?.[layout.cols.title];
    if (cell === undefined || cell === '') break;
    row += 1;
  }
  return row;
}

/**
 * Requests that fill one expense row, applied in a single atomic batchUpdate so a failure
 * never leaves a half-written row. updateCells skips the sheet's strict dropdowns, so
 * callers must pass values the dropdowns allow.
 */
export function buildRowRequests(
  sheetId: number,
  row: number,
  layout: TabLayout,
  expense: ExpenseRow,
): sheets_v4.Schema$Request[] {
  const { cols } = layout;
  const cell = (rowNumber: number, col: number) => ({
    sheetId,
    startRowIndex: rowNumber - 1,
    endRowIndex: rowNumber,
    startColumnIndex: col,
    endColumnIndex: col + 1,
  });
  // stringValue is stored verbatim, so text from the model can never become a formula.
  const text = (value: string) => ({ userEnteredValue: { stringValue: value } });
  const write = (
    col: number,
    data: sheets_v4.Schema$CellData,
    fields = 'userEnteredValue',
  ): sheets_v4.Schema$Request => ({
    updateCells: { range: cell(row, col), rows: [{ values: [data] }], fields },
  });

  const requests = [
    write(cols.title, text(expense.title)),
    write(cols.currency, text('ARS')),
    write(cols.amount, { userEnteredValue: { numberValue: expense.amount } }),
    {
      // The ARS column holds the USD conversion formula, which not every row has
      // pre-filled; copying it keeps the sheet's own formula and locale.
      copyPaste: {
        source: cell(layout.firstDataRow, cols.ars),
        destination: cell(row, cols.ars),
        pasteType: 'PASTE_FORMULA',
      },
    },
    write(cols.payer, text(expense.payer)),
    write(cols.category, text(expense.category)),
    write(cols.type, text('variable')),
    write(cols.comments, text(expense.description)),
  ];
  if (cols.date !== undefined) {
    requests.push(
      write(
        cols.date,
        {
          // A real date, shown as dd/mm, so the column sorts and filters.
          userEnteredValue: { numberValue: sheetDateSerial(expense.date) },
          userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm' } },
        },
        'userEnteredValue,userEnteredFormat.numberFormat',
      ),
    );
  }
  return requests;
}

type Tabs = Map<string, { sheetId: number; index: number }>;

async function listTabs(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Tabs> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title,index)',
  });
  const tabs: Tabs = new Map();
  for (const { properties } of meta.data.sheets ?? []) {
    if (properties?.title != null && properties.sheetId != null) {
      tabs.set(properties.title, { sheetId: properties.sheetId, index: properties.index ?? 0 });
    }
  }
  return tabs;
}

/** Duplicates the template into a new month tab and returns its id. */
async function createMonthTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: Tabs,
  tab: string,
  log: Logger,
): Promise<number> {
  const template = tabs.get(TEMPLATE_TAB);
  if (!template) {
    throw new Error(`No existe la pestaña "${tab}" ni la plantilla "${TEMPLATE_TAB}"`);
  }
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: template.sheetId,
            // Inserted immediately before the template.
            insertSheetIndex: template.index,
            newSheetName: tab,
          },
        },
      ],
    },
  });
  const created = res.data.replies?.[0]?.duplicateSheet?.properties?.sheetId;
  if (created == null) {
    throw new Error(`No se pudo crear la pestaña "${tab}" desde "${TEMPLATE_TAB}"`);
  }
  log.info({ tab }, '🗓️ Created month tab from the template');
  return created;
}

// Every write rechecks this many earlier months, so one whose freeze failed, or whose
// following month had no expenses, is still fixed later.
const FREEZE_LOOKBACK_MONTHS = 12;

/**
 * Zero-based position and FORMULA-rendered value of a tab's exchange rate: the cell right of
 * the rate label. Cells of the expense table are never the label, since an expense's title
 * or comment may read like it.
 */
function findRateCell(grid: unknown[][]): { row: number; col: number; value: unknown } | null {
  const layout = findLayout(grid);
  const expenseCols = new Set(layout ? Object.values(layout.cols) : []);
  for (const [row, cells] of grid.entries()) {
    for (const [index, cell] of cells.entries()) {
      if (typeof cell !== 'string' || cell.trim() !== RATE_LABEL) continue;
      if (layout && row >= layout.firstDataRow - 1 && expenseCols.has(index)) continue;
      return { row, col: index + 1, value: cells[index + 1] };
    }
  }
  return null;
}

/**
 * Replaces the live exchange-rate formula of the months before `date` with its current
 * value, so a closed month's totals stop moving with the market. Never throws: it runs
 * after the expense is written. A month it could not fix is reported, and the next write
 * tries again.
 */
async function freezeEarlierRates(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: Tabs,
  date: Date,
  log: Logger,
): Promise<FrozenRate[]> {
  const earlier = Array.from({ length: FREEZE_LOOKBACK_MONTHS }, (_, i) =>
    monthTabName(date, i + 1),
  ).filter((tab) => tabs.has(tab));
  if (earlier.length === 0) return [];

  let grids: unknown[][][];
  try {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: earlier.map((tab) => `'${tab}'!A1:Z`),
      valueRenderOption: 'FORMULA',
    });
    // The API returns the ranges in the order they were requested.
    grids = earlier.map((_, i) => res.data.valueRanges?.[i]?.values ?? []);
  } catch (err) {
    log.warn({ err }, '⚠️ Could not read earlier months to freeze their exchange rate');
    return [];
  }

  const frozen: FrozenRate[] = [];
  for (const [i, tab] of earlier.entries()) {
    try {
      const cell = findRateCell(grids[i]);
      if (!cell) throw new Error(`"${tab}" no tiene la celda "${RATE_LABEL}"`);
      if (typeof cell.value === 'number') continue;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'!${String.fromCharCode(65 + cell.col)}${cell.row + 1}`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const rate = res.data.values?.[0]?.[0];
      // GOOGLEFINANCE yields an error value while it has no quote.
      if (typeof rate !== 'number' || !(rate > 0)) {
        throw new Error(`El cambio de "${tab}" no es un número`);
      }
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateCells: {
                range: {
                  sheetId: tabs.get(tab)?.sheetId,
                  startRowIndex: cell.row,
                  endRowIndex: cell.row + 1,
                  startColumnIndex: cell.col,
                  endColumnIndex: cell.col + 1,
                },
                rows: [{ values: [{ userEnteredValue: { numberValue: rate } }] }],
                fields: 'userEnteredValue',
              },
            },
          ],
        },
      });
      log.info({ tab, rate }, '🔒 Froze the exchange rate of a closed month');
      frozen.push({ tab, rate });
    } catch (err) {
      log.warn({ err, tab }, '⚠️ Could not freeze the exchange rate');
      frozen.push({ tab, rate: null });
    }
  }
  return frozen;
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Runs writes one at a time: concurrent messages would otherwise claim the same empty row. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

/**
 * Appends the expense to its month's tab, creating the tab from the template on the
 * month's first expense, then fixes the exchange rate of earlier months that is still live.
 */
export function writeExpenseRow(expense: ExpenseRow, instanceLogger?: Logger): Promise<WrittenRow> {
  const log = instanceLogger || logger;
  return serialized(async () => {
    const sheets = getSheetsClient();
    const { spreadsheetId } = loadSheetsConfig();
    const tab = monthTabName(expense.date);

    let tabs: Tabs;
    let row: number;
    try {
      tabs = await listTabs(sheets, spreadsheetId);
      const sheetId =
        tabs.get(tab)?.sheetId ?? (await createMonthTab(sheets, spreadsheetId, tabs, tab, log));

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'!A1:Z`,
        valueRenderOption: 'FORMULA',
      });
      const grid = res.data.values ?? [];
      const layout = findLayout(grid);
      if (!layout) {
        throw new Error(
          `"${tab}" no tiene la fila de encabezados (${Object.values(HEADERS).join(', ')})`,
        );
      }
      if (!String(grid[layout.firstDataRow - 1]?.[layout.cols.ars] ?? '').startsWith('=')) {
        throw new Error(
          `La primera fila de gastos de "${tab}" no tiene la fórmula de ARS para copiar`,
        );
      }
      row = firstEmptyRow(grid, layout);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: buildRowRequests(sheetId, row, layout, expense) },
      });
      log.info({ expense, tab, row }, '📊 Expense row written to Google Sheets');
    } catch (err) {
      log.error({ err, expense, tab }, '❌ Failed to write expense row to Google Sheets');
      throw err;
    }

    const frozenRates = await freezeEarlierRates(sheets, spreadsheetId, tabs, expense.date, log);
    return { tab, row, ...(frozenRates.length > 0 && { frozenRates }) };
  });
}
