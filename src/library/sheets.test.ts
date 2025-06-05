import 'dotenv/config';
import { writeExpenseRow } from './sheets';

describe('writeExpenseRow', () => {
  it.skip('should write a test row to Google Sheets (requires real credentials)', async () => {
    await writeExpenseRow([
      'Test Gasto', // Gasto
      'ARS', // Moneda
      '12345', // Monto
      '12345', // ARS (repeat for test)
      'alejo', // Paga
      '🏡', // Tipo de Gasto
      'Test from script', // Comments
    ]);
    // If no error is thrown, the test passes
  });
});
