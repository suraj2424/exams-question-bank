import { prisma } from "@qb/db";
import { writeFileRelative } from "./storage";
import { runCrawl } from "./crawler";
import { extractPendingDocuments } from "./extraction";
import { config } from "./config";

export interface PipelineOptions {
  sourceId?: string;
  maxPages?: number;
  delayMs?: number;
  timeoutMs?: number;
  crawlOnly?: boolean;
  parseOnly?: boolean;
  exportOnly?: boolean;
  outDir?: string;
}

export interface PipelineResult {
  sources: number;
  crawlRuns: number;
  documentsParsed: number;
  questionSets: number;
  questions: number;
  exportedFiles: string[];
}

function sourceToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function buildVariant(questionId: string, lang: "en" | "hi", prompt: string): any {
  return {
    id: `${questionId}-variant-${lang}`,
    question_id: questionId,
    language: lang,
    prompt,
    explanation: "",
    instructions: null,
    glossary: null,
    status: "draft",
    translator: null,
    reviewer: null,
  };
}

const OPTION_LINE_RE = /^(?:\s*)(?:\(?([A-Ea-e])\)?(?:\u002e|\u0029)?|\(([a-e])\)|(\d{1,2})(?:\u002e|\u0029))\s+(.+)/;
const QUESTION_NUMBER_RE = /^(?:\s*)(?:Q(?:\u002e)?\s*)?(\d{1,3})(?:\u002e|\u0029|:|\u002d|\s)(.+)/s;

function extractOptionsFromText(rawText: string): { questionText: string; options: string[] } {
  const lines = rawText.split(/\n+/);
  const questionLines: string[] = [];
  const options: string[] = [];
  let inOptions = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isQuestionNumber = QUESTION_NUMBER_RE.test(trimmed);
    const m = OPTION_LINE_RE.exec(trimmed);
    if (m && !isQuestionNumber) {
      inOptions = true;
      let optionText = (m[4] || "").trim();
      optionText = optionText.split(/\s+directions?\s*\(/i)[0].trim();
      if (optionText) options.push(optionText);
    } else if (inOptions && /^[\(]?[a-e][\)]?\s*/i.test(trimmed)) {
      if (/^\s*directions?\s*\(/i.test(trimmed)) break;
      options.push(trimmed.replace(/^[\(]?[a-e][\)]?\s*/i, ""));
    } else {
      if (!inOptions) {
        questionLines.push(trimmed);
      }
    }
  }

  const qt = questionLines.join(" ").trim();
  return { questionText: qt, options };
}

export async function runPipeline(opts: PipelineOptions = {}): Promise<PipelineResult> {
  const where: any = {};
  if (opts.sourceId) where.id = opts.sourceId;
  where.allowedToIngestText = true;
  where.status = "approved";

  const sources = await prisma.source.findMany({ where });

  let crawlRuns = 0;
  let documentsParsed = 0;
  let questionsCount = 0;
  let questionSetsCount = 0;
  const exportedFiles: string[] = [];

  const outDir = opts.outDir || "questions";

  for (const source of sources) {
    if (!opts.parseOnly && !opts.exportOnly) {
      const seedUrl = source.baseUrl;
      if (seedUrl) {
        try {
          await runCrawl(source.id, seedUrl, {
            maxPages: opts.maxPages ?? config.maxPages,
            delayMs: opts.delayMs ?? config.delayMs,
            timeoutMs: opts.timeoutMs ?? config.timeoutMs,
          });
          crawlRuns++;
        } catch (err) {
          console.error(`Crawl failed for source ${source.id} (${source.name}):`, err);
        }
      }
    }

    if (!opts.crawlOnly && !opts.exportOnly) {
      const r = await extractPendingDocuments(source.id);
      documentsParsed += r.processed;
    }

    const docs = await prisma.fetchedDocument.findMany({
      where: { sourceId: source.id, extractionStatus: "completed" },
      include: {
        candidates: {
          include: { questionSet: true },
          orderBy: [{ questionSetId: "asc" }, { questionNumber: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    const slug = sourceToSlug(source.name);
    const setsByGroup = new Map<string, { set: any; candidates: any[] }>();
    const independent: any[] = [];

    for (const doc of docs) {
      for (const cand of doc.candidates) {
        if (cand.isSharedContext) continue;
        if (cand.questionSetId && cand.questionSet) {
          const qs = cand.questionSet;
          let entry = setsByGroup.get(qs.groupId);
          if (!entry) {
            entry = { set: qs, candidates: [] };
            setsByGroup.set(qs.groupId, entry);
            questionSetsCount++;
          }
          entry.candidates.push({ ...cand, sourceUrl: doc.url });
        } else {
          independent.push({ ...cand, sourceUrl: doc.url });
        }
      }
    }

    const setEntries: any[] = [];
    for (const [groupId, entry] of setsByGroup) {
      const { set, candidates } = entry;
      const qList = candidates.map((c) => {
        const { questionText, options } = extractOptionsFromText(c.rawText);
        return {
          id: c.id,
          number: c.questionNumber,
          text: questionText || c.rawText,
          options,
          correctOptionId: null,
          confidence: c.extractionConfidence,
          flags: c.extractionFlags,
          sourceUrl: c.sourceUrl,
          shared_context: set.sharedContext || "",
          questionSetId: set.groupId,
        };
      });
      setEntries.push({
        group_id: set.groupId,
        type: set.type || "connected_set",
        shared_context: set.sharedContext || "",
        page_start: set.pageStart,
        page_end: set.pageEnd,
        confidence: set.confidence,
        questions: qList,
      });
      questionsCount += candidates.length;
    }

    const indepEntries = independent.map((c) => {
      const { questionText, options } = extractOptionsFromText(c.rawText);
      return {
        id: c.id,
        number: c.questionNumber,
        text: questionText || c.rawText,
        rawText: c.rawText,
        questionSetId: c.questionSetId,
        sharedContext: null,
        exam: "IBPS_PO",
        section: "General",
        topic: "Crawled",
        subtopic: "Auto-extracted",
        question_format: "mcq_single",
        difficulty: 3,
        source_type: "licensed_pyq",
        source_id: source.id,
        source_url: c.sourceUrl,
        licence_id: null,
        exam_year: null,
        exam_stage: null,
        exam_shift: null,
        paper_reference: null,
        status: "pending_review",
        created_by: "pipeline",
        reviewed_by: null,
        version: 1,
        correct_option_id: null,
        options: options.map((o, i) => {
          const key = String.fromCharCode(65 + i);
          return {
            id: `${c.id}-opt-${key}`,
            question_id: c.id,
            canonical_key: key,
            display_order: i,
            en_text: o,
            hi_text: o,
            media: null,
            is_correct: false,
            option_explanation_en: null,
            option_explanation_hi: null,
          };
        }),
        variants: [
          buildVariant(c.id, "en", questionText || c.rawText),
          buildVariant(c.id, "hi", questionText || c.rawText),
        ],
      };
    });
    questionsCount += independent.length;

    const out = {
      source: source.name,
      sourceId: source.id,
      exportedAt: new Date().toISOString(),
      questionSets: setEntries,
      questions: indepEntries,
    };

    const fileName = `crawled_${slug}.json`;
    const relative = writeFileRelative(`${outDir}/${fileName}`, JSON.stringify(out, null, 2));
    exportedFiles.push(relative);
  }

  return {
    sources: sources.length,
    crawlRuns,
    documentsParsed,
    questionSets: questionSetsCount,
    questions: questionsCount,
    exportedFiles,
  };
}

export async function listApprovedSources(): Promise<any[]> {
  return prisma.source.findMany({
    where: { allowedToIngestText: true, status: "approved" },
    orderBy: { name: "asc" },
  });
}