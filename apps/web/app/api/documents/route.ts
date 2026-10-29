import { NextResponse } from "next/server";
import { existsSync, statSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { absoluteStoragePath, runWorkerDetached } from "@/lib/worker";

export const runtime = "nodejs";

function fileFacts(relativePath: string | null | undefined) {
  const absolutePath = absoluteStoragePath(relativePath);
  if (!absolutePath) {
    return { relativePath: null, absolutePath: null, exists: false, bytes: null };
  }
  let exists = false;
  let bytes: number | null = null;
  try {
    if (existsSync(absolutePath)) {
      exists = true;
      bytes = statSync(absolutePath).size;
    }
  } catch {
    exists = false;
  }
  return { relativePath: relativePath ?? null, absolutePath, exists, bytes };
}

export async function GET() {
  const jobs = await prisma.ingestJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { paper: true, sourceDocument: true },
  });

  const publishedCounts = await prisma.question.groupBy({
    by: ["paperId"],
    where: { status: "published", paperId: { not: null } },
    _count: { _all: true },
  });
  const publishedByPaper = new Map(
    publishedCounts.map((row) => [row.paperId as string, row._count._all]),
  );

  const items = jobs.map((job) => {
    const stats = (job.stats ?? {}) as Record<string, any>;
    const document = job.sourceDocument;
    const paper = job.paper;
    const progress = stats.progress ?? null;
    const relativePath = stats.storagePath ?? document?.storagePath ?? null;

    return {
      jobId: job.id,
      paperId: job.paperId ?? paper?.id ?? null,
      paperKey: paper?.paperKey ?? null,
      documentId: job.sourceDocumentId ?? document?.id ?? null,
      title: paper?.title ?? job.fileName ?? document?.title,
      fileName: job.fileName,
      sourceUrl: job.sourceUrl ?? document?.url ?? null,
      status: job.status,
      stage: job.stage,
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      progress: progress
        ? {
            phase: progress.phase ?? job.stage ?? null,
            percent: typeof progress.percent === "number" ? progress.percent : null,
            message: progress.message ?? null,
            page: progress.page ?? null,
            totalPages: progress.totalPages ?? null,
            downloadedBytes: progress.downloadedBytes ?? stats.bytes ?? null,
            totalBytes: progress.totalBytes ?? stats.bytes ?? null,
          }
        : null,
      storage: fileFacts(relativePath),
      sha256: stats.sha256 ?? document?.sha256 ?? null,
      pages: stats.pages ?? paper?.pageCount ?? document?.pageCount ?? null,
      parseMethod: document?.parseMethod ?? null,
      counts: {
        questions: stats.questions ?? paper?.totalQuestions ?? 0,
        published: publishedByPaper.get(job.paperId ?? paper?.id ?? "") ?? 0,
        answered: stats.matched ?? paper?.answeredQuestions ?? 0,
        answersFound: stats.answersFound ?? 0,
        sets: stats.sets ?? 0,
        warnings: stats.warnings ?? 0,
      },
    };
  });

  return NextResponse.json(items);
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const link = String(body.url ?? body.link ?? "").trim();
  const paperKey = String(body.paperKey ?? "").trim() || undefined;

  if (!link) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(link)) {
    return NextResponse.json({ error: "provide a PDF link starting with http:// or https://" }, { status: 400 });
  }

  const fileName = decodeURIComponent(link.split(/[\\/]/).pop()?.split("?")[0] ?? "") || "paper.pdf";

  const job = await prisma.ingestJob.create({
    data: {
      fileName,
      sourceUrl: link,
      status: "queued",
      stage: "queued",
      stats: { progress: { phase: "queued", percent: 0, message: "waiting for the worker" } } as any,
    },
  });

  const args = ["rag-ingest", link, "--json", "--job-id", job.id];
  if (paperKey) args.push("--paper-key", paperKey);
  if (body.translate) args.push("--translate");
  if (body.explain) args.push("--explain");

  const launched = runWorkerDetached(args);
  if (!launched.started) {
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: { status: "failed", stage: "failed", error: launched.error ?? "unknown error", finishedAt: new Date() },
    });
    return NextResponse.json({ error: "could not start ingest worker", details: launched.error }, { status: 500 });
  }

  return NextResponse.json({ jobId: job.id, status: "queued" }, { status: 202 });
}
