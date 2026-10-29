import { prisma } from "@qb/db";
import { sha256Buffer } from "./hash";
import { storagePath, writeFileRelative } from "./storage";
import { fetchWithRetry } from "./fetcher";
import { parseRobots, isRobotsAllowed, robotsCrawlDelay } from "./robots";
import { crawlGate, SourceLike } from "./source-gate";
import { config } from "./config";

export interface CrawlOptions {
  maxPages?: number;
  delayMs?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface CrawlSummary {
  runId: string;
  pagesFetched: number;
  pdfsFound: number;
  errorCount: number;
  status: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

function isPdf(url: string, contentType: string): boolean {
  if (contentType.toLowerCase().includes("application/pdf")) return true;
  return /\.pdf(\?|$)/i.test(url);
}

function sameOriginAllowed(url: string, allowedDomains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedDomains.some((d) => {
      const dom = d.trim().toLowerCase();
      return host === dom || host.endsWith("." + dom);
    });
  } catch {
    return false;
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], baseUrl);
      if (u.protocol === "http:" || u.protocol === "https:") links.push(u.href);
    } catch {
      // ignore
    }
  }
  return links;
}

export async function runCrawl(sourceId: string, seedUrl: string, opts: CrawlOptions = {}): Promise<CrawlSummary> {
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  const gate = crawlGate(source as SourceLike, seedUrl);
  if (!gate.ok) throw new Error("Crawl not allowed: " + gate.reasons.join("; "));

  const allowedDomains = (source!.allowedDomains as string[]) || [];
  const userAgent = opts.userAgent || config.userAgent;
  const delayMs = opts.delayMs ?? config.delayMs;
  const maxPages = opts.maxPages ?? config.maxPages;
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;

  const run = await prisma.crawlRun.create({
    data: { sourceId, seedUrl, status: "running" },
  });

  const visited = new Set<string>();
  const queue: string[] = [canonicalize(seedUrl)];
  let pagesFetched = 0;
  let pdfsFound = 0;
  let errorCount = 0;
  const robotsCache = new Map<string, { text: string; fetched: boolean }>();

  async function getRobots(origin: string): Promise<ReturnType<typeof parseRobots> | null> {
    if (robotsCache.has(origin)) {
      const c = robotsCache.get(origin)!;
      if (!c.fetched) return null;
      return parseRobots(c.text);
    }
    try {
      const r = await fetchWithRetry(origin + "/robots.txt", { timeoutMs, userAgent, retries: 1 });
      const text = r.buffer.toString("utf8");
      robotsCache.set(origin, { text, fetched: true });
      return parseRobots(text);
    } catch {
      robotsCache.set(origin, { text: "", fetched: true });
      return parseRobots("");
    }
  }

  try {
    while (queue.length > 0 && pagesFetched < maxPages) {
      const url = queue.shift()!;
      const canonical = canonicalize(url);
      if (visited.has(canonical)) continue;
      visited.add(canonical);

      if (!sameOriginAllowed(canonical, allowedDomains)) continue;

      const origin = new URL(canonical).origin;
      const robots = await getRobots(origin);
      const path = new URL(canonical).pathname + new URL(canonical).search;
      if (robots && !isRobotsAllowed(robots, userAgent, path)) {
        await prisma.fetchedDocument.create({
          data: {
            sourceId,
            url: canonical,
            canonicalUrl: canonical,
            robotsAllowed: false,
            statusCode: 0,
            sha256: "",
            extractionStatus: "skipped",
          },
        }).catch(() => {});
        continue;
      }

      // delay
      if (delayMs > 0 && pagesFetched > 0) await sleep(delayMs);
      // robots crawl-delay override
      const rd = robots ? robotsCrawlDelay(robots, userAgent) : undefined;
      if (rd && rd > 0) await sleep(rd * 1000);

      let fetchResult;
      try {
        fetchResult = await fetchWithRetry(canonical, { timeoutMs, userAgent });
      } catch (err) {
        errorCount++;
        await prisma.crawlRun.update({ where: { id: run.id }, data: { errorCount } }).catch(() => {});
        continue;
      }

      if (fetchResult.status < 200 || fetchResult.status >= 400) {
        errorCount++;
        continue;
      }

      const sha = sha256Buffer(fetchResult.buffer);
      const pdf = isPdf(canonical, fetchResult.contentType);

      // dedup check
      const existing = await prisma.fetchedDocument.findFirst({
        where: { sourceId, canonicalUrl: canonical, sha256: sha },
      });
      if (existing) {
        pagesFetched++;
        if (pdf) pdfsFound++;
        // still enqueue links if html
        if (!pdf) {
          const html = fetchResult.buffer.toString("utf8");
          for (const l of extractLinks(html, canonical)) {
            const c2 = canonicalize(l);
            if (!visited.has(c2) && sameOriginAllowed(c2, allowedDomains)) queue.push(c2);
          }
        }
        continue;
      }

      // store
      const ext = pdf ? "pdf" : "html";
      const relativePath = `raw/${sha}.${ext}`;
      writeFileRelative(relativePath, fetchResult.buffer);

      let title: string | undefined;
      if (!pdf) {
        const html = fetchResult.buffer.toString("utf8");
        const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        title = m ? m[1].trim() : undefined;
      }

      await prisma.fetchedDocument.create({
        data: {
          sourceId,
          url: canonical,
          canonicalUrl: canonical,
          title: title ?? null,
          contentType: fetchResult.contentType,
          statusCode: fetchResult.status,
          sha256: sha,
          storagePath: relativePath,
          robotsAllowed: true,
          isPdf: pdf,
          ingestAllowedAtFetch: source!.allowedToIngestText,
          extractionStatus: "pending",
        },
      });

      pagesFetched++;
      if (pdf) pdfsFound++;

      if (!pdf) {
        const html = fetchResult.buffer.toString("utf8");
        for (const l of extractLinks(html, canonical)) {
          const c2 = canonicalize(l);
          if (!visited.has(c2) && sameOriginAllowed(c2, allowedDomains)) queue.push(c2);
        }
      }
    }

    await prisma.crawlRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        pagesFetched,
        pdfsFound,
        errorCount,
      },
    });

    return { runId: run.id, pagesFetched, pdfsFound, errorCount, status: "completed" };
  } catch (err) {
    await prisma.crawlRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), pagesFetched, pdfsFound, errorCount, notes: String(err) },
    }).catch(() => {});
    throw err;
  }
}

export const crawl = runCrawl;
export { runCrawl as run };
