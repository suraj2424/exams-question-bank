import { prisma } from "@qb/db";
import { buildNimClient } from "./nim-client";
import { parseSolutionText, joinAnswerKey } from "./answer-key";
import { classifyQuestion } from "./classifier";
import { translateQuestion } from "./translator";
import { publishQuestion, exportQuestionsToJson, QuestionToPublish, DEFAULT_GATES } from "./publisher";
import { writeFileRelative } from "./storage";
import { extractPdfText } from "./pdf-text";

export interface PublishCandidatesOptions {
  sourceId?: string;
  paperKey?: string;
  dryRun?: boolean;
  limit?: number;
}

export async function publishCandidates(opts: PublishCandidatesOptions = {}): Promise<any> {
  const docs = await prisma.fetchedDocument.findMany({
    where: { sourceId: opts.sourceId || undefined, extractionStatus: "completed" },
  });

  const solutionsDocs = docs.filter((d) => d.docKind === "solutions" || /solution/i.test(d.title || ""));
  const questionDocs = docs.filter((d) => d.docKind === "questions" || /question|memory/i.test(d.title || ""));

  const paperKey = opts.paperKey || questionDocs[0]?.paperKey || "unknown-paper";

  let answerKeyMap = new Map<number, { key: string; explanation: string }>();

  for (const solDoc of solutionsDocs) {
    const buf = await import("./storage").then((m) => m.readFileRelative(solDoc.storagePath!));
    const data = await extractPdfText(buf);
    const parsed = parseSolutionText(data.text || "");
    console.log(`[DEBUG] Solutions doc ${solDoc.id}: parsed ${parsed.entries.length} entries`);
    for (const entry of parsed.entries) {
      answerKeyMap.set(entry.questionNumber, { key: entry.key, explanation: entry.explanation });
    }
  }
  console.log(`[DEBUG] answerKeyMap size: ${answerKeyMap.size}`);

  const limit = opts.limit ? Number(opts.limit) : undefined;
  const whereBase = { status: "pending_review" };
  if (opts.sourceId) whereBase.sourceDocument = { sourceId: opts.sourceId };

  const questionDocIds = questionDocs.map((d) => d.id);
  const candidates = await prisma.questionCandidate.findMany({
    where: {
      status: "pending_review",
      sourceDocumentId: { in: questionDocs.map((d) => d.id) },
    },
    include: {
      sourceDocument: true,
      questionSet: true,
    },
    orderBy: [{ questionSetId: "asc" }, { questionNumber: "asc" }, { createdAt: "asc" }],
    take: opts.limit ? Number(opts.limit) : undefined,
  });

  if (candidates.length === 0) {
    return { published: 0, message: "No pending candidates" };
  }

  const questionSets = await prisma.questionSet.findMany({
    where: { sourceDocumentId: { in: questionDocs.map((d) => d.id) } },
  });

  const setMap = new Map<string, { id: string; sharedContext: string; paperKey: string | null }>();
  for (const qs of questionSets) {
    setMap.set(qs.groupId, { id: qs.id, sharedContext: qs.sharedContext || "", paperKey: qs.paperKey });
  }

  let published = 0;
  let failed = 0;

  for (const cand of candidates) {
    const answer = cand.questionNumber ? answerKeyMap.get(cand.questionNumber) : null;
    if (!answer) { continue; }

    const setInfo = cand.questionSetId ? setMap.get(cand.questionSetId) : null;
    const sharedContext = setInfo?.sharedContext || cand.sourceDocument?.title || "";

    const classification = classifyQuestion(
      cand.cleanedText || cand.rawText,
      sharedContext,
      [],
      cand.questionNumber || undefined,
      paperKey
    );

    const options = extractOptions(cand.cleanedText || cand.rawText, answer.key);
    if (options.length < 4) continue;

    const correctOpt = options.find((o) => o.canonicalKey === answer.key);
    if (!correctOpt) continue;

    const translation = await translateQuestion(
      await import("./nim-client").then((m) => m.buildNimClient()),
      classification.section,
      cand.cleanedText || cand.rawText,
      options.map((o) => ({ key: o.canonicalKey, text: o.enText })),
      answer.explanation,
      sharedContext
    );

    const qId = `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}`;

    const enVariant = {
      id: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}-en`,
      question_id: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}`,
      language: "en",
      prompt: cand.cleanedText || cand.rawText,
      explanation: answer.explanation,
      instructions: null,
      glossary: null,
      status: "approved",
      translator: null,
      reviewer: "pipeline",
    };

    const hiVariant = {
      id: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}-hi`,
      question_id: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}`,
      language: "hi",
      prompt: translation.prompt,
      explanation: translation.explanation,
      instructions: translation.instructions,
      glossary: translation.glossary,
      status: "approved",
      translator: "llm:nemotron-3.5-super-vl-120b-a12b",
      reviewer: "pipeline",
    };

    const questionData: QuestionToPublish = {
      id: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}`,
      exam: "IBPS_PO",
      section: classification.section,
      topic: classification.topic,
      subtopic: classification.subtopic,
      questionFormat: "mcq_single",
      difficulty: Math.ceil(classification.confidence * 5),
      sourceType: "licensed_pyq",
      sourceId: cand.sourceDocument?.sourceId || null,
      sourceUrl: cand.sourceDocument?.url || null,
      licenceId: "licensed_pyq",
      examYear: 2020,
      examStage: "prelims",
      examShift: null,
      paperReference: paperKey,
      status: "published",
      createdBy: "pipeline",
      reviewedBy: "pipeline",
      version: 1,
      correctOptionId: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}-${answer.key}`,
      questionNumber: cand.questionNumber,
      questionSetId: setInfo?.id || null,
      sharedContext: sharedContext,
      options: options.map((o, idx) => ({
        id: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}-${o.canonicalKey}`,
        question_id: `pyq-${paperKey}-q${String(cand.questionNumber).padStart(3, "0")}`,
        canonical_key: o.canonicalKey,
        display_order: idx,
        en_text: o.enText,
        hi_text: o.hiText || o.enText,
        media: null,
        is_correct: o.canonicalKey === answer.key,
        option_explanation_en: null,
        option_explanation_hi: null,
      })),
      variants: [] as any[],
      extractionMethod: "llm_structured",
      llmConfidence: 0.9,
      answerSource: `solutions_pdf:${paperKey}`,
      paperKey: paperKey,
    };

    questionData.variants = [enVariant, hiVariant];

    await publishQuestion(questionData, DEFAULT_GATES);
  }

  return { published: candidates.length, failed: 0, total: candidates.length };
}

function extractOptions(text: string, correctKey: string): Array<{ canonicalKey: string; enText: string; hiText?: string }> {
  const options: Array<{ canonicalKey: string; enText: string; hiText?: string }> = [];
  const optMatches = text.matchAll(/\(?([A-Ea-e])\)?[.)]\s*([^\n]+)/g);
  for (const match of optMatches) {
    const key = match[1].toUpperCase();
    const optText = match[2].trim();
    if (optText && !options.some((o) => o.canonicalKey === key)) {
      options.push({ canonicalKey: key, enText: optText });
    }
  }
  if (options.length < 4) {
    const lines = text.split("\n");
    for (const line of lines) {
      const m = /^\(?([A-Ea-e])\)?[.)]\s*(.+)$/.exec(line.trim());
      if (m) {
        const key = m[1].toUpperCase();
        const optText = m[2].trim();
        if (optText && !options.some((o) => o.canonicalKey === key)) {
          options.push({ canonicalKey: key, enText: optText });
        }
      }
    }
  }
  options.sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
  return options;
}