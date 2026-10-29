import { AiAnswer, AiQuestion } from "./extract";

export interface NormalizedOption {
  key: string;
  text: string;
}

export interface NormalizedQuestion {
  number: number;
  stem: string;
  options: NormalizedOption[];
  sharedContext: string | null;
  section: string | null;
  topic: string | null;
  page: number | null;
  flags: string[];
}

export interface NormalizedAnswer {
  number: number;
  key: string;
  explanation: string | null;
  page: number | null;
}

export interface JoinEntry {
  questionNumber: number;
  key: string;
  optionKey: string | null;
  status: "matched" | "missing_option";
}

export interface JoinResult {
  entries: JoinEntry[];
  matched: number;
  missingOption: number;
  questionsWithoutAnswer: number[];
  answersWithoutQuestion: number[];
}

const OPTION_KEYS = new Set(["A", "B", "C", "D", "E"]);

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

export function normalizeQuestions(raw: AiQuestion[]): {
  questions: NormalizedQuestion[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const byNumber = new Map<number, NormalizedQuestion>();

  for (const item of raw ?? []) {
    const number = Number(item?.number);
    if (!Number.isInteger(number) || number <= 0) {
      warnings.push(`skipped question with invalid number: ${JSON.stringify(item?.number)}`);
      continue;
    }

    const stem = cleanText(item?.stem);
    if (!stem) {
      warnings.push(`Q${number}: empty stem, skipped`);
      continue;
    }

    const optionMap = new Map<string, string>();
    for (const opt of item?.options ?? []) {
      const key = cleanText(opt?.key).toUpperCase().replace(/[^A-E]/g, "");
      const text = cleanText(opt?.text);
      if (!key || !text) continue;
      if (!OPTION_KEYS.has(key)) continue;
      const existing = optionMap.get(key);
      if (!existing || text.length > existing.length) optionMap.set(key, text);
    }

    const options = [...optionMap.entries()]
      .map(([key, text]) => ({ key, text }))
      .sort((a, b) => a.key.localeCompare(b.key));

    const flags: string[] = [];
    if (options.length < 4) flags.push("options_incomplete");
    if (options.length > 5) flags.push("options_overflow");

    const question: NormalizedQuestion = {
      number,
      stem,
      options,
      sharedContext: cleanText(item?.sharedContext) || null,
      section: cleanText(item?.section) || null,
      topic: cleanText(item?.topic) || null,
      page: typeof item?.page === "number" ? item.page : null,
      flags,
    };

    const existing = byNumber.get(number);
    if (!existing) {
      byNumber.set(number, question);
      continue;
    }

    const better =
      question.options.length > existing.options.length ||
      (question.options.length === existing.options.length && question.stem.length > existing.stem.length);

    if (better) {
      byNumber.set(number, question);
      warnings.push(`Q${number}: duplicate question number, kept the more complete one`);
    } else {
      warnings.push(`Q${number}: duplicate question number, kept the more complete one`);
    }
  }

  const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);
  return { questions, warnings };
}

export function normalizeAnswers(raw: AiAnswer[]): {
  answers: NormalizedAnswer[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const byNumber = new Map<number, NormalizedAnswer>();

  for (const item of raw ?? []) {
    const number = Number(item?.number);
    if (!Number.isInteger(number) || number <= 0) {
      warnings.push(`skipped answer with invalid question number: ${JSON.stringify(item?.number)}`);
      continue;
    }

    const key = cleanText(item?.key).toUpperCase().replace(/[^A-E]/g, "");
    if (!key) {
      warnings.push(`Q${number}: answer letter missing or invalid, skipped`);
      continue;
    }

    const existing = byNumber.get(number);
    if (existing) {
      if (existing.key !== key) {
        warnings.push(`Q${number}: conflicting answer letters (${existing.key} and ${key}), kept ${existing.key}`);
      } else {
        warnings.push(`Q${number}: duplicate answer row, ignored`);
      }
      continue;
    }

    byNumber.set(number, {
      number,
      key,
      explanation: cleanText(item?.explanation) || null,
      page: typeof item?.page === "number" ? item.page : null,
    });
  }

  const answers = [...byNumber.values()].sort((a, b) => a.number - b.number);
  return { answers, warnings };
}

export interface ConnectedGroup {
  key: string;
  sharedContext: string;
  questionNumbers: number[];
}

function contextKey(context: string): string {
  return context.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Questions that share the same directions / passage / data block are "connected":
 * they belong to one set and must be answered against the same context.
 */
export function groupBySharedContext(questions: NormalizedQuestion[]): ConnectedGroup[] {
  const groups = new Map<string, ConnectedGroup>();

  for (const question of questions) {
    if (!question.sharedContext) continue;
    const key = contextKey(question.sharedContext);
    if (!key) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.questionNumbers.push(question.number);
    } else {
      groups.set(key, {
        key,
        sharedContext: question.sharedContext,
        questionNumbers: [question.number],
      });
    }
  }

  return [...groups.values()]
    .filter((group) => group.questionNumbers.length > 1)
    .sort((a, b) => a.questionNumbers[0] - b.questionNumbers[0]);
}

export function joinAnswers(
  questions: NormalizedQuestion[],
  answers: NormalizedAnswer[],
): JoinResult {
  const answerMap = new Map(answers.map((a) => [a.number, a]));
  const questionNumbers = new Set(questions.map((q) => q.number));

  const entries: JoinEntry[] = [];
  const questionsWithoutAnswer: number[] = [];

  for (const question of questions) {
    const answer = answerMap.get(question.number);
    if (!answer) {
      questionsWithoutAnswer.push(question.number);
      continue;
    }
    const optionKey = question.options.some((o) => o.key === answer.key) ? answer.key : null;
    entries.push({
      questionNumber: question.number,
      key: answer.key,
      optionKey,
      status: optionKey ? "matched" : "missing_option",
    });
  }

  const answersWithoutQuestion = answers
    .filter((a) => !questionNumbers.has(a.number))
    .map((a) => a.number);

  return {
    entries,
    matched: entries.filter((e) => e.status === "matched").length,
    missingOption: entries.filter((e) => e.status === "missing_option").length,
    questionsWithoutAnswer,
    answersWithoutQuestion,
  };
}
