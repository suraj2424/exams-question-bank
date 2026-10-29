export type DocumentProgress = {
  phase: string | null;
  percent: number | null;
  message: string | null;
  page: number | null;
  totalPages: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
};

export type DocumentStorage = {
  relativePath: string | null;
  absolutePath: string | null;
  exists: boolean;
  bytes: number | null;
};

export type DocumentCounts = {
  questions: number;
  published: number;
  answered: number;
  answersFound: number;
  sets: number;
  warnings: number;
};

export type DocumentListItem = {
  jobId: string;
  paperId: string | null;
  paperKey: string | null;
  documentId: string | null;
  title: string;
  fileName: string;
  sourceUrl: string | null;
  status: string;
  stage: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  progress: DocumentProgress | null;
  storage: DocumentStorage;
  sha256: string | null;
  pages: number | null;
  parseMethod: string | null;
  counts: DocumentCounts;
};

export type DocumentOption = {
  key: string;
  text: string;
  isCorrect: boolean;
};

export type DocumentQuestion = {
  id: string;
  number: number | null;
  section: string;
  topic: string;
  subtopic: string;
  difficulty: number;
  status: string;
  prompt: string;
  explanation: string;
  sharedContext: string | null;
  page: number | null;
  answerKey: string | null;
  answerText: string | null;
  setId: string | null;
  setQuestions: number[];
  options: DocumentOption[];
};

export type DocumentSet = {
  id: string;
  groupId: string;
  type: string | null;
  sharedContext: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  questionNumbers: number[];
};

export type DocumentCategory = {
  section: string;
  questions: number;
  topics: Array<{ topic: string; questions: number; items: DocumentQuestion[] }>;
};

export type DocumentDetail = {
  job: {
    jobId: string;
    status: string;
    stage: string | null;
    error: string | null;
    progress: DocumentProgress | null;
    stats: Record<string, any> | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  paper: {
    id: string;
    paperKey: string;
    title: string | null;
    pageCount: number | null;
    totalQuestions: number;
    answeredQuestions: number;
    status: string;
  } | null;
  document: {
    id: string;
    url: string;
    storage: DocumentStorage;
    sha256: string;
    pageCount: number | null;
    parseMethod: string | null;
    fetchedAt: string;
  } | null;
  sets: DocumentSet[];
  categories: DocumentCategory[];
  questions: DocumentQuestion[];
};

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function statusStamp(status: string): { label: string; tone: string } {
  switch (status) {
    case "completed":
      return { label: "PARSED", tone: "stamp-jade" };
    case "running":
      return { label: "PARSING", tone: "stamp-ink" };
    case "queued":
      return { label: "QUEUED", tone: "stamp-muted" };
    case "failed":
      return { label: "FAILED", tone: "stamp-vermilion" };
    default:
      return { label: status.toUpperCase(), tone: "stamp-muted" };
  }
}
