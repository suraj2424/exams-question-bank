import { prisma } from "@qb/db";

async function main() {
  const sourceId = "cmvqfvc1i0000jy17fa911txg";
  const docs = await prisma.fetchedDocument.updateMany({
    where: { sourceId },
    data: { extractionStatus: "pending" },
  });
  console.log("reset", docs.count, "documents");
  const delCand = await prisma.questionCandidate.deleteMany({
    where: { sourceDocument: { sourceId } },
  });
  console.log("deleted", delCand.count, "candidates");
  const delSets = await prisma.questionSet.deleteMany({
    where: { sourceDocumentId: sourceId },
  });
  console.log("deleted", delSets.count, "question sets");
  const delQ = await prisma.question.deleteMany({
    where: { sourceId },
  });
  console.log("deleted", delQ.count, "questions");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
