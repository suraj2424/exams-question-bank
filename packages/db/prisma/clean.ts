import { prisma } from "../src/index";

async function main() {
  console.log("Cleaning up all tables in the database...");

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "PracticeAnswer",
      "PracticeSession",
      "QuestionOption",
      "QuestionVariant",
      "MediaAsset",
      "PaperAnswerKey",
      "IngestJob",
      "Question",
      "QuestionCandidate",
      "QuestionSet",
      "Paper",
      "FetchedDocument",
      "CrawlRun",
      "PipelineRun",
      "LicenceRecord",
      "Source"
    RESTART IDENTITY CASCADE;
  `);

  console.log("Database has been completely wiped clean.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Cleanup error:", e);
  process.exit(1);
});

