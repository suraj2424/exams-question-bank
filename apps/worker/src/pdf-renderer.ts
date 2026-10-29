import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

export interface RenderedPage {
  pageNumber: number;
  imageBuffer: Buffer | null;
  width: number;
  height: number;
  renderError?: string;
}

let createCanvas: any = null;
try {
  const canvasMod = require("canvas");
  createCanvas = canvasMod.createCanvas || canvasMod.default;
} catch {
  createCanvas = null;
}

let workerSrcSet = false;

function ensureWorker(): void {
  if (workerSrcSet) return;
  try {
    GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/build/pdf.worker.mjs");
  } catch {
    try {
      GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;
    } catch {
      // worker src not set; pdfjs-dist will fall back
    }
  }
  workerSrcSet = true;
}

export async function renderPdfPages(pdfBuffer: Buffer): Promise<RenderedPage[]> {
  ensureWorker();
  const loadingTask = getDocument({ data: pdfBuffer });
  let pdf: any;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    return [{ pageNumber: -1, imageBuffer: null, width: 0, height: 0, renderError: err instanceof Error ? err.message : String(err) }];
  }

  const pages: RenderedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const result: RenderedPage = { pageNumber: i, imageBuffer: null, width: 0, height: 0 };
    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      result.width = viewport.width;
      result.height = viewport.height;

      if (!createCanvas) {
        result.renderError = "canvas module not available; cannot render PDF page to image";
        pages.push(result);
        continue;
      }

      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      const renderContext = { canvasContext: ctx, viewport };
      await page.render(renderContext).promise;

      const buf = canvas.toBuffer("image/png");
      result.imageBuffer = buf;
    } catch (err) {
      result.renderError = err instanceof Error ? err.message : String(err);
    }
    pages.push(result);
  }

  try {
    await loadingTask.destroy();
  } catch {
    // ignore destroy errors
  }

  return pages;
}

export function isRenderingAvailable(): boolean {
  return createCanvas !== null;
}
