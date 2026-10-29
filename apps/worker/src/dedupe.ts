import { prisma } from "@qb/db";
import { env } from "./config";
import { embedTextsBatched, cosineSimilarity } from "./embedding";

export interface DupPair {
  id: string;
  duplicateId: string;
  similarity: number;
  sourceDocumentId: string;
  duplicateSourceDocumentId: string;
  rawText: string;
  duplicateRawText: string;
}

function threshold(): number {
  return Number(env("DEDUP_SIMILARITY_THRESHOLD", "0.85")) || 0.85;
}

export async function findNearDuplicates(
  sourceId?: string,
): Promise<DupPair[]> {
  const where: any = {
    status: "pending_review",
    embedding: { not: null },
  };
  if (sourceId) where.sourceDocument = { sourceId };

  const rows = await prisma.questionCandidate.findMany({
    where,
    include: { sourceDocument: true },
    orderBy: { createdAt: "asc" },
  });

  const texts = rows.map((r) => r.rawText);
  const vecs = await embedTextsBatched(texts, 8);

  const pairs: DupPair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const sim = cosineSimilarity(vecs[i], vecs[j]);
      if (sim >= threshold()) {
        const a = rows[i];
        const b = rows[j];
        const key = `${a.id}:${b.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          id: a.id,
          duplicateId: b.id,
          similarity: sim,
          sourceDocumentId: a.sourceDocumentId,
          duplicateSourceDocumentId: b.sourceDocumentId,
          rawText: a.rawText,
          duplicateRawText: b.rawText,
        });
      }
    }
  }

  return pairs;
}

export async function markDuplicatesRejected(
  pairs: DupPair[],
): Promise<{ marked: number }> {
  let marked = 0;
  for (const p of pairs) {
    await prisma.questionCandidate.update({
      where: { id: p.duplicateId },
      data: { status: "rejected", rejectionReason: `near-duplicate of ${p.id} (similarity ${p.similarity.toFixed(3)})` },
    });
    marked++;
  }
  return { marked };
}

export async function dedupePending(sourceId?: string): Promise<{
  pairs: number;
  marked: number;
}> {
  const pairs = await findNearDuplicates(sourceId);
  const { marked } = await markDuplicatesRejected(pairs);
  return { pairs: pairs.length, marked };
}

export async function findSimilarToText(
  text: string,
  sourceId?: string,
  limit: number = 10,
): Promise<Array<{ id: string; similarity: number; rawText: string; sourceDocumentId: string }>> {
  const where: any = {
    status: { in: ["pending_review", "approved"] },
    embedding: { not: null },
  };
  if (sourceId) where.sourceDocument = { sourceId };

  const rows = await prisma.questionCandidate.findMany({
    where,
    include: { sourceDocument: true },
  });

  if (rows.length === 0) return [];

  const vecs = await embedTextsBatched([text, ...rows.map((r) => r.rawText)], 8);
  const queryVec = vecs[0];
  const scored = rows.map((r, idx) => ({
    id: r.id,
    similarity: cosineSimilarity(queryVec, vecs[idx + 1]),
    rawText: r.rawText,
    sourceDocumentId: r.sourceDocumentId,
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
