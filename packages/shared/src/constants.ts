export const EXAMS = ["IBPS_PO", "IBPS_RRB_PO"] as const;
export type Exam = (typeof EXAMS)[number];

export const SECTIONS = ["English Language", "Quantitative Aptitude", "Reasoning Ability"] as const;
export type Section = (typeof SECTIONS)[number];

export const LANGUAGES = ["en", "hi"] as const;
export type Language = (typeof LANGUAGES)[number];

export const QUESTION_FORMATS = ["mcq_single"] as const;
export type QuestionFormat = (typeof QUESTION_FORMATS)[number];

export const SOURCE_TYPES = ["original_exam_pattern", "licensed_pyq", "owned", "public_domain"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const STATUSES = ["draft", "in_review", "published", "archived"] as const;
export type QuestionStatus = (typeof STATUSES)[number];

export const VARIANT_STATUSES = ["draft", "needs_human_review", "approved"] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const CANDIDATE_STATUSES = ["pending_review", "approved", "rejected", "link_only"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const SOURCE_STATUSES = ["pending", "approved", "rejected"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const DIFFICULTIES = [1, 2, 3, 4, 5] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const OPTION_KEYS = ["A", "B", "C", "D", "E"] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const DEFAULT_SESSION_SIZE = 80;
export const DEFAULT_SECTION_COUNTS: Record<string, number> = {
  "Quantitative Aptitude": 40,
  "Reasoning Ability": 40,
};
