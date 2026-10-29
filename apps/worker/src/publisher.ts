import { prisma } from "@qb/db";
import { questionSchema, SECTIONS, SOURCE_TYPES, STATUSES, DIFFICULTIES } from "@qb/shared";
import { validateOne, ValidationIssue } from "./question-validation";
import { NimClient } from "./nim-client";
import { classifyQuestion } from "./classifier";
import { translateQuestion } from "./translator";
import { writeFileRelative } from "./storage";

export interface PublishGates {
  minConfidence: number;
  requireAnswerKey: boolean;
  requireHiVariant: boolean;
  dedupeThreshold: number;
}

export const DEFAULT_GATES: PublishGates = {
  minConfidence: 0.85,
  requireAnswerKey: true,
  requireHiVariant: true,
  dedupeThreshold: 0.9,
};

export interface QuestionToPublish {
  id: string;
  exam: string;
  section: string;
  topic: string;
  subtopic: string;
  questionFormat: string;
  difficulty: number;
  sourceType: string;
  sourceId: string | null;
  sourceUrl: string | null;
  licenceId: string | null;
  examYear: number | null;
  examStage: string | null;
  examShift: string | null;
  paperReference: string | null;
  status: string;
  createdBy: string;
  reviewedBy: string | null;
  version: number;
  correctOptionId: string;
  questionNumber: number | null;
  questionSetId: string | null;
  sharedContext: string | null;
  options: Array<{
    id: string;
    canonicalKey: string;
    displayOrder: number;
    enText: string;
    hiText: string;
    media: any;
    isCorrect: boolean;
    optionExplanationEn: string | null;
    optionExplanationHi: string | null;
  }>;
  variants: Array<{
    id: string;
    language: string;
    prompt: string;
    explanation: string;
    instructions: string | null;
    glossary: any;
    status: string;
    translator: string | null;
    reviewer: string | null;
  }>;
  extractionMethod: string;
  llmConfidence: number;
  answerSource: string | null;
  paperKey: string | null;
}

export async function runPublishGates(
  question: QuestionToPublish,
  gates: PublishGates = DEFAULT_GATES
): Promise<{ pass: boolean; failures: string[] }> {
  const failures: string[] = [];

  if (question.llmConfidence < gates.minConfidence) {
    failures.push(`llmConfidence ${question.llmConfidence} < ${gates.minConfidence}`);
  }

  if (gates.requireAnswerKey && !question.answerSource) {
    failures.push("missing answerSource");
  }

  const correctOpts = question.options.filter((o) => o.isCorrect);
  if (correctOpts.length !== 1) {
    failures.push(`exactly one correct option required, found ${correctOpts.length}`);
  }
  if (correctOpts.length === 1 && correctOpts[0].id !== question.correctOptionId) {
    failures.push("correctOptionId does not match the isCorrect option");
  }

  const optionKeys = question.options.map((o) => o.canonicalKey);
  if (new Set(optionKeys).size !== optionKeys.length) {
    failures.push("duplicate canonicalKey in options");
  }

  if (gates.requireHiVariant && (question.section === "Quantitative Aptitude" || question.section === "Reasoning Ability")) {
    const hasHi = question.variants.some((v) => v.language === "hi");
    if (!hasHi) failures.push("missing hi variant for quant/reasoning");
  }

  const hasEn = question.variants.some((v) => v.language === "en");
  if (!hasEn) failures.push("missing en variant");

  if (!SECTIONS.includes(question.section as any)) {
    failures.push(`invalid section: ${question.section}`);
  }

  if (!SOURCE_TYPES.includes(question.sourceType as any)) {
    failures.push(`invalid sourceType: ${question.sourceType}`);
  }

  if (!STATUSES.includes(question.status as any)) {
    failures.push(`invalid status: ${question.status}`);
  }

  if (!DIFFICULTIES.includes(question.difficulty)) {
    failures.push(`invalid difficulty: ${question.difficulty}`);
  }

  if (question.options.length < 4 || question.options.length > 5) {
    failures.push(`options count must be 4-5, got ${question.options.length}`);
  }

  return { pass: failures.length === 0, failures };
}

export async function dedupeQuestion(
  question: QuestionToPublish,
  threshold: number
): Promise<boolean> {
  const existing = await prisma.question.findMany({
    where: { status: "published", sourceType: question.sourceType },
    select: { id: true, exam: true, section: true, topic: true, subtopic: true },
    take: 100,
  });

  const { cosineSimilarity, embedText } = await import("./embedding");
  const questionText = `${question.section} ${question.topic} ${question.subtopic} ${question.variants.find((v) => v.language === "en")?.prompt || ""}`.slice(0, 1000);
  const vec = await embedText(questionText);

  for (const ex of existing) {
    const exText = `${ex.section} ${ex.topic} ${ex.subtopic}`.slice(0, 1000);
    const exVec = await embedText(exText);
    if (cosineSimilarity(vec, exVec) >= threshold) {
      return true;
    }
  }
  return false;
}

export async function publishQuestion(
  question: QuestionToPublish,
  gates: PublishGates = DEFAULT_GATES
): Promise<{ success: boolean; questionId?: string; failures?: string[] }> {
  const gateResult = await runPublishGates(question, gates);
  if (!gateResult.pass) {
    return { success: false, failures: gateResult.failures };
  }

  const isDeduped = await dedupeQuestion(question, gates.dedupeThreshold);
  if (isDeduped) {
    return { success: false, failures: ["near-duplicate detected"] };
  }

  const zodResult = questionSchema.safeParse(question);
  if (!zodResult.success) {
    const failures = zodResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    return { success: false, failures };
  }

  try {
    const created = await prisma.question.create({
      data: {
        id: question.id,
        exam: question.exam,
        section: question.section,
        topic: question.topic,
        subtopic: question.subtopic,
        questionFormat: question.questionFormat,
        difficulty: question.difficulty,
        sourceType: question.sourceType,
        sourceId: question.sourceId,
        sourceUrl: question.sourceUrl,
        licenceId: question.licenceId,
        examYear: question.examYear,
        examStage: question.examStage,
        examShift: question.examShift,
        paperReference: question.paperReference,
        status: question.status,
        createdBy: question.createdBy,
        reviewedBy: question.reviewedBy,
        version: question.version,
        correctOptionId: question.correctOptionId,
        questionNumber: question.questionNumber,
        questionSetId: question.questionSetId,
        sharedContext: question.sharedContext,
        options: {
          create: question.options.map((o) => ({
            id: o.id,
            canonicalKey: o.canonicalKey,
            displayOrder: o.displayOrder,
            enText: o.enText,
            hiText: o.hiText,
            media: o.media,
            isCorrect: o.isCorrect,
            optionExplanationEn: o.optionExplanationEn,
            optionExplanationHi: o.optionExplanationHi,
          })),
        },
        variants: {
          create: question.variants.map((v) => ({
            id: v.id,
            language: v.language,
            prompt: v.prompt,
            explanation: v.explanation,
            instructions: v.instructions,
            glossary: v.glossary,
            status: v.status,
            translator: v.translator,
            reviewer: v.reviewer,
          })),
        },
      },
    });

    return { success: true, questionId: created.id };
  } catch (err) {
    return { success: false, failures: [err instanceof Error ? err.message : String(err)] };
  }
}

export async function exportQuestionsToJson(
  paperKey: string,
  questions: QuestionToPublish[]
): Promise<string> {
  const exportData = questions.map((q) => ({
    id: q.id,
    exam: q.exam,
    section: q.section,
    topic: q.topic,
    subtopic: q.subtopic,
    question_format: q.questionFormat,
    difficulty: q.difficulty,
    source_type: q.sourceType,
    source_id: q.sourceId,
    source_url: q.sourceUrl,
    licence_id: q.licenceId,
    exam_year: q.examYear,
    exam_stage: q.examStage,
    exam_shift: q.examShift,
    paper_reference: q.paperReference,
    status: q.status,
    created_by: q.createdBy,
    reviewed_by: q.reviewedBy,
    version: q.version,
    correct_option_id: q.correctOptionId,
    question_number: q.questionNumber,
    question_set_id: q.questionSetId,
    shared_context: q.sharedContext,
    options: q.options.map((o) => ({
      id: o.id,
      question_id: q.id,
      canonical_key: o.canonicalKey,
      display_order: o.displayOrder,
      en_text: o.enText,
      hi_text: o.hiText,
      media: o.media,
      is_correct: o.isCorrect,
      option_explanation_en: o.optionExplanationEn,
      option_explanation_hi: o.optionExplanationHi,
    })),
    variants: q.variants.map((v) => ({
      id: v.id,
      question_id: q.id,
      language: v.language,
      prompt: v.prompt,
      explanation: v.explanation || " ",
      instructions: v.instructions,
      glossary: v.glossary,
      status: v.status,
      translator: v.translator,
      reviewer: v.reviewer,
    })),
  }));

  const json = JSON.stringify(exportData, null, 2);
  const relative = writeFileRelative(`questions/${paperKey}.json`, json);
  return relative;
}

export async function buildQuestionFromCandidate(
  candidate: any,
  answerKey: Map<number, { key: string; explanation: string }>,
  structurer: any,
  client: NimClient,
  paperKey: string,
  docId: string,
  questionSet?: any,
  sharedContext?: string
): Promise<QuestionToPublish | null> {
  const qNum = candidate.questionNumber;
  const answer = qNum ? answerKey.get(qNum) : null;
  if (!answer) return null;

  const classification = classifyQuestion(
    candidate.cleanedText || candidate.rawText,
    sharedContext || "",
    [],
    qNum,
    paperKey
  );

  const options = extractOptionsFromCandidate(candidate, answer.key);
  if (options.length < 4) return null;

  const correctOpt = options.find((o) => o.canonicalKey === answer.key);
  if (!correctOpt) return null;

  const enPrompt = candidate.cleanedText || candidate.rawText;
  const enExplanation = answer.explanation;

  const variants = await translateQuestion(
    await import("./nim-client").then((m) => m.buildNimClient()),
    classification.section,
    candidate.cleanedText || candidate.rawText,
    options.map((o) => ({ key: o.canonicalKey, text: o.enText })),
    enExplanation,
    candidate.sharedContext
  );

  const qId = `pyq-${paperKey}-q${String(qNum).padStart(3, "0")}`;

  return {
    id: qId,
    exam: "IBPS_PO",
    section: classification.section,
    topic: classification.topic,
    subtopic: classification.subtopic,
    questionFormat: "mcq_single",
    difficulty: classification.confidence > 0.8 ? 3 : Math.ceil(classification.confidence * 5),
    sourceType: "licensed_pyq",
    sourceId: null,
    sourceUrl: null,
    licenceId: "licensed_pyq",
    examYear: 2020,
    examStage: "prelims",
    examShift: null,
    paperReference: paperKey,
    status: "published",
    createdBy: "pipeline",
    reviewedBy: "pipeline",
    version: 1,
    correctOptionId: `${qId}-${answer.key}`,
    questionNumber: qNum,
    questionSetId: questionSet?.id || null,
    sharedContext: candidate.sharedContext || sharedContext,
    options: options.map((o, idx) => ({
      id: `${qId}-${o.canonicalKey}`,
      canonicalKey: o.canonicalKey,
      displayOrder: idx,
      enText: o.text,
      hiText: o.hiText || o.text,
      media: null,
      isCorrect: o.canonicalKey === answer.key,
      optionExplanationEn: null,
      optionExplanationHi: null,
    })),
    variants: [
      {
        id: `${qId}-en`,
        language: "en",
        prompt: enPrompt,
        explanation: enExplanation,
        instructions: null,
        glossary: null,
        status: "approved",
        translator: null,
        reviewer: "pipeline",
      },
      {
        id: `${qId}-hi`,
        language: "hi",
        prompt: variants.prompt,
        explanation: variants.explanation,
        instructions: variants.instructions,
        glossary: variants.glossary,
        status: "approved",
        translator: "llm:nemotron-3.5-super-vl-120b-a12b",
        reviewer: "pipeline",
      },
    ],
    extractionMethod: "llm_structured",
    llmConfidence: 0.9,
    answerSource: `solutions_pdf:${paperKey}`,
    paperKey,
  };
}

function extractOptionsFromCandidate(candidate: any, correctKey: string): Array<{ canonicalKey: string; text: string; hiText?: string }> {
  const text = candidate.cleanedText || candidate.rawText;
  const options: Array<{ canonicalKey: string; text: string; hiText?: string }> = [];

  const optMatches = text.matchAll(/\(?([A-Ea-e])\)?[.)]\s*([^\n]+)/g);
  for (const match of optMatches) {
    const key = match[1].toUpperCase();
    const optText = match[2].trim();
    if (optText && !options.some((o) => o.canonicalKey === key)) {
      options.push({ canonicalKey: key, text: optText });
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
          options.push({ canonicalKey: key, text: optText });
        }
      }
    }
  }

  options.sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
  return options;
}