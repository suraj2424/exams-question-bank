import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { questionSchema } from "@qb/shared";

export interface ValidationIssue {
  file: string;
  questionId?: string;
  message: string;
}

export interface ValidationResult {
  total: number;
  valid: number;
  issues: ValidationIssue[];
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectFiles(full));
    else if (st.isFile() && (extname(full) === ".json" || extname(full) === ".jsonl")) out.push(full);
  }
  return out;
}

function parseQuestionsFromFile(file: string): any[] {
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return [];
  if (file.endsWith(".jsonl")) {
    return raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  }
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  return [parsed];
}

export function validateOne(q: any, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const res = questionSchema.safeParse(q);
  if (!res.success) {
    for (const e of res.error.errors) {
      issues.push({ file, questionId: q?.id, message: `${e.path.join(".")}: ${e.message}` });
    }
    return issues;
  }
  const question = res.data;
  // correct option exists and unique
  const correct = question.options.find((o) => o.id === question.correct_option_id);
  if (!correct) issues.push({ file, questionId: question.id, message: "correct_option_id not found in options" });
  const correctCount = question.options.filter((o) => o.is_correct).length;
  if (correctCount !== 1) issues.push({ file, questionId: question.id, message: `expected exactly one is_correct option, found ${correctCount}` });
  if (correct && !correct.is_correct) issues.push({ file, questionId: question.id, message: "correct option has is_correct=false" });
  // shared option ids across languages? variants
  const langs = question.variants.map((v) => v.language);
  if (!langs.includes("en")) issues.push({ file, questionId: question.id, message: "missing en variant" });
  // English Language section: tested English should not be translated? cannot auto-check; skip
  // Quant/Reasoning require hi variant
  if ((question.section === "Quantitative Aptitude" || question.section === "Reasoning Ability") && !langs.includes("hi")) {
    issues.push({ file, questionId: question.id, message: "missing hi variant for quant/reasoning" });
  }
  // canonical keys unique
  const keys = question.options.map((o) => o.canonical_key);
  if (new Set(keys).size !== keys.length) issues.push({ file, questionId: question.id, message: "duplicate canonical_key" });
  return issues;
}

export function validateQuestions(path: string): ValidationResult {
  const files = collectFiles(path);
  let total = 0;
  let valid = 0;
  const issues: ValidationIssue[] = [];
  for (const f of files) {
    let qs: any[] = [];
    try {
      qs = parseQuestionsFromFile(f);
    } catch (err) {
      issues.push({ file: f, message: `parse error: ${String(err)}` });
      continue;
    }
    for (const q of qs) {
      total++;
      const is = validateOne(q, f);
      if (is.length === 0) valid++;
      issues.push(...is);
    }
  }
  return { total, valid, issues };
}

export function defaultQuestionPaths(): string[] {
  return ["storage/questions", "data/questions", "seeds", "seed/questions", "questions"];
}

export function validateQuestion(q: any, file: string = '<memory>') { return validateOne(q, file); }

export const validateSingleQuestion = validateOne;
