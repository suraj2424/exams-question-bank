import { renderPdfPages, isRenderingAvailable } from "./pdf-renderer";
import { writeFileRelative } from "./storage";
import { NimClient } from "./nim-client";
import { prisma } from "@qb/db";

export interface MediaAssetInput {
  sourceDocumentId: string;
  questionSetId?: string;
  questionId?: string;
  pageNumber: number;
  imageBuffer: Buffer;
  kind: "page_image" | "figure" | "table" | "chart";
  description?: string;
  extractedData?: any;
  ocrText?: string;
  confidence?: number;
}

const FIGURE_DETECTION_PROMPT = `You are analyzing a page from an IBPS PO exam paper. Identify any figures, charts, graphs, tables, or diagrams on this page.

Return JSON ONLY:
{
  "hasFigure": boolean,
  "figures": [{
    "kind": "chart" | "table" | "graph" | "diagram",
    "description": string,
    "data": object | null,
    "bbox": [x, y, width, height] | null,
    "page": number
  }]
}

Rules:
1. Look for line graphs, bar charts, pie charts, tables with data, diagrams (seating, family tree, etc.).
2. For tables: extract headers and rows as structured data (array of objects).
3. For charts/graphs: describe axes, series, values if readable; extract data points if possible.
4. For diagrams: describe the structure (e.g., "two rows of 6 students facing each other").
5. bbox is optional - approximate pixel coordinates of the figure on the page.
6. If no figures, return { "hasFigure": false, "figures": [] }.
`;

export async function extractMediaFromDocument(
  client: NimClient,
  docId: string,
  pdfBuffer: Buffer,
  maxPages?: number
): Promise<MediaAssetInput[]> {
  if (!isRenderingAvailable()) {
    return [];
  }

  const pages = await renderPdfPages(pdfBuffer);
  const assets: MediaAssetInput[] = [];

  for (const page of pages.slice(0, maxPages)) {
    if (!page.imageBuffer || page.renderError) continue;

    const base64 = page.imageBuffer.toString("base64");
    const pageNum = page.pageNumber;

    const pageAsset: MediaAssetInput = {
      sourceDocumentId: docId,
      pageNumber: pageNum,
      imageBuffer: page.imageBuffer,
      kind: "page_image",
      confidence: 1.0,
    };
    assets.push(pageAsset);

    try {
      const result = await client.chatJson<{
        hasFigure: boolean;
        figures: Array<{
          kind: "chart" | "table" | "graph" | "diagram";
          description: string;
          data: any;
          bbox: number[] | null;
          page: number;
        }>;
      }>([
        { role: "system", content: FIGURE_DETECTION_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Analyze page ${pageNum} for figures, charts, tables, or diagrams.` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ], { maxTokens: 8192, responseFormat: { type: "json_object" }, enableThinking: false });

      if (result.hasFigure && result.figures) {
        for (const fig of result.figures) {
          if (fig.page !== pageNum) fig.page = pageNum;
          assets.push({
            sourceDocumentId: docId,
            pageNumber: pageNum,
            imageBuffer: page.imageBuffer,
            kind: fig.kind,
            description: fig.description,
            extractedData: fig.data,
            confidence: 0.8,
          });
        }
      }
    } catch (err) {
      console.warn(`Figure detection failed for page ${pageNum}:`, err);
    }
  }

  return assets;
}

export async function storeMediaAssets(assets: MediaAssetInput[]): Promise<string[]> {
  const paths: string[] = [];
  for (const asset of assets) {
    const sha = await import("./hash").then((m) => m.sha256Buffer(asset.imageBuffer));
    const ext = asset.mimeType?.includes("png") ? "png" : "jpg";
    const relative = `media/${asset.sourceDocumentId}/p${asset.pageNumber}-${asset.kind}-${sha.slice(0, 16)}.${ext}`;
    writeFileRelative(relative, asset.imageBuffer);
    paths.push(relative);
  }
  return paths;
}

export async function persistMediaAssets(
  assets: MediaAssetInput[],
  paperKey: string
): Promise<number> {
  let count = 0;
  for (const asset of assets) {
    const sha = await import("./hash").then((m) => m.sha256Buffer(asset.imageBuffer));
    const ext = "png";
    const relative = `media/${paperKey}/p${asset.pageNumber}-${asset.kind}-${sha.slice(0, 16)}.${ext}`;
    writeFileRelative(relative, asset.imageBuffer);

    await prisma.mediaAsset.create({
      data: {
        sourceDocumentId: asset.sourceDocumentId,
        questionSetId: asset.questionSetId,
        questionId: asset.questionId,
        kind: asset.kind,
        mimeType: `image/${ext}`,
        storagePath: relative,
        width: asset.imageBuffer ? undefined : undefined,
        height: undefined,
        description: asset.description,
        extractedData: asset.extractedData,
        ocrText: asset.ocrText,
        confidence: asset.confidence,
      },
    });
    count++;
  }
  return count;
}