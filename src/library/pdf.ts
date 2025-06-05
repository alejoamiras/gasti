import logger from './logger.js';

export interface ConvertedImage {
  base64Image: string;
  mimeType: string;
}

export async function convertPdfToImages(pdfBuffer: Buffer): Promise<ConvertedImage> {
  try {
    // Dynamically import pdf-to-img
    const { pdf } = await import('pdf-to-img');
    // pdf-to-img expects Uint8Array, so convert Buffer to Uint8Array
    const uint8Array = new Uint8Array(pdfBuffer);
    const doc = await pdf(uint8Array, { scale: 2 });
    const imageBuffer = await doc.getPage(1); // Get first page as Buffer
    logger.info('Successfully converted PDF to image');
    return {
      base64Image: imageBuffer.toString('base64'),
      mimeType: 'image/png',
    };
  } catch (err) {
    logger.error({ err }, 'Failed to convert PDF to image');
    throw new Error(`Failed to convert PDF to image: ${err}`);
  }
} 