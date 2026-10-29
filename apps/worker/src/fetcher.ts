import { config } from "./config";

export interface FetchResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  buffer: Buffer;
  contentType: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  userAgent?: string;
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(h: string | undefined): number | null {
  if (!h) return null;
  const n = Number(h);
  if (!Number.isNaN(n)) return n * 1000;
  const date = Date.parse(h);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  const userAgent = opts.userAgent ?? config.userAgent;
  const maxRetries = opts.retries ?? 3;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": userAgent, Accept: "*/*" },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      const buf = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      if (res.status >= 500 || res.status === 429) {
        if (attempt < maxRetries && res.status !== 401 && res.status !== 403 && res.status !== 404) {
          const ra = parseRetryAfter(headers["retry-after"]);
          const backoff = ra ?? Math.min(30000, 1000 * Math.pow(2, attempt));
          await sleep(backoff);
          attempt++;
          continue;
        }
      }
      // don't retry client errors
      return {
        url: res.url || url,
        status: res.status,
        headers,
        buffer: buf,
        contentType: headers["content-type"] || "",
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(Math.min(30000, 1000 * Math.pow(2, attempt)));
        attempt++;
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
