import { prisma } from "@qb/db";
import { readFileRelative } from "./storage";
import { ingestGate, SourceLike } from "./source-gate";
import { buildNemotronClient } from "./nemotron-client";
import { renderPdfPages, isRenderingAvailable } from "./pdf-renderer";
import { extractPdfText } from "./pdf-text";
import {
  parseNemotronPages,
  buildCandidateRecords,
  attachEmbeddings,
  ParsedDocument,
  splitTextByQuestions,
  detectQuestionSets,
  splitIndependentAndShared,
} from "./document-parser";
import { normalizePaperKey, extractPaperKeyFromUrl, inferDocKind } from "./paper-key";

function normalizeText(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export { normalizeText };

function detectLanguage(text: string): string {
  return /[\u0900-\u097F]/.test(text) ? "hi" : "en";
}

async function extractWithNemotron(
  buf: Buffer,
  docId: string,
): Promise<{ parsed: ParsedDocument; usedNemotron: boolean }> {
  const client = buildNemotronClient();
  if (!client) {
    return { parsed: { pages: [], questionSets: [], independentQuestions: [], sharedContextBlocks: [], flags: ["Nemotron client not configured (NVIDIA_API_KEY missing)"] }, usedNemotron: false };
  }

  if (!isRenderingAvailable()) {
    return { parsed: { pages: [], questionSets: [], independentQuestions: [], sharedContextBlocks: [], flags: ["PDF rendering not available (canvas module missing); cannot use Nemotron Parse"] }, usedNemotron: false };
  }

  const pages = await renderPdfPages(buf);
  const renderable = pages.filter((p) => p.imageBuffer !== null);
  const renderErrors = pages.filter((p) => p.renderError);

  if (renderable.length === 0) {
    const flags = renderErrors.map((p) => `page ${p.pageNumber}: ${p.renderError}`);
    return { parsed: { pages: [], questionSets: [], independentQuestions: [], sharedContextBlocks: [], flags }, usedNemotron: false };
  }

  const nemotronPages = renderable.map((p) => ({
    pageNumber: p.pageNumber,
    imageBuffer: p.imageBuffer!,
    filename: `page_${p.pageNumber}.png`,
  }));

  const maxTokens = Number(process.env.NEMOTRON_MAX_TOKENS ?? "1024");
  const results = await client.parsePages(nemotronPages, { decoding: { max_output_tokens: maxTokens } });

  const parsed = parseNemotronPages(results);
  for (const e of renderErrors) {
    parsed.flags.push(`page ${e.pageNumber}: render error - ${e.renderError}`);
  }

  return { parsed, usedNemotron: true };
}

async function extractWithPdfParseFallback(buf: Buffer, docId: string): Promise<ParsedDocument> {
  const data = await extractPdfText(buf);
  const text = data.text || "";
  const cleaned = normalizeText(text);
  const lang = detectLanguage(cleaned);

  let parsedPages: Array<{ pageNumber: number; blocks: any[]; tables: any[]; images: any[]; rawJson: any }> = [];

  if (data.pages.length > 0) {
    parsedPages = data.pages.map((pg) => {
      const pageNum = pg.pageNumber;
      const pageText = pg.text ?? "";
      const chunks = splitTextByQuestions(pageText);
      const blocks = chunks.map((chunk: { type: string; text: string; questionNumber?: number }, cIdx: number) => ({
        type: chunk.type as "text" | "question" | "directions",
        text: chunk.text,
        questionNumber: chunk.questionNumber,
        pageNumber: pageNum,
        blockIndex: cIdx,
        confidence: chunk.questionNumber !== undefined ? 0.7 : 0.4,
        flags: ["extracted_via_fallback"],
        rawJson: pg,
      }));
      return {
        pageNumber: pageNum,
        blocks,
        tables: [],
        images: [],
        rawJson: pg,
      };
    });
  } else {
    // no per-page data; split full text into pages by form feed
    const pageTexts = cleaned.split(/\f/).filter((t) => t.trim().length > 0);
    if (pageTexts.length === 0) pageTexts.push(cleaned);
    parsedPages = pageTexts.map((pageText, idx) => {
      const pageNum = idx + 1;
      const chunks = splitTextByQuestions(pageText);
      const blocks = chunks.map((chunk: { type: string; text: string; questionNumber?: number }, cIdx: number) => ({
        type: chunk.type as "text" | "question" | "directions",
        text: chunk.text,
        questionNumber: chunk.questionNumber,
        pageNumber: pageNum,
        blockIndex: cIdx,
        confidence: chunk.questionNumber !== undefined ? 0.7 : 0.4,
        flags: ["extracted_via_fallback"],
        rawJson: null,
      }));
      return {
        pageNumber: pageNum,
        blocks,
        tables: [],
        images: [],
        rawJson: null,
      };
    });
  }

  const blocks = parsedPages.flatMap((p: { blocks: any[] }) => p.blocks);
  const questionSets = detectQuestionSets(blocks, parsedPages);
  const { independentQuestions, sharedContextBlocks } = splitIndependentAndShared(blocks, questionSets);
  return {
    pages: parsedPages,
    questionSets,
    independentQuestions,
    sharedContextBlocks,
    flags: ["extracted_via_pdf_parse_fallback"],
  };
}

function extractHtml(buf: Buffer): string {
  const cheerio = require("cheerio");
  const $ = cheerio.load(buf.toString("utf8"));
  $("script,style,noscript").remove();
  return $("body").text() || $.root().text();
}

export async function extractDocument(documentId: string): Promise<{ candidates: number }> {
  const doc = await prisma.fetchedDocument.findUnique({ where: { id: documentId }, include: { source: true } });
  if (!doc) throw new Error("document not found");
  const source = doc.source as SourceLike;
  const gate = ingestGate(source);
  if (!gate.ok) throw new Error("Ingest not allowed: " + gate.reasons.join("; "));

  if (!doc.storagePath) throw new Error("no storage path");
  const buf = readFileRelative(doc.storagePath);

  const paperKey = extractPaperKeyFromUrl(doc.url);
  const docKind = inferDocKind(paperKey, doc.title || "", doc.url);

  await prisma.fetchedDocument.update({
    where: { id: documentId },
    data: { paperKey, docKind },
  });

  let parsed: ParsedDocument;
  let lang = "en";

  if (doc.isPdf) {
    const nemotron = await extractWithNemotron(buf, doc.id);
    if (nemotron.usedNemotron && nemotron.parsed.pages.length > 0) {
      parsed = nemotron.parsed;
    } else {
      parsed = await extractWithPdfParseFallback(buf, doc.id);
    }
  } else {
    const htmlText = extractHtml(buf);
    const cleaned = normalizeText(htmlText);
    lang = detectLanguage(cleaned);
    const chunks = splitTextByQuestions(cleaned);
    const blocks = chunks.map((chunk: { type: string; text: string; questionNumber?: number }, idx: number) => ({
      type: chunk.type as "text" | "question" | "directions",
      text: chunk.text,
      questionNumber: chunk.questionNumber,
      pageNumber: 1,
      blockIndex: idx,
      confidence: chunk.questionNumber !== undefined ? 0.7 : 0.5,
      flags: [],
      rawJson: null,
    }));
    const pages = [{ pageNumber: 1, blocks, tables: [], images: [], rawJson: null }];
    const questionSets = detectQuestionSets(blocks, pages);
    const { independentQuestions, sharedContextBlocks } = splitIndependentAndShared(blocks, questionSets);
    lang = detectLanguage(blocks.map((b) => b.text).join(" "));
    parsed = { pages, questionSets, independentQuestions, sharedContextBlocks, flags: [] };
  }

  lang = detectLanguage(parsed.pages.flatMap((p) => p.blocks.map((b) => b.text)).join(" "));

  const records = await buildCandidateRecords(doc.id, parsed, lang);
  const recordsWithEmbeddings = await attachEmbeddings(records);

  let count = 0;

  const setMap = new Map<string, string>();
  for (const set of parsed.questionSets) {
    const created = await prisma.questionSet.upsert({
      where: { groupId: set.groupId },
      update: { paperKey },
      create: {
        groupId: set.groupId,
        sourceDocumentId: doc.id,
        type: set.type,
        sharedContext: set.sharedContext,
        pageStart: set.pageStart,
        pageEnd: set.pageEnd,
        confidence: set.confidence,
        flags: { setFlags: set.questionNumbers, parserFlags: parsed.flags },
        paperKey,
      },
    });
    setMap.set(set.groupId, created.id);
  }

  for (const rec of recordsWithEmbeddings) {
    const qsId = rec.questionSetId ? setMap.get(rec.questionSetId) ?? null : null;
    await prisma.questionCandidate.create({
      data: {
        sourceDocumentId: doc.id,
        pageNumber: rec.pageNumber,
        rawText: rec.rawText,
        cleanedText: rec.cleanedText,
        detectedLanguage: rec.detectedLanguage,
        status: rec.status,
        questionSetId: qsId,
        questionNumber: rec.questionNumber,
        isSharedContext: rec.isSharedContext,
        extractionConfidence: rec.extractionConfidence,
        extractionFlags: { flags: rec.extractionFlags, parserFlags: parsed.flags },
        rawJson: rec.rawJson,
        embedding: rec.embedding,
      },
    });
    count++;
  }

  await prisma.fetchedDocument.update({
    where: { id: documentId },
    data: { extractionStatus: "completed", pageCount: parsed.pages.length },
  });

  return { candidates: count };
}

export async function extractPendingDocuments(sourceId?: string): Promise<{ processed: number; candidates: number }> {
  const where: any = { extractionStatus: "pending" };
  if (sourceId) where.sourceId = sourceId;
  const docs = await prisma.fetchedDocument.findMany({ where });
  let processed = 0;
  let candidates = 0;
  for (const d of docs) {
    try {
      const r = await extractDocument(d.id);
      candidates += r.candidates;
      processed++;
    } catch (err) {
      await prisma.fetchedDocument.update({ where: { id: d.id }, data: { extractionStatus: "failed" } }).catch(() => {});
    }
  }
  return { processed, candidates };
}

export const extract = extractDocument;
