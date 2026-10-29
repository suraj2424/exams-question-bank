import { prisma } from "@qb/db";
import { config } from "./config";
import { buildNimClient } from "./nim-client";
import { extractPendingDocuments } from "./extraction";
import { runPipeline } from "./pipeline";
import { publishCandidates } from "./publish-candidates";

export interface TickOptions {
  sourceId?: string;
  dryRun?: boolean;
  paperKey?: string;
}

export async function runTick(opts: TickOptions = {}): Promise<any> {
  const client = buildNimClient();
  if (!client) {
    return { error: "NIM client not configured (NVIDIA_API_KEY missing)" };
  }

  const where: any = { status: "approved", allowedToCrawl: true, allowedToIngestText: true, allowedToDisplay: true };
  if (opts.sourceId) where.id = opts.sourceId;

  const sources = await prisma.source.findMany({ where });

  let results: any = { processed: 0, crawled: 0, extracted: 0, exported: 0, published: 0 };

  for (const source of sources) {
    if (!opts.dryRun) {
      const seedUrl = source.baseUrl;
      if (seedUrl) {
        try {
          await runPipeline({
            sourceId: source.id,
            maxPages: config.maxPages,
            delayMs: config.delayMs,
            timeoutMs: config.timeoutMs,
          });
          results.crawled++;
        } catch (err) {
          console.error(`Pipeline failed for source ${source.id}:`, err);
        }
      }
    } else {
      console.log(`[DRY RUN] Would run pipeline for source ${source.id} (${source.name})`);
    }
  }

  if (!opts.dryRun) {
    const pubResult = await publishCandidates({ sourceId: opts.sourceId, paperKey: opts.paperKey });
    results.published = pubResult.published;
  } else {
    console.log("[DRY RUN] Would publish candidates");
  }

  return { ...results, timestamp: new Date().toISOString() };
}