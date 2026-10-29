import { prisma } from "@qb/db";

const paper = await prisma.paper.findFirst({ orderBy: { createdAt: "desc" } });
if (!paper) {
  console.log("no paper");
  process.exit(0);
}
console.log({ paperKey: paper.paperKey, title: paper.title, status: paper.status });
const structured: any = paper.structured;
console.log("structured keys:", Object.keys(structured ?? {}));
console.log("warnings:", structured?.warnings?.slice(0, 20));
console.log("answerPageNumbers:", structured?.answerPageNumbers);
console.log("answers sample:", JSON.stringify(structured?.answers?.slice?.(0, 8) ?? structured?.answers, null, 2).slice(0, 1200));
console.log("questions:", structured?.questions?.length, "answers:", structured?.answers?.length);
console.log("join:", JSON.stringify(structured?.join ?? null).slice(0, 600));

const keys = await prisma.paperAnswerKey.findMany({ where: { paperId: paper.id }, take: 10 });
console.log("paperAnswerKey rows:", keys.length, keys.slice(0, 5));

await prisma.$disconnect();
