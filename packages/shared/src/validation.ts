import { z } from "zod";
import {
  EXAMS,
  SECTIONS,
  LANGUAGES,
  QUESTION_FORMATS,
  SOURCE_TYPES,
  STATUSES,
  DIFFICULTIES,
  OPTION_KEYS,
} from "./constants";

export const examSchema = z.enum(EXAMS);
export const sectionSchema = z.enum(SECTIONS);
export const languageSchema = z.enum(LANGUAGES);
export const questionFormatSchema = z.enum(QUESTION_FORMATS);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export const statusSchema = z.enum(STATUSES);
export const difficultySchema = z.number().int().refine((v) => (DIFFICULTIES as readonly number[]).includes(v), "invalid difficulty");
export const optionKeySchema = z.enum(OPTION_KEYS);

export const questionOptionSchema = z.object({
  id: z.string().min(1),
  question_id: z.string().min(1),
  canonical_key: optionKeySchema,
  display_order: z.number().int().min(0),
  en_text: z.string().min(1),
  hi_text: z.string().min(1),
  media: z.any().nullable().optional(),
  is_correct: z.boolean(),
  option_explanation_en: z.string().nullable().optional(),
  option_explanation_hi: z.string().nullable().optional(),
});

export const questionVariantSchema = z.object({
  id: z.string().min(1),
  question_id: z.string().min(1),
  language: languageSchema,
  prompt: z.string().min(1),
  explanation: z.string().min(1),
  instructions: z.string().nullable().optional(),
  glossary: z.any().nullable().optional(),
  status: z.enum(["draft", "needs_human_review", "approved"]),
  translator: z.string().nullable().optional(),
  reviewer: z.string().nullable().optional(),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  exam: examSchema,
  section: sectionSchema,
  topic: z.string().min(1),
  subtopic: z.string().min(1),
  question_format: questionFormatSchema,
  difficulty: difficultySchema,
  source_type: sourceTypeSchema,
  source_id: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  licence_id: z.string().nullable().optional(),
  exam_year: z.number().int().nullable().optional(),
  exam_stage: z.string().nullable().optional(),
  exam_shift: z.string().nullable().optional(),
  paper_reference: z.string().nullable().optional(),
  status: statusSchema,
  created_by: z.string().min(1),
  reviewed_by: z.string().nullable().optional(),
  version: z.number().int().min(1),
  correct_option_id: z.string().min(1),
  options: z.array(questionOptionSchema).min(4).max(5),
  variants: z.array(questionVariantSchema).min(1),
});

export const practiceSessionCreateSchema = z.object({
  exam: examSchema.default("IBPS_PO"),
  size: z.number().int().min(1).max(50).default(10),
  section: z.string().min(1).optional(),
  paperKey: z.string().min(1).optional(),
  topic: z.string().min(1).optional(),
});

export const answerSubmitSchema = z.object({
  question_id: z.string().min(1),
  selected_option_id: z.string().min(1),
  language: languageSchema,
});

export type Question = z.infer<typeof questionSchema>;
export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type QuestionVariant = z.infer<typeof questionVariantSchema>;
export type PracticeSessionCreate = z.infer<typeof practiceSessionCreateSchema>;
export type AnswerSubmit = z.infer<typeof answerSubmitSchema>;

