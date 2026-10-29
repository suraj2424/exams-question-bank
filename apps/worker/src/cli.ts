import { runCrawl } from "./crawler";
import { extractDocument, extractPendingDocuments } from "./extraction";
import { reviewCandidate } from "./review";
import { validateQuestions, defaultQuestionPaths } from "./question-validation";
import { exportCrawlRun } from "./export";
import { prisma } from "@qb/db";
import { config } from "./config";
import { existsSync } from "node:fs";
import { dedupePending, findNearDuplicates, findSimilarToText } from "./dedupe";
import { runPipeline, listApprovedSources } from "./pipeline";
import { buildNimClient } from "./nim-client";
import { registerSource } from "./register-source";
import { runTick } from "./scheduler";
import { publishCandidates } from "./publish-candidates";
import { ingestPaper } from "./rag/ingest";
import { ragSearch } from "./rag/retrieval";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const cmd = process.argv[2];
  try {
    switch (cmd) {
      case "validate-questions":
      case "validate": {
        let path = process.argv[3];
        if (!path) {
          const found = defaultQuestionPaths().find((p) => existsSync(p));
          path = found || "storage/questions";
        }
        const res = validateQuestions(path);
        console.log(`Validated ${res.total} questions: ${res.valid} valid, ${res.issues.length} issues`);
        for (const i of res.issues) console.log(`- ${i.file}${i.questionId ? ` (${i.questionId})` : ""}: ${i.message}`);
        process.exitCode = res.issues.length > 0 ? 1 : 0;
        break;
      }
      case "crawl":
      case "crawl-source":
      case "run-crawl": {
        const sourceId = process.argv[3];
        const seedUrl = process.argv[4];
        if (!sourceId || !seedUrl) {
          console.error("Usage: crawl <sourceId> <seedUrl> [--max-pages N] [--delay N] [--timeout N]");
          process.exitCode = 1;
          break;
        }
        const maxPages = Number(arg("--max-pages") ?? config.maxPages);
        const delayMs = Number(arg("--delay") ?? config.delayMs);
        const timeoutMs = Number(arg("--timeout") ?? config.timeoutMs);
        const summary = await runCrawl(sourceId, seedUrl, { maxPages, delayMs, timeoutMs });
        console.log(JSON.stringify(summary, null, 2));
        break;
      }
      case "extract":
      case "extract-document": {
        const id = process.argv[3];
        if (!id) {
          console.error("Usage: extract <documentId>");
          process.exitCode = 1;
          break;
        }
        if (flag("--all") || id === "--all") {
          const sourceId = arg("--source");
          const r = await extractPendingDocuments(sourceId);
          console.log(JSON.stringify(r, null, 2));
        } else {
          const r = await extractDocument(id);
          console.log(JSON.stringify(r, null, 2));
        }
        break;
      }
      case "extract-pending": {
        const sourceId = process.argv[3];
        const r = await extractPendingDocuments(sourceId);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "review":
      case "review-candidate": {
        // review <id> <decision>
        const id = process.argv[3];
        const decision = process.argv[4] as "approve" | "reject" | "link_only";
        if (!id || !decision) {
          console.error("Usage: review <candidateId> <approve|reject|link_only> [--reason ...] [--reviewer ...]");
          process.exitCode = 1;
          break;
        }
        const reason = arg("--reason");
        const reviewer = arg("--reviewer");
        const r = await reviewCandidate(id, decision, { reason, reviewerId: reviewer });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "export-run":
      case "export": {
        const runId = process.argv[3];
        if (!runId) {
          console.error("Usage: export-run <runId> [outPath]");
          process.exitCode = 1;
          break;
        }
        const outPath = process.argv[4];
        const rel = await exportCrawlRun(runId, outPath);
        console.log(rel);
        break;
      }
      case "dedup":
      case "dedupe": {
        const sourceId = process.argv[3];
        const r = await dedupePending(sourceId);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      case "find-dups":
      case "find-duplicates": {
        const sourceId = process.argv[3];
        const pairs = await findNearDuplicates(sourceId);
        console.log(JSON.stringify(pairs, null, 2));
        break;
      }
      case "find-similar": {
        const text = process.argv[3];
        const sourceId = process.argv[4];
        if (!text) {
          console.error("Usage: find-similar <text> [sourceId]");
          process.exitCode = 1;
          break;
        }
        const sims = await findSimilarToText(text, sourceId);
        console.log(JSON.stringify(sims, null, 2));
        break;
      }
      case "list-sets": {
        const sourceId = process.argv[3];
        const where: any = {};
        if (sourceId) where.sourceDocument = { sourceId };
        const sets = await prisma.questionSet.findMany({ where, include: { _count: { select: { candidates: true } } } });
        console.log(JSON.stringify(sets, null, 2));
        break;
      }
      case "set-info": {
        const groupId = process.argv[3];
        if (!groupId) {
          console.error("Usage: set-info <groupId>");
          process.exitCode = 1;
          break;
        }
        const set = await prisma.questionSet.findFirst({ where: { groupId }, include: { candidates: { orderBy: { questionNumber: "asc" } } } });
        if (!set) {
          console.error(`Question set not found: ${groupId}`);
          process.exitCode = 1;
          break;
        }
        console.log(JSON.stringify(set, null, 2));
        break;
      }
      case "pipeline": {
        const sourceId = arg("--source");
        const crawlOnly = process.argv.includes("--crawl-only");
        const parseOnly = process.argv.includes("--parse-only");
        const exportOnly = process.argv.includes("--export-only");
        const outDir = arg("--out-dir");
        const maxPages = Number(arg("--max-pages") ?? config.maxPages);
        const delayMs = Number(arg("--delay") ?? config.delayMs);
        const timeoutMs = Number(arg("--timeout") ?? config.timeoutMs);
        const r = await runPipeline({
          sourceId,
          crawlOnly,
          parseOnly,
          exportOnly,
          outDir,
          maxPages,
          delayMs,
          timeoutMs,
        });
        console.log(JSON.stringify(r, null, 2));
        break;
      }
case "list-approved-sources": {
        const sources = await listApprovedSources();
        console.log(JSON.stringify(sources, null, 2));
        break;
      }
      case "list-sources": {
        const sources = await prisma.source.findMany();
        console.log(JSON.stringify(sources, null, 2));
        break;
      }
      case "register-source": {
        const name = arg("--name");
        const baseUrl = arg("--base-url");
        const allowedDomains = arg("--allowed-domains")?.split(",").map((d) => d.trim()) || [];
        const rightsStatus = arg("--rights-status") || "licensed";
        const licenceDocumentUrl = arg("--licence-url");
        const evidencePath = arg("--evidence-path");
        const commercialUse = flag("--commercial-use");
        const modificationAllowed = flag("--modification-allowed");
        const translationAllowed = flag("--translation-allowed");
        const redistributionAllowed = flag("--redistribution-allowed");
        const attributionRequired = flag("--attribution-required");
        const termsUrl = arg("--terms-url");
        const allowedToCrawl = flag("--allow-crawl");
        const allowedToIngestText = flag("--allow-ingest");
        const allowedToDisplay = flag("--allow-display");
        const approvedBy = arg("--approved-by") || "admin";
        const listingUrls = arg("--listing-urls")?.split(",").map((u) => u.trim()) || [];

        if (!name || !baseUrl || allowedDomains.length === 0) {
          console.error("Usage: register-source --name <name> --base-url <url> --allowed-domains <d1,d2> [options]");
          process.exitCode = 1;
          break;
        }

        const source = await registerSource({
          name,
          baseUrl,
          allowedDomains,
          rightsStatus,
          licenceDocumentUrl,
          evidencePath,
          commercialUse,
          modificationAllowed,
          translationAllowed,
          redistributionAllowed,
          attributionRequired,
          termsUrl,
          allowedToCrawl,
          allowedToIngestText,
          allowedToDisplay,
          approvedBy,
          listingUrls,
        });
        console.log(JSON.stringify(source, null, 2));
        break;
      }
      case "tick": {
        const sourceId = arg("--source");
        const dryRun = flag("--dry-run");
        const paperKey = arg("--paper");
        const result = await runTick({ sourceId, dryRun, paperKey });
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "publish-candidates": {
        const sourceId = arg("--source");
        const paperKey = arg("--paper");
        const dryRun = flag("--dry-run");
        const result = await publishCandidates({ sourceId, paperKey, dryRun });
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "ingest": {
        const docId = process.argv[3];
        if (!docId) {
          console.error("Usage: ingest <documentId>");
          process.exitCode = 1;
          break;
        }
        // Re-extract and structure a specific document
        console.log(`Ingest command for ${docId} - not yet implemented`);
        break;
      }
      case "rag-ingest":
      case "ingest-pdf": {
        const target = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined;
        const json = flag("--json");
        const progress = (message: string) => {
          if (!json) console.log(`[rag] ${message}`);
        };

        const targets: Array<{ path?: string; url?: string; fileName?: string }> = [];
        if (target && /^https?:\/\//i.test(target)) {
          const fileName = decodeURIComponent(new URL(target).pathname.split("/").pop() ?? "") || undefined;
          targets.push({ url: target, fileName });
        } else if (target) {
          const { statSync, readdirSync } = await import("node:fs");
          const stats = statSync(target);
          if (stats.isDirectory()) {
            for (const file of readdirSync(target)) {
              if (file.toLowerCase().endsWith(".pdf")) targets.push({ path: `${target}/${file}` });
            }
          } else {
            targets.push({ path: target });
          }
        } else {
          console.error("Usage: rag-ingest <pdf-path|pdf-url|folder> [--paper-key K] [--source-id ID] [--no-publish] [--translate] [--explain] [--no-images] [--json]");
          process.exitCode = 1;
          break;
        }

        const reports = [];
        const jobId = arg("--job-id");
        for (const item of targets) {
          try {
            const report = await ingestPaper({
              path: item.path,
              url: item.url,
              fileName: item.fileName ?? item.path?.split(/[\\/]/).pop(),
              paperKey: arg("--paper-key"),
              sourceId: arg("--source-id"),
              jobId,
              publish: !flag("--no-publish"),
              translate: flag("--translate"),
              explain: flag("--explain"),
              renderImages: !flag("--no-images"),
              onProgress: progress,
            });
            reports.push(report);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (jobId) {
              await prisma.ingestJob
                .update({
                  where: { id: jobId },
                  data: { status: "failed", stage: "failed", error: message.slice(-2000), finishedAt: new Date() },
                })
                .catch(() => {});
            }
            throw err;
          }
        }

        console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
        break;
      }
      case "rag-search":
      case "rag-find": {
        const query = process.argv[3];
        if (!query) {
          console.error("Usage: rag-search <query> [--limit N] [--section S] [--paper-key K] [--with-answers]");
          process.exitCode = 1;
          break;
        }
        const hits = await ragSearch(query, {
          limit: Number(arg("--limit") ?? 10),
          section: arg("--section"),
          paperKey: arg("--paper-key"),
          includeAnswer: flag("--with-answers"),
        });
        console.log(JSON.stringify(hits, null, 2));
        break;
      }
      default:
        console.log("Commands: validate-questions, crawl, extract, extract-pending, review, export-run, dedup, find-dups, find-similar, list-sets, set-info, pipeline, list-approved-sources, list-sources, rag-ingest, rag-search");
        process.exitCode = cmd ? 1 : 0;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main();
