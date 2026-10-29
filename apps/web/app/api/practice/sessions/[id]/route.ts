import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

function stripQuestion(q: any) {
  return {
    id: q.id,
    section: q.section,
    topic: q.topic,
    subtopic: q.subtopic,
    difficulty: q.difficulty,
    questionNumber: q.questionNumber,
    questionSetId: q.questionSetId,
    sharedContext: q.sharedContext,
    sourcePage: q.sourcePage,
    paperReference: q.paperReference,
    options: q.options.map((o: any) => ({
      id: o.id,
      canonical_key: o.canonicalKey,
      display_order: o.displayOrder,
      en_text: o.enText,
      hi_text: o.hiText,
    })),
    variants: q.variants.map((v: any) => ({
      language: v.language,
      prompt: v.prompt,
      explanation: v.explanation,
      instructions: v.instructions,
      glossary: v.glossary,
    })),
    questionSet: q.questionSet ? {
      id: q.questionSet.id,
      groupId: q.questionSet.groupId,
      sharedContext: q.questionSet.sharedContext,
      media: q.questionSet.mediaAssets,
    } : null,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!rateLimit("get:" + ip, 120, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const session = await prisma.practiceSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ids = session.questionIds as string[];
  const total = ids.length;
  const completed = session.completedAt !== null || session.currentIndex >= total;
  const currentId = completed ? null : ids[session.currentIndex];

  const position = new Map(ids.map((qid, index) => [qid, index]));

  const answerRecords = await prisma.practiceAnswer.findMany({
    where: { sessionId: session.id },
    include: {
      question: {
        select: {
          id: true,
          correctOptionId: true,
          options: { orderBy: { displayOrder: "asc" }, select: { id: true } },
        },
      },
    },
  });

  const letterOf = (options: { id: string }[], optionId: string | null): string | null => {
    if (!optionId) return null;
    const idx = options.findIndex((o) => o.id === optionId);
    return idx >= 0 ? String.fromCharCode(65 + idx) : null;
  };

  const answers = answerRecords
    .map((record) => ({ record, index: position.get(record.questionId) }))
    .filter((entry): entry is { record: (typeof answerRecords)[number]; index: number } => entry.index !== undefined)
    .sort((a, b) => a.index - b.index)
    .map(({ record, index }) => ({
      index,
      questionId: record.questionId,
      selectedKey: letterOf(record.question.options, record.selectedOptionId),
      correctKey: letterOf(record.question.options, record.question.correctOptionId),
      isCorrect: record.isCorrect,
    }));

  let currentQuestion = null;
  let revealed = null;
  if (currentId) {
    const q = await prisma.question.findUnique({
      where: { id: currentId },
      include: { 
        options: { orderBy: { displayOrder: "asc" } }, 
        variants: true, 
        questionSet: { include: { mediaAssets: true } } 
      },
    });
    if (q) currentQuestion = stripQuestion(q);
    const ans = await prisma.practiceAnswer.findUnique({
      where: { sessionId_questionId: { sessionId: session.id, questionId: currentId } },
    });
    if (ans && q) {
      revealed = {
        selected_option_id: ans.selectedOptionId,
        correct_option_id: q.correctOptionId,
        is_correct: ans.isCorrect,
        explanations: q.variants.reduce((acc: any, v: any) => {
          acc[v.language] = v.explanation;
          return acc;
        }, {}),
      };
    }
  }
  return NextResponse.json({
    id: session.id,
    exam: session.exam,
    total,
    currentIndex: session.currentIndex,
    score: session.score,
    completed,
    currentQuestion,
    revealed,
    answers,
  });
}