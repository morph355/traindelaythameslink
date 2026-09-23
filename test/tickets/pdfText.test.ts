import { describe, expect, it } from "vitest";
import { extractPdfText } from "../../src/tickets/pdfText.js";

// A minimal hand-written single-page PDF containing the text "Hello World".
const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 10 100 Td (Hello World) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF
`;

describe("extractPdfText", () => {
  it("extracts text content from a PDF buffer", async () => {
    const text = await extractPdfText(Buffer.from(MINIMAL_PDF));
    expect(text).toContain("Hello World");
  });
});
