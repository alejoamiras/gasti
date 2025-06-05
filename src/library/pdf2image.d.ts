declare module 'pdf2image' {
  export class PDFDocument {
    static convert(
      pdfBuffer: Buffer,
      options?: {
        density?: number;
        format?: 'jpeg' | 'png';
        quality?: number;
      },
    ): Promise<Buffer[]>;
  }
}
