import { NimClient } from "../nim-client";
import { RagPage } from "./pdf";

export interface AiOption {
  key: string;
  text: string;
}

export interface AiQuestion {
  number: number;
  stem: string;
  options: AiOption[];
  sharedContext?: string | null;
  section?: string | null;
  topic?: string | null;
  page?: number | null;
}

export interface AiAnswer {
  number: number;
  key: string;
  page?: number | null;
  explanation?: string | null;
}

export interface ExtractionProgress {
  page?: number;
  totalPages?: number;
  phase?: string;
}

export interface ExtractionOptions {
  pagesPerCall?: number;
  includeImages?: boolean;
  maxPages?: number;
  onProgress?: (message: string, detail?: ExtractionProgress) => void;
}

const QUESTION_SYSTEM_PROMPT = `You extract exam questions from pages of Indian banking exam papers (IBPS PO / RRB PO).

Return JSON ONLY, no markdown:
{
  "questions": [
    {
      "number": 1,
      "stem": "the full question text",
      "options": [{ "key": "A", "text": "option text" }],
      "sharedContext": "the Directions / passage / table context this question belongs to, or null",
      "section": "English Language | Quantitative Aptitude | Reasoning Ability | null",
      "topic": "short topic label or null",
      "page": 1
    }
  ]
}

Rules:
1. Extract EVERY question visible on the given pages. If a question starts on the previous page and continues here, still include it.
2. "number" is the printed question number (Q1, Q.1, 1. -> 1).
3. "options" must contain the options exactly as printed, in printed order, keyed A, B, C, D, E. Merge an option split across lines into one string.
4. Copy "sharedContext" verbatim from the Directions / passage / data block that applies to the question. Use null when there is none.
5. Never invent, reorder or drop options. If an option is missing on the page, omit it rather than guessing.
6. Ignore page headers, footers, page numbers, watermarks and advertisements.
7. Answer-key tables are NOT questions. Skip rows like "1. (B) 2. (C)" that only list answers.
8. If a page contains no question, return an empty "questions" array for it.`;

const ANSWER_SYSTEM_PROMPT = `You extract the answer key / answer table from pages of an Indian banking exam paper.

Return JSON ONLY, no markdown:
{
  "answers": [
    { "number": 1, "key": "B", "page": 12, "explanation": null }
  ]
}

Rules:
1. The answer table maps question numbers to a single option letter, e.g. "Q1 (B)", "1. C", "1) b", or a two column table "Q.No | Answer".
2. "key" must be exactly one letter from A to E (uppercase).
3. "number" is the question number the answer belongs to, as printed.
4. If the table is split by section (English 1-35, Quant 36-70, Reasoning 71-100), keep the printed numbers of each row.
5. "explanation" holds the short solution text only when one is printed next to that answer, otherwise null.
6. Never output question options as answers. If the pages contain no answer table, return an empty "answers" array.`;

function pageTextBlock(page: RagPage): string {
  return `--- PAGE ${page.pageNumber} ---\n${page.text.trim() || "(no extractable text on this page)"}`;
}

function buildPageMessages(pages: RagPage[], system: string, includeImages: boolean): any[] {
  const content: any[] = [];
  for (const page of pages) {
    content.push({ type: "text", text: pageTextBlock(page) });
    if (includeImages && page.imagePng) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${page.imagePng.toString("base64")}` },
      });
    }
  }
  return [
    { role: "system", content: system },
    { role: "user", content },
  ];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function callJson<T>(client: NimClient, messages: any[], maxTokens: number): Promise<T | null> {
  try {
    return await client.chatJson<T>(messages, {
      maxTokens,
      responseFormat: { type: "json_object" },
      enableThinking: false,
    });
  } catch (err) {
    console.error("[rag] extraction call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function extractQuestionsWithAi(
  client: NimClient,
  pages: RagPage[],
  opts: ExtractionOptions = {},
): Promise<{ questions: AiQuestion[]; warnings: string[] }> {
  const warnings: string[] = [];
  const questions: AiQuestion[] = [];
  const perCall = opts.pagesPerCall ?? 3;
  const includeImages = opts.includeImages !== false;
  const limit = opts.maxPages ?? pages.length;

  for (const batch of chunk(pages.slice(0, limit), perCall)) {
    const first = batch[0].pageNumber;
    const last = batch[batch.length - 1].pageNumber;
    opts.onProgress?.(`extracting questions from pages ${first}-${last}`, {
      page: last,
      totalPages: limit,
      phase: "questions",
    });

    const result = await callJson<{ questions?: AiQuestion[] }>(
      client,
      buildPageMessages(batch, QUESTION_SYSTEM_PROMPT, includeImages),
      16384,
    );
    if (!result) {
      warnings.push(`pages ${first}-${last}: extraction call failed`);
      continue;
    }
    for (const q of result.questions ?? []) {
      if (typeof q?.number === "number" && typeof q?.stem === "string") {
        questions.push({ ...q, page: q.page ?? first });
      }
    }
  }

  return { questions, warnings };
}

export async function extractAnswersWithAi(
  client: NimClient,
  pages: RagPage[],
  opts: ExtractionOptions = {},
): Promise<{ answers: AiAnswer[]; warnings: string[] }> {
  const warnings: string[] = [];
  const answers: AiAnswer[] = [];
  const perCall = opts.pagesPerCall ?? 4;
  const includeImages = opts.includeImages !== false;

  for (const batch of chunk(pages, perCall)) {
    const first = batch[0].pageNumber;
    const last = batch[batch.length - 1].pageNumber;
    opts.onProgress?.(`extracting answer table from pages ${first}-${last}`, {
      page: last,
      totalPages: pages.length,
      phase: "answers",
    });

    const result = await callJson<{ answers?: AiAnswer[] }>(
      client,
      buildPageMessages(batch, ANSWER_SYSTEM_PROMPT, includeImages),
      8192,
    );
    if (!result) {
      warnings.push(`pages ${first}-${last}: answer extraction call failed`);
      continue;
    }
    for (const a of result.answers ?? []) {
      if (typeof a?.number === "number" && typeof a?.key === "string") {
        answers.push({ ...a, page: a.page ?? first });
      }
    }
  }

  return { answers, warnings };
}

const EXPLANATION_SYSTEM_PROMPT = `You write short exam solutions for banking exam questions.

Return JSON ONLY, no markdown:
{
  "solutions": [ { "number": 1, "explanation": "2-3 sentences explaining why the correct option is correct" } ]
}

Rules:
1. Use only the question, its options and the correct option key that are given.
2. Keep the explanation factual and short (max 3 sentences).
3. Return one entry per given question number, nothing else.`;

export async function extractExplanationsWithAi(
  client: NimClient,
  items: Array<{ number: number; stem: string; options: Array<{ key: string; text: string }>; correctKey: string }>,
  opts: ExtractionOptions = {},
): Promise<{ explanations: Map<number, string>; warnings: string[] }> {
  const warnings: string[] = [];
  const explanations = new Map<number, string>();
  const perCall = opts.pagesPerCall ?? 5;

  for (let i = 0; i < items.length; i += perCall) {
    const batch = items.slice(i, i + perCall);
    const payload = batch
      .map(
        (item) =>
          `Q${item.number}: ${item.stem}\nOptions:\n${item.options
            .map((o) => `${o.key}) ${o.text}`)
            .join("\n")}\nCorrect option: ${item.correctKey}`,
      )
      .join("\n\n");

    const result = await callJson<{ solutions?: Array<{ number: number; explanation?: string }> }>(
      client,
      [
        { role: "system", content: EXPLANATION_SYSTEM_PROMPT },
        { role: "user", content: payload },
      ],
      8192,
    );
    if (!result) {
      warnings.push(`explanation batch ${i / perCall + 1}: call failed`);
      continue;
    }
    for (const solution of result.solutions ?? []) {
      const text = typeof solution?.explanation === "string" ? solution.explanation.trim() : "";
      if (typeof solution?.number === "number" && text) explanations.set(solution.number, text);
    }
  }

  return { explanations, warnings };
}

const ANSWER_HEADING_RE =
  /(answer\s*key|key\s*of\s*answers?|correct\s*answers?|answer\s*key\s*\(|\banswers?\s*with\s*explanation|उत्तर\s*कुंजी|उत्तर\s*सूची)/i;
const ANSWER_PAIR_RE = /(?:^|\s|;|\|)(\d{1,3})\s*[.):\-]?\s*[\(\[]?([A-Ea-e])[\)\]]?(?=\s|$|\|)/g;
const QUESTION_STEM_RE = /(?:^|\s)Q\.?\s*\d{1,3}\s*[.):]/g;

export function scoreAnswerKeyPage(text: string, isTailPage: boolean): number {
  let score = 0;
  if (ANSWER_HEADING_RE.test(text)) score += 5;
  const pairs = text.match(ANSWER_PAIR_RE)?.length ?? 0;
  const stems = text.match(QUESTION_STEM_RE)?.length ?? 0;
  if (pairs - stems * 2 >= 3) score += 3;
  if (pairs >= 8) score += 2;
  if (isTailPage && pairs >= 2) score += 2;
  return score;
}

export function detectAnswerKeyPages(pages: RagPage[], tailWindow = 3): number[] {
  const scored = pages.map((page, idx) => ({
    pageNumber: page.pageNumber,
    score: scoreAnswerKeyPage(page.text, idx >= pages.length - tailWindow),
  }));
  const selected = scored.filter((s) => s.score >= 3).map((s) => s.pageNumber);
  if (selected.length > 0) return selected;
  return pages.slice(-Math.min(2, pages.length)).map((p) => p.pageNumber);
}
