export type PdfPageText = {
  pageNumber: number;
  text: string;
};

export type PdfTextResult = {
  text: string;
  pages: PdfPageText[];
  total: number;
};

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = (result.pages ?? []).map((page, index) => ({
      pageNumber: typeof page.num === "number" ? page.num : index + 1,
      text: page.text ?? "",
    }));
    return {
      text: result.text ?? "",
      pages,
      total: typeof result.total === "number" ? result.total : pages.length,
    };
  } finally {
    await parser.destroy();
  }
}
