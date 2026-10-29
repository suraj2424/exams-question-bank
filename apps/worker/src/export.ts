import { prisma } from "@qb/db";
import { writeFileRelative } from "./storage";

export async function exportCrawlRun(runId: string, outPath?: string): Promise<string> {
  const run = await prisma.crawlRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("run not found");
  const docs = await prisma.fetchedDocument.findMany({ where: { sourceId: run.sourceId } });
  // filter by fetchedAt >= run.startedAt? Keep all for source; simpler include run window
  const lines = docs.map((d) => JSON.stringify({
    id: d.id,
    url: d.url,
    canonicalUrl: d.canonicalUrl,
    title: d.title,
    contentType: d.contentType,
    statusCode: d.statusCode,
    sha256: d.sha256,
    storagePath: d.storagePath,
    fetchedAt: d.fetchedAt,
    isPdf: d.isPdf,
    extractionStatus: d.extractionStatus,
  }));
  const content = lines.join("\n") + (lines.length ? "\n" : "");
  const relative = outPath || `exports/crawl-run-${runId}.jsonl`;
  writeFileRelative(relative, content);
  return relative;
}
