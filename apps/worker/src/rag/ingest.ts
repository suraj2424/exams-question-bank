import { prisma } from "@qb/db";
import { sha256Buffer } from "../hash";
import { writeFileRelative } from "../storage";
import { buildNimClient } from "../nim-client";
import { classifyQuestion } from "../classifier";
import { translateQuestion } from "../translator";
import { embedTextsBatched } from "../embedding";
import { normalizePaperKey } from "../paper-key";
import { fetchPdfBytes, loadPdf, pdfTitleFromBytes, RagPage } from "./pdf";
import {
  detectAnswerKeyPages,
  extractAnswersWithAi,
  extractExplanationsWithAi,
  extractQuestionsWithAi,
} from "./extract";
import { joinAnswers, normalizeAnswers, normalizeQuestions, groupBySharedContext } from "./normalize";

export interface IngestPaperOptions {
  path?: string;
  url?: string;
  buffer?: Buffer;
  fileName?: string;
  paperKey?: string;
  sourceId?: string;
  publish?: boolean;
  translate?: boolean;
  explain?: boolean;
  renderImages?: boolean;
  pagesPerCall?: number;
  jobId?: string;
  onProgress?: (message: string) => void;
}

export interface IngestPaperReport {
  paperKey: string;
  title: string;
  sourceDocumentId: string;
  paperId: string;
  storagePath: string;
  pages: number;
  answerPages: number[];
  questionsParsed: number;
  questionsStored: number;
  published: number;
  connectedSets: number;
  answersFound: number;
  answersMatched: number;
  answersMissingOption: number;
  questionsWithoutAnswer: number[];
  answersWithoutQuestion: number[];
  warnings: string[];
  durationMs: number;
}

async function resolveSource(opts: IngestPaperOptions): Promise<{ id: string; name: string }> {
  if (opts.sourceId) {
    const source = await prisma.source.findUnique({ where: { id: opts.sourceId } });
    if (!source) throw new Error(`source not found: ${opts.sourceId}`);
    return source;
  }

  const name = opts.url ? `RAG:${new URL(opts.url).hostname}` : "RAG:local-uploads";
  const existing = await prisma.source.findFirst({ where: { name } });
  if (existing) return existing;

  const domain = opts.url ? new URL(opts.url).hostname : "localhost";
  return prisma.source.create({
    data: {
      name,
      baseUrl: opts.url ? new URL(opts.url).origin : "file://local-uploads",
      allowedDomains: [domain],
      rightsStatus: "user_provided",
      allowedToIngestText: true,
      allowedToDisplay: true,
      allowedToCrawl: false,
      status: "approved",
      approvedBy: "rag-ingest",
      approvedAt: new Date(),
      notes: "Content supplied directly by the operator for RAG ingestion.",
    },
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

function derivePaperKey(opts: IngestPaperOptions): string {
  if (opts.paperKey) return slugify(opts.paperKey) || "uploaded-paper";
  const fileName = opts.fileName ?? opts.path?.split(/[\\/]/).pop() ?? "uploaded-paper";
  return normalizePaperKey(fileName.replace(/\.pdf$/i, "")) || "uploaded-paper";
}

async function acquireBytes(opts: IngestPaperOptions): Promise<Buffer> {
  if (opts.buffer) return opts.buffer;
  if (opts.path) {
    const { readFile } = await import("node:fs/promises");
    return readFile(opts.path);
  }
  if (opts.url) return fetchPdfBytes(opts.url);
  throw new Error("nothing to ingest: provide path, url or buffer");
}

async function downloadPdfWithProgress(
  url: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    onProgress?.(buf.length, buf.length);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let downloaded = 0;
  let lastReport = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    downloaded += value.length;
    if (downloaded - lastReport > 128 * 1024) {
      lastReport = downloaded;
      onProgress?.(downloaded, total);
    }
  }

  onProgress?.(downloaded, total || downloaded);
  return Buffer.concat(chunks);
}

async function updateJob(jobId: string | undefined, data: Record<string, unknown>): Promise<void> {
  if (!jobId) return;
  await prisma.ingestJob.update({ where: { id: jobId }, data: data as any }).catch(() => {});
}

async function answerExtractionPass(
  client: NonNullable<ReturnType<typeof buildNimClient>>,
  pages: RagPage[],
  opts: IngestPaperOptions,
  onProgress?: (message: string, detail?: { page?: number; totalPages?: number }) => void,
): Promise<{ answers: Awaited<ReturnType<typeof extractAnswersWithAi>>["answers"]; warnings: string[] }> {
  const result = await extractAnswersWithAi(client, pages, {
    pagesPerCall: opts.pagesPerCall ?? 4,
    includeImages: opts.renderImages !== false,
    onProgress,
  });
  return { answers: result.answers, warnings: result.warnings };
}

export async function ingestPaper(opts: IngestPaperOptions = {}): Promise<IngestPaperReport> {
  const started = Date.now();
  const warnings: string[] = [];
  const jobStats: Record<string, unknown> = {};

  const report = (message: string) => opts.onProgress?.(message);

  let writeChain: Promise<void> = Promise.resolve();
  function enqueue(task: () => Promise<void>): Promise<void> {
    writeChain = writeChain.then(task).catch(() => {});
    return writeChain;
  }

  async function saveStats(patch: Record<string, unknown>): Promise<void> {
    Object.assign(jobStats, patch);
    await enqueue(() => updateJob(opts.jobId, { stats: jobStats as any }));
  }

  async function setStage(
    stage: string,
    percent: number,
    message: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    report(message);
    Object.assign(jobStats, {
      progress: {
        phase: stage,
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        message,
        ...extra,
      },
    });
    await enqueue(() => updateJob(opts.jobId, { stage, stats: jobStats as any }));
  }

  const client = buildNimClient();
  if (!client) throw new Error("NVIDIA_API_KEY is not configured; the AI extractor cannot run");

  await setStage("downloading", 0, "acquiring PDF");
  await updateJob(opts.jobId, { status: "running" });

  let bytes: Buffer;
  if (opts.url) {
    let lastUpdate = 0;
    bytes = await downloadPdfWithProgress(opts.url, (downloaded, total) => {
      const now = Date.now();
      if (now - lastUpdate < 400 && downloaded !== total) return;
      lastUpdate = now;
      const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
      void saveStats({
        progress: {
          phase: "downloading",
          percent: Math.round(percent * 0.15),
          message: `downloading ${percent}% (${downloaded} bytes)`,
          downloadedBytes: downloaded,
          totalBytes: total,
        },
      });
      report(`downloading ${percent}% (${downloaded} bytes)`);
    });
  } else {
    bytes = await acquireBytes(opts);
  }

  const sha256 = sha256Buffer(bytes);
  const paperKey = derivePaperKey(opts);
  const title = pdfTitleFromBytes(bytes, opts.fileName ?? paperKey);
  const storagePath = `raw/${sha256}.pdf`;

  await setStage("downloaded", 15, "PDF stored locally", {
    downloadedBytes: bytes.length,
    totalBytes: bytes.length,
  });
  await saveStats({ storagePath, sha256, bytes: bytes.length });

  const source = await resolveSource(opts);
  const canonicalUrl = opts.url ?? `file://${sha256}.pdf`;

  const document = await prisma.fetchedDocument.upsert({
    where: {
      sourceId_canonicalUrl_sha256: { sourceId: source.id, canonicalUrl, sha256 },
    },
    update: { title, storagePath, extractionStatus: "processing", docKind: "paper" },
    create: {
      sourceId: source.id,
      url: canonicalUrl,
      canonicalUrl,
      title,
      contentType: "application/pdf",
      statusCode: 200,
      sha256,
      storagePath,
      robotsAllowed: true,
      isPdf: true,
      ingestAllowedAtFetch: true,
      extractionStatus: "processing",
      docKind: "paper",
    },
  });
  writeFileRelative(storagePath, bytes);

  await updateJob(opts.jobId, { sourceDocumentId: document.id, status: "running" });
  await setStage("parsing", 16, "rendering pages");

  const pdf = await loadPdf(bytes, { renderImages: opts.renderImages !== false });
  await saveStats({ pages: pdf.pageCount });

  await setStage("parsing", 18, "extracting questions and options with AI", {
    page: 0,
    totalPages: pdf.pageCount,
  });
  const questionPass = await extractQuestionsWithAi(client, pdf.pages, {
    pagesPerCall: opts.pagesPerCall ?? 3,
    includeImages: opts.renderImages !== false,
    onProgress: (message, detail) => {
      const done = detail?.page ?? 0;
      const total = detail?.totalPages ?? pdf.pageCount;
      const percent = 18 + (total > 0 ? (done / total) * 50 : 0);
      void setStage("parsing", percent, message, { page: done, totalPages: total });
    },
  });
  warnings.push(...questionPass.warnings);

  await setStage("answer-key", 70, "locating the answer table");
  const answerPageNumbers = detectAnswerKeyPages(pdf.pages);
  report(`answer table pages: ${answerPageNumbers.join(", ")}`);
  const answerPages = pdf.pages.filter((p) => answerPageNumbers.includes(p.pageNumber));
  const answerProgress = (message: string, detail?: { page?: number; totalPages?: number }) => {
    const done = detail?.page ?? 0;
    const total = detail?.totalPages ?? Math.max(1, answerPages.length);
    const percent = 72 + (total > 0 ? (done / total) * 13 : 0);
    void setStage("answer-key", percent, message, { page: done, totalPages: total });
  };
  const answerPass = await answerExtractionPass(client, answerPages, opts, answerProgress);
  warnings.push(...answerPass.warnings);

  const normalizedQuestions = normalizeQuestions(questionPass.questions);
  warnings.push(...normalizedQuestions.warnings);

  let answers = normalizeAnswers(answerPass.answers);
  let join = joinAnswers(normalizedQuestions.questions, answers.answers);

  if (
    normalizedQuestions.questions.length > 0 &&
    join.matched < normalizedQuestions.questions.length * 0.5
  ) {
    const remaining = pdf.pages.filter((p) => !answerPageNumbers.includes(p.pageNumber));
    if (remaining.length > 0) {
      await setStage("answer-key", 72, "answer coverage low, sweeping remaining pages for an answer table");
      const sweep = await answerExtractionPass(client, remaining, opts, answerProgress);
      warnings.push(...sweep.warnings);
      const merged = normalizeAnswers([...answerPass.answers, ...sweep.answers]);
      answers = merged;
      join = joinAnswers(normalizedQuestions.questions, answers.answers);
    }
  }

  warnings.push(...answers.warnings);

  const joinByNumber = new Map(join.entries.map((e) => [e.questionNumber, e]));
  const answerByNumber = new Map(answers.answers.map((a) => [a.number, a]));

  if (opts.explain) {
    const pending = normalizedQuestions.questions
      .filter((q) => !answerByNumber.get(q.number)?.explanation)
      .map((q) => ({
        number: q.number,
        stem: q.stem,
        options: q.options.map((o) => ({ key: o.key, text: o.text })),
        correctKey: joinByNumber.get(q.number)?.optionKey ?? "",
      }))
      .filter((item) => item.correctKey);

    if (pending.length > 0) {
      await setStage("explaining", 86, `writing explanations for ${pending.length} questions`);
      const explanationPass = await extractExplanationsWithAi(client, pending, {
        pagesPerCall: opts.pagesPerCall ?? 5,
        onProgress: opts.onProgress,
      });
      warnings.push(...explanationPass.warnings);
      for (const [number, text] of explanationPass.explanations) {
        const answer = answerByNumber.get(number);
        if (answer) answer.explanation = text;
      }
    }
  }

  const paper = await prisma.paper.upsert({
    where: { sourceDocumentId_paperKey: { sourceDocumentId: document.id, paperKey } },
    update: {
      title,
      pageCount: pdf.pageCount,
      totalQuestions: normalizedQuestions.questions.length,
      answeredQuestions: join.matched,
      status: "ingested",
      structured: {
        questions: normalizedQuestions.questions,
        answers: answers.answers,
        answerPages: answerPageNumbers,
      } as any,
    },
    create: {
      sourceDocumentId: document.id,
      paperKey,
      title,
      pageCount: pdf.pageCount,
      totalQuestions: normalizedQuestions.questions.length,
      answeredQuestions: join.matched,
      status: "ingested",
      structured: {
        questions: normalizedQuestions.questions,
        answers: answers.answers,
        answerPages: answerPageNumbers,
      } as any,
    },
  });

  await prisma.paperAnswerKey.deleteMany({ where: { paperId: paper.id } });
  if (answers.answers.length > 0) {
    await prisma.paperAnswerKey.createMany({
      data: answers.answers.map((a) => ({
        paperId: paper.id,
        questionNumber: a.number,
        answerKey: a.key,
        explanation: a.explanation,
        pageNumber: a.page,
        rawText: `Q${a.number} (${a.key})`,
      })),
      skipDuplicates: true,
    });
  }

  // Connected questions: same directions / passage / data block -> one set.
  await setStage("grouping", 87, "grouping connected questions");
  const connectedGroups = groupBySharedContext(normalizedQuestions.questions);
  const setIdByQuestionNumber = new Map<number, string>();
  for (let i = 0; i < connectedGroups.length; i++) {
    const group = connectedGroups[i];
    const groupId = `${paperKey}-set-${String(i + 1).padStart(2, "0")}`;
    const members = normalizedQuestions.questions.filter((q) => group.questionNumbers.includes(q.number));
    const pages = members.map((q) => q.page).filter((p): p is number => typeof p === "number");

    const set = await prisma.questionSet.upsert({
      where: { groupId },
      update: {
        sharedContext: group.sharedContext,
        pageStart: pages.length ? Math.min(...pages) : null,
        pageEnd: pages.length ? Math.max(...pages) : null,
        paperKey,
        flags: { questionNumbers: group.questionNumbers } as any,
      },
      create: {
        groupId,
        sourceDocumentId: document.id,
        type: "connected_set",
        sharedContext: group.sharedContext,
        pageStart: pages.length ? Math.min(...pages) : null,
        pageEnd: pages.length ? Math.max(...pages) : null,
        confidence: 1,
        paperKey,
        flags: { questionNumbers: group.questionNumbers } as any,
      },
    });

    for (const number of group.questionNumbers) setIdByQuestionNumber.set(number, set.id);
  }
  if (connectedGroups.length > 0) {
    report(`connected ${connectedGroups.length} question sets`);
  }

  const embeddingTexts = normalizedQuestions.questions.map((q) =>
    [q.section ?? "", q.topic ?? "", q.stem, ...q.options.map((o) => o.text)].join(" ").slice(0, 2000),
  );
  await setStage("embedding", 89, "embedding questions for retrieval");
  const embeddings = await embedTextsBatched(embeddingTexts, 8);

  let stored = 0;
  let published = 0;

  await setStage("storing", 90, "storing questions in their categories");

  for (let i = 0; i < normalizedQuestions.questions.length; i++) {
    const question = normalizedQuestions.questions[i];
    const joinEntry = joinByNumber.get(question.number);
    const answer = answerByNumber.get(question.number);

    const classification = classifyQuestion(
      question.stem,
      question.sharedContext ?? "",
      question.options.map((o) => o.text),
      question.number,
      paperKey,
    );
    const section = question.section ?? classification.section;
    const topic = question.topic ?? classification.topic;
    const subtopic = classification.subtopic;

    const qid = `pyq-${paperKey}-q${String(question.number).padStart(3, "0")}`;
    const correctOptionId = joinEntry?.optionKey ? `${qid}-${joinEntry.optionKey}` : null;
    const explanation = answer?.explanation ?? "";

    const optionRows = question.options.map((option, idx) => ({
      id: `${qid}-${option.key}`,
      canonicalKey: option.key,
      displayOrder: idx,
      enText: option.text,
      hiText: option.text,
      isCorrect: option.key === joinEntry?.optionKey,
      optionExplanationEn: null,
      optionExplanationHi: null,
    }));

    let hiPrompt = question.stem;
    let hiExplanation = explanation;
    let hiStatus = "needs_human_review";
    let translator: string | null = null;

    if (opts.translate && section !== "English Language") {
      report(`translating Q${question.number}`);
      const translation = await translateQuestion(
        client,
        section,
        question.stem,
        question.options.map((o) => ({ key: o.key, text: o.text })),
        explanation,
        question.sharedContext ?? undefined,
      );
      hiPrompt = translation.prompt;
      hiExplanation = translation.explanation || explanation;
      hiStatus = "approved";
      translator = "llm:nemotron-3.5-super-vl-120b-a12b";
    }

    const hasAnswer = !!joinEntry?.optionKey;
    const readyToPublish =
      opts.publish !== false && hasAnswer && question.options.length >= 4;
    if (readyToPublish) published++;

    await prisma.question.upsert({
      where: { id: qid },
      update: {
        section,
        topic,
        subtopic,
        difficulty: Math.max(1, Math.min(5, Math.ceil(classification.confidence * 5))),
        sourceType: "licensed_pyq",
        sourceId: source.id,
        sourceUrl: document.url,
        examYear: null,
        examStage: null,
        paperReference: paperKey,
        paperKey,
        paperId: paper.id,
        status: readyToPublish ? "published" : "in_review",
        reviewedBy: "rag-ingest",
        correctOptionId,
        questionNumber: question.number,
        questionSetId: setIdByQuestionNumber.get(question.number) ?? null,
        sharedContext: question.sharedContext,
        sourceDocumentId: document.id,
        sourcePage: question.page,
        extractionMethod: "rag_ai",
        answerSource: hasAnswer ? `paper_answer_table:${paper.id}` : null,
        embedding: embeddings[i] as any,
        options: {
          deleteMany: {},
          create: optionRows,
        },
        variants: {
          deleteMany: {},
          create: [
            {
              id: `${qid}-en`,
              language: "en",
              prompt: question.stem,
              explanation: explanation || " ",
              instructions: null,
              status: "approved",
              translator: null,
              reviewer: "rag-ingest",
            },
            {
              id: `${qid}-hi`,
              language: "hi",
              prompt: hiPrompt,
              explanation: hiExplanation || " ",
              instructions: null,
              status: hiStatus,
              translator,
              reviewer: translator ? "rag-ingest" : null,
            },
          ],
        },
      },
      create: {
        id: qid,
        exam: "IBPS_PO",
        section,
        topic,
        subtopic,
        questionFormat: "mcq_single",
        difficulty: Math.max(1, Math.min(5, Math.ceil(classification.confidence * 5))),
        sourceType: "licensed_pyq",
        sourceId: source.id,
        sourceUrl: document.url,
        licenceId: null,
        examYear: null,
        examStage: null,
        paperReference: paperKey,
        paperKey,
        paperId: paper.id,
        status: readyToPublish ? "published" : "in_review",
        createdBy: "rag-ingest",
        reviewedBy: "rag-ingest",
        correctOptionId,
        questionNumber: question.number,
        questionSetId: setIdByQuestionNumber.get(question.number) ?? null,
        sharedContext: question.sharedContext,
        sourceDocumentId: document.id,
        sourcePage: question.page,
        extractionMethod: "rag_ai",
        answerSource: hasAnswer ? `paper_answer_table:${paper.id}` : null,
        embedding: embeddings[i] as any,
        options: { create: optionRows },
        variants: {
          create: [
            {
              id: `${qid}-en`,
              language: "en",
              prompt: question.stem,
              explanation: explanation || " ",
              instructions: null,
              status: "approved",
              translator: null,
              reviewer: "rag-ingest",
            },
            {
              id: `${qid}-hi`,
              language: "hi",
              prompt: hiPrompt,
              explanation: hiExplanation || " ",
              instructions: null,
              status: hiStatus,
              translator,
              reviewer: translator ? "rag-ingest" : null,
            },
          ],
        },
      },
    });

    stored++;

    if (stored % 5 === 0 || stored === normalizedQuestions.questions.length) {
      const percent = 90 + (normalizedQuestions.questions.length > 0
        ? (stored / normalizedQuestions.questions.length) * 9
        : 9);
      await setStage("storing", percent, `stored ${stored}/${normalizedQuestions.questions.length} questions`);
    }
  }

  await prisma.fetchedDocument.update({
    where: { id: document.id },
    data: { extractionStatus: "completed", pageCount: pdf.pageCount, parseMethod: "rag_ai" },
  });

  await prisma.paper.update({
    where: { id: paper.id },
    data: { totalQuestions: stored, answeredQuestions: join.matched },
  });

  await saveStats({
    questions: stored,
    published,
    matched: join.matched,
    answersFound: answers.answers.length,
    pages: pdf.pageCount,
    warnings: warnings.length,
    sets: connectedGroups.length,
    storagePath,
    downloadedBytes: bytes.length,
    totalBytes: bytes.length,
  });
  await setStage("done", 100, "done");
  await updateJob(opts.jobId, {
    paperId: paper.id,
    status: "completed",
    finishedAt: new Date(),
  });

  return {
    paperKey,
    title,
    sourceDocumentId: document.id,
    paperId: paper.id,
    storagePath,
    pages: pdf.pageCount,
    answerPages: answerPageNumbers,
    questionsParsed: questionPass.questions.length,
    questionsStored: stored,
    published,
    connectedSets: connectedGroups.length,
    answersFound: answers.answers.length,
    answersMatched: join.matched,
    answersMissingOption: join.missingOption,
    questionsWithoutAnswer: join.questionsWithoutAnswer,
    answersWithoutQuestion: join.answersWithoutQuestion,
    warnings,
    durationMs: Date.now() - started,
  };
}
