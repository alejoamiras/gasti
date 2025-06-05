import fs from 'fs';
import path from 'path';
import { extractReceiptDataFromImage } from './llm';

describe('extractReceiptDataFromImage', () => {
  it.skip('should extract receipt data from a sample image (requires real API key and image)', async () => {
    const imagePath = path.resolve(__dirname, '../test-receipt.jpg');
    const mimeType = 'image/jpeg';
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const result = await extractReceiptDataFromImage(base64Image, mimeType);
    expect(result).toHaveProperty('description');
    expect(result).toHaveProperty('amount');
    expect(result).toHaveProperty('category');
    expect(result).toHaveProperty('comments');
  });
});
