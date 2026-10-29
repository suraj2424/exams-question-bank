import { prisma } from "@qb/db";
import { cosineSimilarity, embedText } from "../embedding";

export interface RagSearchOptions {
  limit?: number;
  section?: string;
  paperKey?: string;
  status?: string;
  includeAnswer?: boolean;
}

export interface RagSearchHit {
  id: string;
  questionNumber: number | null;
  paperKey: string | null;
  section: string;
  topic: string;
  subtopic: string;
  similarity: number;
  prompt: string;
  options: Array<{ key: string; text: string }>;
  correctOptionKey: string | null;
}

function vectorFromJson(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) return value as number[];
  return null;
}

export async function ragSearch(query: string, opts: RagSearchOptions = {}): Promise<RagSearchHit[]> {
  const text = query.trim();
  if (!text) return [];

  const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
  const where: any = {
    embedding: { not: null },
    status: opts.status ?? "published",
  };
  if (opts.section) where.section = opts.section;
  if (opts.paperKey) where.paperKey = opts.paperKey;

  const rows = await prisma.question.findMany({
    where,
    include: {
      options: { orderBy: { displayOrder: "asc" } },
      variants: { where: { language: "en" } },
    },
  });

  if (rows.length === 0) return [];

  const queryVector = await embedText(text.slice(0, 2000));

  const hits: RagSearchHit[] = [];
  for (const row of rows) {
    const vector = vectorFromJson(row.embedding);
    if (!vector) continue;
    const similarity = cosineSimilarity(queryVector, vector);
    const prompt = row.variants[0]?.prompt ?? "";
    hits.push({
      id: row.id,
      questionNumber: row.questionNumber,
      paperKey: row.paperKey,
      section: row.section,
      topic: row.topic,
      subtopic: row.subtopic,
      similarity,
      prompt,
      options: row.options.map((o) => ({ key: o.canonicalKey, text: o.enText })),
      correctOptionKey:
        opts.includeAnswer === false
          ? null
          : row.options.find((o) => o.id === row.correctOptionId)?.canonicalKey ?? null,
    });
  }

  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, limit);
}
