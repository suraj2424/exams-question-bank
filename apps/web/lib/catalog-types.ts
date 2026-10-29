export type CatalogSection = {
  name: string;
  count: number;
};

export type CatalogTopic = {
  name: string;
  section: string;
  count: number;
};

export type CatalogPaper = {
  paperKey: string;
  title: string | null;
  count: number;
};

export type PracticeCatalog = {
  sections: CatalogSection[];
  topics: CatalogTopic[];
  papers: CatalogPaper[];
  documents: number;
  totalQuestions: number;
};

export type SessionFilters = {
  section?: string;
  topic?: string;
  paperKey?: string;
  size?: number;
};
