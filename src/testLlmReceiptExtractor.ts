import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { extractReceiptDataFromImage } from './llmReceiptExtractor';

async function main() {
  // Path to a sample image (replace with your own test image path)
  const imagePath = path.resolve(__dirname, '../test-receipt.jpg');
  console.log('Using image:', imagePath);
  const mimeType = 'image/jpeg';
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  try {
    const result = await extractReceiptDataFromImage(base64Image, mimeType);
    console.log('✅ LLM extracted receipt data:', result);
  } catch (err) {
    console.error('❌ LLM extraction failed:', err);
  }
}

main(); 