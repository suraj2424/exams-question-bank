import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { practiceSessionCreateSchema, SECTIONS } from "@qb/shared";

const bodySchema = practiceSessionCreateSchema;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickFromSection(idsBySection: Map<string, string[]>, section: string, count: number): string[] {
  const ids = idsBySection.get(section) || [];
  return shuffle(ids).slice(0, count);
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!rateLimit("session:" + ip, 20, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  }
  const { exam, size, section, paperKey, topic } = parsed.data;

  const where: Record<string, unknown> = { exam, status: "published" };
  if (section) where.section = section;
  if (paperKey) where.paperKey = paperKey;
  if (topic) where.topic = topic;

  const allQuestions = await prisma.question.findMany({
    where,
    select: { id: true, section: true },
  });

  if (allQuestions.length === 0) {
    return NextResponse.json({ error: "no published questions" }, { status: 404 });
  }

  const idsBySection = new Map<string, string[]>();
  for (const q of allQuestions) {
    const arr = idsBySection.get(q.section) || [];
    arr.push(q.id);
    idsBySection.set(q.section, arr);
  }

  let ids: string[] = [];
  const scoped = !!(paperKey || topic);
  if (scoped) {
    ids = shuffle(allQuestions.map((q) => q.id)).slice(0, size ?? 10);
  } else if (section) {
    ids = pickFromSection(idsBySection, section, size);
  } else {
    const targetSize = size ?? 10;
    const orderedSections = [
      ...SECTIONS.filter((s) => idsBySection.has(s)),
      ...[...idsBySection.keys()].filter((s) => !SECTIONS.includes(s as any)).sort(),
    ];
    const sectionCounts = new Map<string, number>();
    for (const s of orderedSections) {
      sectionCounts.set(s, Math.ceil(targetSize / orderedSections.length));
    }
    const remaining = targetSize % orderedSections.length;
    let idx = 0;
    for (const [s, count] of sectionCounts) {
      sectionCounts.set(s, count + (idx < remaining ? 1 : 0));
      idx++;
    }

    for (const [sec, count] of sectionCounts) {
      ids.push(...pickFromSection(idsBySection, sec, count));
    }
    ids = shuffle(ids).slice(0, targetSize);
  }

  if (ids.length === 0) {
    return NextResponse.json({ error: "no published questions for selected section" }, { status: 404 });
  }

  const session = await prisma.practiceSession.create({
    data: { exam, questionIds: ids, currentIndex: 0, score: 0 },
  });
  return NextResponse.json({ sessionId: session.id, total: ids.length });
}