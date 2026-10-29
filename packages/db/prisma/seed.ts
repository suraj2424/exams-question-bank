import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

const LEGACY_SOURCE_ID = "cmvqu7bdd0000zcum8lejyd58";

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collect(full));
    else if (st.isFile() && (full.endsWith(".json") || full.endsWith(".jsonl"))) out.push(full);
  }
  return out;
}
function parse(file: string): any[] {
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return [];
  if (file.endsWith(".jsonl")) return raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const p = JSON.parse(raw);
  if (Array.isArray(p)) return p;
  if (p && Array.isArray(p.questions)) return p.questions;
  return [p];
}

async function main() {
  const dir = process.argv[2] || (existsSync("../../storage/questions") ? "../../storage/questions" : "storage/questions");
  const files = collect(dir);
  const qs: any[] = [];
  for (const f of files) qs.push(...parse(f));
  console.log("loaded", qs.length);

  await prisma.practiceAnswer.deleteMany();
  await prisma.practiceSession.deleteMany();
  // Seeded (JSON) questions only. Questions produced by the RAG ingest pipeline
  // (extractionMethod = "rag_ai") are never touched by seeding.
  await prisma.questionOption.deleteMany({ where: { question: { sourceId: LEGACY_SOURCE_ID } } });
  await prisma.questionVariant.deleteMany({ where: { question: { sourceId: LEGACY_SOURCE_ID } } });
  const deletedQuestions = await prisma.question.deleteMany({ where: { sourceId: LEGACY_SOURCE_ID } });
  console.log("Deleted seeded questions:", deletedQuestions.count);
  await prisma.source.deleteMany({ where: { id: { not: LEGACY_SOURCE_ID }, rightsStatus: { not: "user_provided" } } });
  await prisma.crawlRun.deleteMany();
  await prisma.fetchedDocument.deleteMany({ where: { docKind: { not: "paper" } } });
  await prisma.questionCandidate.deleteMany();
  await prisma.questionSet.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.pipelineRun.deleteMany();
  await prisma.licenceRecord.deleteMany();

  // Ensure licence record exists
  await prisma.licenceRecord.upsert({
    where: { id: "licensed_pyq" },
    update: {},
    create: {
      id: "licensed_pyq",
      licenceName: "IBPS PO Licensed PYQ",
      documentUrl: "https://www.careerpower.in/2021/ibps-po-prelims-2020.pdf",
      evidencePath: "storage/raw/ibps-po-prelims-2020.pdf",
      commercialUse: true,
      modificationAllowed: true,
      translationAllowed: true,
      redistributionAllowed: true,
      attributionText: "Source: CareerPower/Adda247 IBPS PO Prelims 2020",
    },
  });

  // Ensure source exists
  await prisma.source.upsert({
    where: { id: "cmvqu7bdd0000zcum8lejyd58" },
    update: {},
    create: {
      id: "cmvqu7bdd0000zcum8lejyd58",
      name: "CareerPower IBPS PO PYQ",
      baseUrl: "https://www.careerpower.in/2021/ibps-po-prelims-2020.pdf",
      allowedDomains: ["www.careerpower.in"],
      rightsStatus: "licensed",
      licenceDocumentUrl: "https://www.careerpower.in/2021/ibps-po-prelims-2020.pdf",
      commercialUse: true,
      modificationAllowed: true,
      translationAllowed: true,
      redistributionAllowed: true,
      attributionRequired: true,
      termsUrl: "https://www.careerpower.in/terms",
      robotsReviewedDate: new Date(),
      allowedToCrawl: true,
      allowedToIngestText: true,
      allowedToDisplay: true,
      approvedBy: "admin",
      approvedAt: new Date(),
      status: "approved",
    },
  });

  const batchSize = 50;
  for (let i = 0; i < qs.length; i += batchSize) {
    const chunk = qs.slice(i, i + batchSize);
    await prisma.$transaction(
      chunk.map((q) =>
        prisma.question.create({
          data: {
            id: q.id,
            exam: q.exam,
            section: q.section,
            topic: q.topic,
            subtopic: q.subtopic,
            questionFormat: q.question_format,
            difficulty: q.difficulty,
            sourceType: q.source_type,
            sourceId: q.source_id ?? null,
            sourceUrl: q.source_url ?? null,
            licenceId: q.licence_id ?? null,
            examYear: q.exam_year ?? null,
            examStage: q.exam_stage ?? null,
            examShift: q.exam_shift ?? null,
            paperReference: q.paper_reference ?? null,
            status: q.status,
            createdBy: q.created_by,
            reviewedBy: q.reviewed_by ?? null,
            version: q.version,
            correctOptionId: q.correct_option_id,
            options: {
              create: q.options.map((o: any) => ({
                id: o.id,
                canonicalKey: o.canonical_key,
                displayOrder: o.display_order,
                enText: o.en_text,
                hiText: o.hi_text,
                media: o.media ?? null,
                isCorrect: o.is_correct,
                optionExplanationEn: o.option_explanation_en ?? null,
                optionExplanationHi: o.option_explanation_hi ?? null,
              })),
            },
            variants: {
              create: q.variants.map((v: any) => ({
                id: v.id,
                language: v.language,
                prompt: v.prompt,
                explanation: v.explanation,
                instructions: v.instructions ?? null,
                glossary: v.glossary ?? null,
                status: v.status,
                translator: v.translator ?? null,
                reviewer: v.reviewer ?? null,
              })),
            },
          },
        })
      )
    );
    console.log("seeded", Math.min(i + batchSize, qs.length), "/", qs.length);
  }
}

main()
  .then(() => { console.log("done"); })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
