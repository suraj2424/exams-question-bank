import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [sections, topics, paperRows, documentCount] = await Promise.all([
    prisma.question.groupBy({
      by: ["section"],
      where: { status: "published" },
      _count: { _all: true },
    }),
    prisma.question.groupBy({
      by: ["topic", "section"],
      where: { status: "published" },
      _count: { _all: true },
    }),
    prisma.question.groupBy({
      by: ["paperKey"],
      where: { status: "published", paperKey: { not: null } },
      _count: { _all: true },
    }),
    prisma.ingestJob.count(),
  ]);

  const paperMeta = await prisma.paper.findMany({
    select: { paperKey: true, title: true },
  });
  const titleByKey = new Map<string, string>();
  for (const row of paperMeta) {
    if (!titleByKey.has(row.paperKey)) titleByKey.set(row.paperKey, row.title ?? row.paperKey);
  }

  const countByPaper = new Map(
    paperRows.map((row) => [row.paperKey as string, row._count._all]),
  );

  return NextResponse.json({
    sections: sections.map((row) => ({ name: row.section, count: row._count._all })),
    topics: topics.map((row) => ({
      name: row.topic,
      section: row.section,
      count: row._count._all,
    })),
    papers: [...countByPaper.entries()].map(([paperKey, count]) => ({
      paperKey,
      title: titleByKey.get(paperKey) ?? paperKey,
      count,
    })),
    documents: documentCount,
    totalQuestions: sections.reduce((sum, row) => sum + row._count._all, 0),
  });
}
