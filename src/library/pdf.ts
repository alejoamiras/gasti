import logger from './logger.js';
import type { Logger } from 'pino';

export interface ConvertedImage {
  base64Image: string;
  mimeType: string;
}

export async function convertPdfToImages(
  pdfBuffer: Buffer,
  instanceLogger?: Logger,
): Promise<ConvertedImage> {
  const log = instanceLogger || logger; // Use instanceLogger if provided, fallback to default
  try {
    // Dynamically import pdf-to-img
    const { pdf } = await import('pdf-to-img');
    // pdf-to-img expects Uint8Array, so convert Buffer to Uint8Array
    const uint8Array = new Uint8Array(pdfBuffer);
    const doc = await pdf(Buffer.from(uint8Array), { scale: 2 });
    const imageBuffer = (await doc[Symbol.asyncIterator]().next()).value; // Get first page as Buffer
    if (!(imageBuffer instanceof Buffer)) {
      throw new Error('Failed to convert PDF to image: Invalid image buffer');
    }
    log.info('✅ Successfully converted PDF to image');
    return {
      base64Image: imageBuffer.toString('base64'),
      mimeType: 'image/png',
    };
  } catch (err) {
    log.error({ err }, '❌ Failed to convert PDF to image');
    throw new Error(`Failed to convert PDF to image: ${err}`);
  }
}
