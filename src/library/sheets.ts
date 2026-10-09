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
const FIRST_DATA_ROW = 3;

// Zero-based column indexes of a month tab: B Gasto, C Moneda, D Monto, E ARS,
// F Paga, G Categoría, H Tipo, I Comments.
const COL = { title: 1, amount: 3, ars: 4, payer: 5, comments: 8 } as const;

export interface ExpenseRow {
  title: string;
  amount: number;
  payer: string;
  category: string;
  description: string;
}

export interface WrittenRow {
  tab: string;
  row: number;
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

/** Month tabs are named "<mes> <yy>" in Argentina time, e.g. "octubre 26". */
export function monthTabName(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'numeric',
    year: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${MONTHS_IN_SPANISH[Number(part('month')) - 1]} ${part('year')}`;
}

/** 1-based row of the first empty Gasto cell, given column B read from FIRST_DATA_ROW down. */
export function firstEmptyRow(columnB: string[][]): number {
  const index = columnB.findIndex((cells) => !cells[0]);
  return FIRST_DATA_ROW + (index === -1 ? columnB.length : index);
}

/**
 * Requests that fill one expense row, applied in a single atomic batchUpdate so a failure
 * never leaves a half-written row. updateCells skips the sheet's strict dropdowns, so
 * callers must pass values the dropdowns allow.
 */
export function buildRowRequests(
  sheetId: number,
  row: number,
  expense: ExpenseRow,
): sheets_v4.Schema$Request[] {
  const rowIndex = row - 1;
  const range = (start: number, end: number) => ({
    sheetId,
    startRowIndex: rowIndex,
    endRowIndex: rowIndex + 1,
    startColumnIndex: start,
    endColumnIndex: end,
  });
  // stringValue is stored verbatim, so text from the model can never become a formula.
  const text = (value: string) => ({ userEnteredValue: { stringValue: value } });

  return [
    {
      updateCells: {
        range: range(COL.title, COL.amount + 1),
        rows: [
          {
            values: [
              text(expense.title),
              text('ARS'),
              { userEnteredValue: { numberValue: expense.amount } },
            ],
          },
        ],
        fields: 'userEnteredValue',
      },
    },
    {
      // The ARS column holds the USD conversion formula, which not every row has
      // pre-filled; copying it keeps the sheet's own formula and locale.
      copyPaste: {
        source: {
          sheetId,
          startRowIndex: FIRST_DATA_ROW - 1,
          endRowIndex: FIRST_DATA_ROW,
          startColumnIndex: COL.ars,
          endColumnIndex: COL.ars + 1,
        },
        destination: range(COL.ars, COL.ars + 1),
        pasteType: 'PASTE_FORMULA',
      },
    },
    {
      updateCells: {
        range: range(COL.payer, COL.comments + 1),
        rows: [
          {
            values: [
              text(expense.payer),
              text(expense.category),
              text('variable'),
              text(expense.description),
            ],
          },
        ],
        fields: 'userEnteredValue',
      },
    },
  ];
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Runs writes one at a time: concurrent messages would otherwise claim the same empty row. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

export function writeExpenseRow(expense: ExpenseRow, instanceLogger?: Logger): Promise<WrittenRow> {
  const log = instanceLogger || logger;
  return serialized(async () => {
    const sheets = getSheetsClient();
    const { spreadsheetId } = loadSheetsConfig();
    const tab = monthTabName();

    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)',
      });
      const sheetId = meta.data.sheets?.find((s) => s.properties?.title === tab)?.properties
        ?.sheetId;
      if (sheetId == null) {
        throw new Error(`No existe la pestaña "${tab}" en la planilla`);
      }

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'!B${FIRST_DATA_ROW}:B`,
      });
      const row = firstEmptyRow(res.data.values || []);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: buildRowRequests(sheetId, row, expense) },
      });
      log.info({ expense, tab, row }, '📊 Expense row written to Google Sheets');
      return { tab, row };
    } catch (err) {
      log.error({ err, expense, tab }, '❌ Failed to write expense row to Google Sheets');
      throw err;
    }
  });
}
