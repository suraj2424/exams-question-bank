import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { answerSubmitSchema } from "@qb/shared";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!rateLimit("answer:" + ip, 60, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const session = await prisma.practiceSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (session.completedAt) return NextResponse.json({ error: "session completed" }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = answerSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  }
  const { question_id, selected_option_id, language } = parsed.data;

  const ids = session.questionIds as string[];
  if (session.currentIndex >= ids.length) {
    return NextResponse.json({ error: "no current question" }, { status: 400 });
  }
  const currentId = ids[session.currentIndex];
  if (question_id !== currentId) {
    return NextResponse.json({ error: "question not current" }, { status: 400 });
  }

  const existing = await prisma.practiceAnswer.findUnique({
    where: { sessionId_questionId: { sessionId: session.id, questionId: question_id } },
  });
  if (existing) {
    return NextResponse.json({ error: "already answered" }, { status: 409 });
  }

  const question = await prisma.question.findUnique({
    where: { id: question_id },
    include: { options: true, variants: true },
  });
  if (!question) return NextResponse.json({ error: "question not found" }, { status: 404 });

  const validOption = question.options.find((o) => o.id === selected_option_id);
  if (!validOption) return NextResponse.json({ error: "invalid option" }, { status: 400 });

  const isCorrect = selected_option_id === question.correctOptionId;
  const newScore = session.score + (isCorrect ? 1 : 0);

  await prisma.practiceAnswer.create({
    data: {
      sessionId: session.id,
      questionId: question_id,
      selectedOptionId: selected_option_id,
      isCorrect,
      languageAtReveal: language,
    },
  });

  const variant = question.variants.find((v) => v.language === language) || question.variants[0];
  const explanation = variant?.explanation ?? "";

  const nextIndex = session.currentIndex + 1;
  const completed = nextIndex >= ids.length;
  await prisma.practiceSession.update({
    where: { id: session.id },
    data: { score: newScore, currentIndex: nextIndex, completedAt: completed ? new Date() : null },
  });

  return NextResponse.json({
    is_correct: isCorrect,
    correct_option_id: question.correctOptionId,
    explanation,
    score: newScore,
    completed,
  });
}