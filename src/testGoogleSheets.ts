import 'dotenv/config';
import { writeExpenseRow } from './googleSheets';

async function main() {
  try {
    await writeExpenseRow([
      'Test Gasto', // Gasto
      'ARS',        // Moneda
      '12345',      // Monto
      '12345',      // ARS (repeat for test)
      'alejo',      // Paga
      '🏡',          // Tipo de Gasto
      'Test from script', // Comments
    ]);
    console.log('✅ Successfully wrote test row to Google Sheets!');
  } catch (err) {
    console.error('❌ Failed to write row:', err);
  }
}

main(); 