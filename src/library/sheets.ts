import { google, sheets_v4 } from 'googleapis';
import logger from './logger.js';

const credentialsJson = Buffer.from(
  process.env.BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS as string,
  'base64',
).toString('utf-8');
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

if (!credentialsJson) {
  throw new Error('GOOGLE_SHEETS_CREDENTIALS_JSON is not set in environment variables.');
}
if (!spreadsheetId) {
  throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is not set in environment variables.');
}

const credentials = JSON.parse(credentialsJson);

function getSheetsClient(): sheets_v4.Sheets {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function writeExpenseRow(row: string[]) {
  const sheets = getSheetsClient();
  try {
    // 1. Read column B (Gasto) from the 'junio' tab
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'junio!B3:B',
    });
    const values = res.data.values || [];
    // 2. Find the first empty row, starting from row 3
    let firstEmptyRow = 3;
    for (let i = 0; i < values.length; i++) {
      if (!values[i][0]) {
        firstEmptyRow = i + 3; // +3 because values[0] is row 3
        break;
      }
      // If all rows are filled, next empty row is after the last
      if (i === values.length - 1) {
        firstEmptyRow = values.length + 3;
      }
    }
    // 3. Write B-D (Gasto, Moneda, Monto)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `junio!B${firstEmptyRow}:D${firstEmptyRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[row[0], row[1], row[2]]] },
    });
    // 4. Write F-H (Paga, Tipo de Gasto, Comments)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `junio!F${firstEmptyRow}:H${firstEmptyRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[row[4], row[5], row[6]]] },
    });
    logger.info({ row, firstEmptyRow }, 'Expense row written to Google Sheets');
  } catch (err) {
    logger.error({ err, row }, 'Failed to write expense row to Google Sheets');
    throw err;
  }
}
