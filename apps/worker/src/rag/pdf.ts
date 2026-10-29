import * as mupdf from "mupdf";

export interface RagPage {
  pageNumber: number;
  text: string;
  imagePng?: Buffer;
}

export interface RagPdf {
  pageCount: number;
  pages: RagPage[];
}

export interface LoadPdfOptions {
  renderImages?: boolean;
  scale?: number;
}

export function isPdfBuffer(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

export async function loadPdf(bytes: Buffer, opts: LoadPdfOptions = {}): Promise<RagPdf> {
  if (!isPdfBuffer(bytes)) throw new Error("not a PDF file (missing %PDF- header)");

  const renderImages = opts.renderImages !== false;
  const scale = opts.scale ?? 1.4;

  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pageCount = doc.countPages();
  const pages: RagPage[] = [];

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    let text = "";
    try {
      text = page.toStructuredText("preserve-whitespace").asText();
    } catch {
      text = "";
    }

    let imagePng: Buffer | undefined;
    if (renderImages) {
      try {
        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          false,
          true,
        );
        imagePng = Buffer.from(pixmap.asPNG());
      } catch {
        imagePng = undefined;
      }
    }

    pages.push({ pageNumber: i + 1, text, imagePng });
  }

  return { pageCount, pages };
}

export async function fetchPdfBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isPdfBuffer(buf)) throw new Error(`downloaded file is not a PDF: ${url}`);
  return buf;
}

export function pdfTitleFromBytes(bytes: Buffer, fallback: string): string {
  try {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const meta = doc.getMetaData("info") as unknown as Record<string, unknown> | undefined;
    const title = meta?.title;
    if (typeof title === "string" && title.trim()) return title.trim();
  } catch {
    // ignore metadata failures
  }
  return fallback;
}
