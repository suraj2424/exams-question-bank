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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const job = await prisma.ingestJob.findUnique({
    where: { id },
    include: { paper: true, sourceDocument: true },
  });

  const paper =
    job?.paper ??
    (await prisma.paper.findUnique({ where: { id } })) ??
    (await prisma.paper.findFirst({ where: { sourceDocumentId: id } }));

  if (!paper && !job) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }

  const document =
    job?.sourceDocument ??
    (await prisma.fetchedDocument.findUnique({ where: { id } })) ??
    (paper ? await prisma.fetchedDocument.findUnique({ where: { id: paper.sourceDocumentId } }) : null);

  const [questions, sets] = paper
    ? await Promise.all([
        prisma.question.findMany({
          where: { paperId: paper.id },
          orderBy: [{ questionNumber: "asc" }],
          include: {
            options: { orderBy: { displayOrder: "asc" } },
            variants: { where: { language: "en" } },
          },
        }),
        prisma.questionSet.findMany({
          where: { sourceDocumentId: paper.sourceDocumentId },
          orderBy: { groupId: "asc" },
        }),
      ])
    : [[], []];

  const setMembers = new Map<string, number[]>();
  for (const question of questions) {
    if (!question.questionSetId) continue;
    const list = setMembers.get(question.questionSetId) ?? [];
    list.push(question.questionNumber ?? 0);
    setMembers.set(question.questionSetId, list);
  }

  const payload = questions.map((question) => {
    const correct = question.options.find((option) => option.id === question.correctOptionId);
    return {
      id: question.id,
      number: question.questionNumber,
      section: question.section,
      topic: question.topic,
      subtopic: question.subtopic,
      difficulty: question.difficulty,
      status: question.status,
      prompt: question.variants[0]?.prompt ?? "",
      explanation: question.variants[0]?.explanation ?? "",
      sharedContext: question.sharedContext,
      page: question.sourcePage,
      answerKey: correct?.canonicalKey ?? null,
      answerText: correct?.enText ?? null,
      setId: question.questionSetId,
      setQuestions: question.questionSetId ? setMembers.get(question.questionSetId) ?? [] : [],
      options: question.options.map((option) => ({
        key: option.canonicalKey,
        text: option.enText,
        isCorrect: option.isCorrect,
      })),
    };
  });

  const sectionMap = new Map<string, Map<string, typeof payload>>();
  for (const question of payload) {
    const topics = sectionMap.get(question.section) ?? new Map<string, typeof payload>();
    const bucket = topics.get(question.topic) ?? [];
    bucket.push(question);
    topics.set(question.topic, bucket);
    sectionMap.set(question.section, topics);
  }

  const categories = [...sectionMap.entries()].map(([section, topics]) => ({
    section,
    questions: [...topics.values()].flat().length,
    topics: [...topics.entries()].map(([topic, items]) => ({
      topic,
      questions: items.length,
      items,
    })),
  }));

  const stats = (job?.stats ?? {}) as Record<string, any>;

  return NextResponse.json({
    job: job
      ? {
          jobId: job.id,
          status: job.status,
          stage: job.stage,
          error: job.error,
          progress: stats.progress ?? null,
          stats,
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
        }
      : null,
    paper: paper
      ? {
          id: paper.id,
          paperKey: paper.paperKey,
          title: paper.title,
          pageCount: paper.pageCount,
          totalQuestions: paper.totalQuestions,
          answeredQuestions: paper.answeredQuestions,
          status: paper.status,
        }
      : null,
    document: document
      ? {
          id: document.id,
          url: document.url,
          storage: fileFacts(document.storagePath),
          sha256: document.sha256,
          pageCount: document.pageCount,
          parseMethod: document.parseMethod,
          fetchedAt: document.fetchedAt,
        }
      : null,
    sets: sets.map((set) => ({
      id: set.id,
      groupId: set.groupId,
      type: set.type,
      sharedContext: set.sharedContext,
      pageStart: set.pageStart,
      pageEnd: set.pageEnd,
      questionNumbers: setMembers.get(set.id) ?? [],
    })),
    categories,
    questions: payload,
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const job = await prisma.ingestJob.findUnique({ where: { id }, include: { paper: true } });
  if (!job) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }
  if (job.status === "running" || job.status === "queued") {
    return NextResponse.json({ error: "this document is already being processed" }, { status: 409 });
  }
  if (!job.sourceUrl) {
    return NextResponse.json({ error: "no source link stored for this document" }, { status: 400 });
  }

  await prisma.ingestJob.update({
    where: { id: job.id },
    data: {
      status: "queued",
      stage: "queued",
      error: null,
      finishedAt: null,
      stats: { progress: { phase: "queued", percent: 0, message: "re-queued" } } as any,
    },
  });

  const args = ["rag-ingest", job.sourceUrl, "--json", "--job-id", job.id];
  if (job.paper?.paperKey) args.push("--paper-key", job.paper.paperKey);

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
