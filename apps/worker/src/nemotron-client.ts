const DEFAULT_URL = "https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-parse/parse";

export interface NemotronParseOptions {
  decoding?: { max_output_tokens?: number };
}

export interface NemotronPageResult {
  pageNumber: number;
  content: any;
  rawJson: any;
  success: boolean;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class NemotronParseClient {
  private apiKey: string;
  private baseUrl: string;
  private minDelayMs: number;
  private lastRequestTime: number = 0;

  constructor(apiKey: string, baseUrl?: string, minDelayMs: number = 1500) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || DEFAULT_URL;
    this.minDelayMs = minDelayMs;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minDelayMs) {
      await sleep(this.minDelayMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  async parsePage(
    imageBuffer: Buffer,
    filename: string,
    pageNumber: number,
    opts: NemotronParseOptions = {},
  ): Promise<NemotronPageResult> {
    await this.throttle();

    const form = new FormData();
    const slice = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.length) as ArrayBuffer;
    form.append("document", new Blob([slice], { type: "image/png" }), filename);
    form.append(
      "options",
      new Blob(
        [JSON.stringify({ decoding: { max_output_tokens: 1024, ...opts.decoding } })],
        { type: "application/json" },
      ),
    );

    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
          body: form as unknown as BodyInit,
        } as any);

        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5000 * (attempt + 1);
          await sleep(waitMs);
          continue;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { pageNumber, content: null, rawJson: null, success: false, error: `${response.status}: ${text}` };
        }

        const json = await response.json();
        return { pageNumber, content: json.content, rawJson: json, success: true };
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        return {
          pageNumber,
          content: null,
          rawJson: null,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return { pageNumber, content: null, rawJson: null, success: false, error: "max retries exceeded" };
  }

  async parsePages(
    pages: Array<{ pageNumber: number; imageBuffer: Buffer; filename: string }>,
    opts: NemotronParseOptions = {},
  ): Promise<NemotronPageResult[]> {
    const results: NemotronPageResult[] = [];
    for (const page of pages) {
      const r = await this.parsePage(page.imageBuffer, page.filename, page.pageNumber, opts);
      results.push(r);
    }
    return results;
  }
}

export function buildNemotronClient(apiKey?: string, baseUrl?: string, minDelayMs?: number): NemotronParseClient | null {
  const key = apiKey ?? process.env.NVIDIA_API_KEY;
  if (!key || key.trim() === "") return null;
  const delay = minDelayMs !== undefined ? minDelayMs : Number(process.env.NEMOTRON_RATE_LIMIT_DELAY_MS ?? "1500");
  return new NemotronParseClient(key, baseUrl ?? process.env.NEMOTRON_PARSE_URL, delay);
}
