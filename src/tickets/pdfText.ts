import { PDFParse } from "pdf-parse";

/** Extracts plain text from a PDF buffer (e.g. a downloaded e-ticket attachment). */
export async function extractPdfText(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
