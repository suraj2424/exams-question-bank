export type Variant = {
  language: string;
  prompt: string;
  explanation: string;
  instructions?: string | null;
  glossary?: any;
};

export type Option = {
  id: string;
  canonical_key: string;
  display_order: number;
  en_text: string;
  hi_text: string;
};

export type QuestionMedia = {
  id: string;
  kind?: string | null;
  mimeType?: string | null;
  storagePath?: string | null;
  description?: string | null;
};

export type Question = {
  id: string;
  section: string;
  topic: string;
  difficulty: number;
  questionNumber?: number | null;
  questionSetId?: string | null;
  sharedContext?: string | null;
  options: Option[];
  variants: Variant[];
  questionSet?: {
    id: string;
    sharedContext?: string | null;
    media?: QuestionMedia[] | null;
  } | null;
};

export type Revealed = {
  selected_option_id: string;
  correct_option_id: string;
  is_correct: boolean;
  explanations: Record<string, string>;
};

export type AnswerRow = {
  index: number;
  questionId: string;
  selectedKey: string | null;
  correctKey: string | null;
  isCorrect: boolean;
};

export type SessionState = {
  id: string;
  total: number;
  currentIndex: number;
  score: number;
  completed: boolean;
  currentQuestion: Question | null;
  revealed: Revealed | null;
  answers: AnswerRow[];
};

export function optionKey(options: { id: string }[], optionId: string | null | undefined): string | null {
  if (!optionId) return null;
  const idx = options.findIndex((o) => o.id === optionId);
  return idx >= 0 ? String.fromCharCode(65 + idx) : null;
}

export function difficultyLabel(difficulty: number, labels: { easy: string; medium: string; hard: string }): string {
  if (difficulty <= 2) return labels.easy;
  if (difficulty === 3) return labels.medium;
  return labels.hard;
}
