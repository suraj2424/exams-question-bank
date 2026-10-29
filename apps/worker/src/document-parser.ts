import { embedTextsBatched, cosineSimilarity } from "./embedding";
import { config } from "./config";

export interface ParsedBlock {
  type: "directions" | "question" | "option" | "table" | "image" | "section_header" | "text" | "unknown";
  text: string;
  questionNumber?: number;
  options?: string[];
  pageNumber: number;
  blockIndex: number;
  confidence: number;
  flags: string[];
  rawJson?: any;
}

export interface ParsedPage {
  pageNumber: number;
  blocks: ParsedBlock[];
  tables: Array<{ rows: string[][]; caption?: string; pageNumber: number }>;
  images: Array<{ description?: string; pageNumber: number; bbox?: [number, number, number, number] }>;
  rawJson: any;
}

export interface QuestionSetInfo {
  groupId: string;
  type: string;
  sharedContext: string;
  pageStart: number;
  pageEnd: number;
  questionNumbers: number[];
  blockIndices: number[];
  confidence: number;
}

export interface ParsedDocument {
  pages: ParsedPage[];
  questionSets: QuestionSetInfo[];
  independentQuestions: ParsedBlock[];
  sharedContextBlocks: ParsedBlock[];
  flags: string[];
}

const QUESTION_NUMBER_RE = /^(?:\s*)(?:Q(?:\u002e)?\s*)?(\d{1,3})(?:\u002e|\u0029|:|\u002d|\s)(.+)/s;
const OPTION_RE = /^(?:\s*)(?:\(?([A-Ea-e])\)?(?:\u002e|\u0029)?|\(([a-e])\)|(\d{1,2})(?:\u002e|\u0029))\s+(.+)/s;
const DIRECTIONS_RE = /(?:directions?\s+for\s+(?:questions?|qs?)\s+(\d+)\s*(?:\u2013|\u2013|-|to)\s*(\d+)|read\s+(?:the\s+)?(?:following\s+)?(?:passage|comprehension)|study\s+(?:the\s+)?(?:following\s+)?(?:table|chart|graph|data)|answer\s+questions?\s+(\d+)\s*(?:\u2013|-|to)\s*(\d+)|directions?\s*\(\s*(\d+)\s*(?:\u2013|-|to)\s*(\d+)\s*\)\s*:?)/i;
const SECTION_RE = /^\s*(?:section|part|part\s*\d+)\s*(?:\u002e|\s|:|$)/i;

function extractTextFromNemotron(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    if (Array.isArray(content)) {
      return content.map((c) => extractTextFromNemotron(c)).join("\n");
    }
    if (content.content) return extractTextFromNemotron(content.content);
    if (content.text) return content.text;
    if (content.markdown) return content.markdown;
    const parts: string[] = [];
    for (const v of Object.values(content)) {
      if (typeof v === "string") parts.push(v);
      else if (v && typeof v === "object") parts.push(extractTextFromNemotron(v));
    }
    return parts.join("\n");
  }
  return String(content);
}

const VALID_BLOCK_TYPES: ParsedBlock["type"][] = ["question", "text", "directions", "option", "table", "image", "section_header", "unknown"];

function normalizeBlockType(t: string): ParsedBlock["type"] {
  return VALID_BLOCK_TYPES.includes(t as ParsedBlock["type"]) ? (t as ParsedBlock["type"]) : "unknown";
}

function tryParseStructuredBlocks(content: any, pageNumber: number): ParsedBlock[] | null {
  if (content == null || typeof content !== "object") return null;
  if (Array.isArray(content)) {
    const blocks: ParsedBlock[] = [];
    let idx = 0;
    for (const item of content) {
      const sub = tryParseStructuredBlocks(item, pageNumber);
      if (sub) blocks.push(...sub);
      else {
        const t = extractTextFromNemotron(item);
        if (t.trim()) blocks.push(makeBlock("unknown", t, pageNumber, idx++));
      }
    }
    return blocks.length > 0 ? blocks : null;
  }

  if (content.blocks && Array.isArray(content.blocks)) {
    const blocks: ParsedBlock[] = [];
    content.blocks.forEach((item: any, idx: number) => {
      const t = extractTextFromNemotron(item);
      if (!t.trim()) return;
      let type: ParsedBlock["type"] = "text";
      if (item.type) type = normalizeBlockType(String(item.type));
      else if (DIRECTIONS_RE.test(t)) type = "directions";
      else if (QUESTION_NUMBER_RE.test(t)) type = "question";
      else if (OPTION_RE.test(t)) type = "option";
      blocks.push(makeBlock(type, t, pageNumber, idx, item.questionNumber, item.options, item.confidence, item.flags, item));
    });
    return blocks.length > 0 ? blocks : null;
  }

  if (content.pages && Array.isArray(content.pages)) {
    const blocks: ParsedBlock[] = [];
    content.pages.forEach((pg: any) => {
      const pgBlocks = tryParseStructuredBlocks(pg, pageNumber);
      if (pgBlocks) blocks.push(...pgBlocks);
    });
    return blocks.length > 0 ? blocks : null;
  }

  return null;
}

function makeBlock(
  type: ParsedBlock["type"],
  text: string,
  pageNumber: number,
  blockIndex: number,
  questionNumber?: number,
  options?: string[],
  confidence?: number,
  flags?: string[],
  rawJson?: any,
): ParsedBlock {
  const qNum = questionNumber !== undefined ? questionNumber : extractQuestionNumber(text);
  const f = flags || [];
  const conf = confidence ?? (qNum !== undefined ? 0.9 : 0.5);
  return { type, text, questionNumber: qNum, options, pageNumber, blockIndex, confidence: conf, flags: f, rawJson };
}

function extractQuestionNumber(text: string): number | undefined {
  const m = QUESTION_NUMBER_RE.exec(text);
  if (m) return Number(m[1]);
  return undefined;
}

function classifyBlock(text: string, prevType: ParsedBlock["type"]): ParsedBlock["type"] {
  if (DIRECTIONS_RE.test(text)) return "directions";
  if (SECTION_RE.test(text)) return "section_header";
  if (OPTION_RE.test(text)) return "option";
  if (QUESTION_NUMBER_RE.test(text)) return "question";
  if (/^\s*(?:table|figure|chart|diagram|image)\s*\d+/i.test(text)) return "table";
  return "text";
}

function extractDirectionsInfo(text: string): { start?: number; end?: number; type?: string } | null {
  const m1 = /^\s*directions?\s+for\s+(?:questions?|qs?)\s+(\d+)\s*(?:\u2013|-|to)\s*(\d+)/i.exec(text);
  if (m1) return { start: Number(m1[1]), end: Number(m1[2]), type: "connected_set" };
  const m2 = /^\s*answer\s+questions?\s+(\d+)\s*(?:\u2013|-|to)\s*(\d+)/i.exec(text);
  if (m2) return { start: Number(m2[1]), end: Number(m2[2]), type: "connected_set" };
  const m3 = /^\s*directions?\s*\(\s*(\d+)\s*(?:\u2013|-|to)\s*(\d+)\s*\)\s*:?/i.exec(text);
  if (m3) return { start: Number(m3[1]), end: Number(m3[2]), type: "connected_set" };
  if (/^\s*read\s+(?:the\s+)?(?:following\s+)?(?:passage|comprehension)/i.test(text)) return { type: "reading_comprehension" };
  if (/^\s*study\s+(?:the\s+)?(?:following\s+)?(?:table|chart|graph|data)/i.test(text)) return { type: "data_interpretation" };
  return null;
}

export function splitTextByQuestions(text: string): Array<{ type: "directions" | "question" | "text"; text: string; questionNumber?: number }> {
  const chunks: Array<{ type: "directions" | "question" | "text"; text: string; questionNumber?: number }> = [];

  const lines = text.split(/\n+/);
  let currentChunk: { type: "directions" | "question" | "text"; text: string; questionNumber?: number } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip page headers/footers
    if (/^(?:\d{1,3}\s)?(?:Adda247|CareerPower|Testbook|PW)\s*\|?/i.test(trimmed)) continue;
    if (trimmed.includes("bankersadda.com") || trimmed.includes("sscadda.com")) continue;

    const qMatch = QUESTION_NUMBER_RE.exec(trimmed);

    // Check for directions at start of line (anchored)
    const dStartMatch = /^\s*directions?\s*\(\s*(\d+)\s*(?:\u2013|-|to)\s*(\d+)\s*\)\s*:?/i.exec(trimmed);

    // Check for embedded directions (e.g., "E. D Direction (30-34): Study...")
    const embeddedDirMatch = !qMatch && !dStartMatch ? /^(.+?)\s+(directions?\s*\(\s*\d+\s*(?:\u2013|-|to)\s*\d+\s*\)\s*:.*)/i.exec(trimmed) : null;

    if (dStartMatch) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = { type: "directions", text: trimmed, questionNumber: undefined };
      continue;
    }

    if (embeddedDirMatch) {
      // Split line: option part + directions part
      const optionPart = embeddedDirMatch[1].trim();
      const dirPart = embeddedDirMatch[2].trim();
      if (currentChunk) {
        currentChunk.text += "\n" + optionPart;
        chunks.push(currentChunk);
        currentChunk = null;
      }
      chunks.push({ type: "directions", text: dirPart, questionNumber: undefined });
      continue;
    }

    if (qMatch) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = { type: "question", text: trimmed, questionNumber: Number(qMatch[1]) };
      continue;
    }

    if (currentChunk) {
      currentChunk.text += "\n" + trimmed;
    } else {
      chunks.push({ type: "text", text: trimmed, questionNumber: undefined });
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

export function parseNemotronPages(
  results: Array<{ pageNumber: number; content: any; rawJson: any; success: boolean; error?: string }>,
): ParsedDocument {
  const pages: ParsedPage[] = [];
  const allBlocks: ParsedBlock[] = [];
  let flags: string[] = [];

  for (const r of results) {
    if (!r.success || !r.content) {
      flags.push(`page ${r.pageNumber}: parse failed - ${r.error ?? "no content"}`);
      pages.push({ pageNumber: r.pageNumber, blocks: [], tables: [], images: [], rawJson: r.rawJson });
      continue;
    }

    const structured = tryParseStructuredBlocks(r.content, r.pageNumber);
    const text = extractTextFromNemotron(r.content);
    let blocks: ParsedBlock[] = [];

    if (structured) {
      blocks = structured;
    } else {
      const chunks = splitTextByQuestions(text);
      chunks.forEach((chunk, idx) => {
        let type: ParsedBlock["type"] = "text";
        if (chunk.type === "directions") type = "directions";
        else if (chunk.type === "question") type = "question";
        blocks.push(makeBlock(type, chunk.text, r.pageNumber, idx, chunk.questionNumber));
      });
    }

    pages.push({ pageNumber: r.pageNumber, blocks, tables: [], images: [], rawJson: r.rawJson });
    allBlocks.push(...blocks);
  }

  const questionSets = detectQuestionSets(allBlocks, pages);
  const { independentQuestions, sharedContextBlocks } = splitIndependentAndShared(allBlocks, questionSets);

  return {
    pages,
    questionSets,
    independentQuestions,
    sharedContextBlocks,
    flags,
  };
}

export function detectQuestionSets(blocks: ParsedBlock[], pages: ParsedPage[]): QuestionSetInfo[] {
  const sets: QuestionSetInfo[] = [];
  let currentSet: QuestionSetInfo | null = null;
  let setCounter = 0;
  const usedBlockIndices = new Set<number>();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === "directions") {
      const info = extractDirectionsInfo(block.text);
      if (currentSet) {
        sets.push(currentSet);
        currentSet = null;
      }
      if (info) {
        setCounter++;
        currentSet = {
          groupId: `set_${String(setCounter).padStart(3, "0")}`,
          type: info.type ?? "connected_set",
          sharedContext: block.text,
          pageStart: block.pageNumber,
          pageEnd: block.pageNumber,
          questionNumbers: [],
          confidence: block.confidence,
          blockIndices: [i],
        };
      }
      continue;
    }

    if (currentSet && block.type === "question" && block.questionNumber !== undefined) {
      if (usedBlockIndices.has(i)) continue;
      usedBlockIndices.add(i);
      currentSet.questionNumbers.push(block.questionNumber);
      currentSet.blockIndices.push(i);
      currentSet.pageEnd = Math.max(currentSet.pageEnd, block.pageNumber);
      continue;
    }

    if (block.type === "section_header") {
      if (currentSet) {
        sets.push(currentSet);
        currentSet = null;
      }
    }
  }

  if (currentSet) sets.push(currentSet);
  return sets;
}

export function splitIndependentAndShared(
  blocks: ParsedBlock[],
  questionSets: QuestionSetInfo[],
): { independentQuestions: ParsedBlock[]; sharedContextBlocks: ParsedBlock[] } {
  const setBlockIndices = new Set<number>();
  const sharedBlockIndices = new Set<number>();

  for (const set of questionSets) {
    set.blockIndices.forEach((idx) => setBlockIndices.add(idx));
    // Find the shared context block (directions block) for this set
    const sharedIdx = set.blockIndices[0];
    if (sharedIdx !== undefined) {
      sharedBlockIndices.add(sharedIdx);
    }
  }

  const independentQuestions: ParsedBlock[] = [];
  const sharedContextBlocks: ParsedBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (sharedBlockIndices.has(i)) {
      sharedContextBlocks.push({ ...b, isSharedContext: true } as ParsedBlock & { isSharedContext: boolean });
    } else if (!setBlockIndices.has(i)) {
      independentQuestions.push(b);
    }
  }

  return { independentQuestions, sharedContextBlocks };
}

function normalizeOptions(block: ParsedBlock): string[] | undefined {
  if (block.options && block.options.length > 0) return block.options;
  const opts: string[] = [];
  const text = block.text;
  const lines = text.split("\n");
  for (const line of lines) {
    const m = OPTION_RE.exec(line);
    if (m) {
      const opt = m[4]?.trim();
      if (opt) opts.push(opt);
    }
  }
  return opts.length > 0 ? opts : undefined;
}

export interface CandidateRecord {
  sourceDocumentId: string;
  pageNumber: number | null;
  rawText: string;
  cleanedText: string;
  detectedLanguage: string;
  status: string;
  questionSetId: string | null;
  questionNumber: number | null;
  isSharedContext: boolean;
  extractionConfidence: number;
  extractionFlags: string[];
  rawJson: any;
  embedding?: number[];
}

export async function buildCandidateRecords(
  docId: string,
  parsed: ParsedDocument,
  lang: string,
): Promise<CandidateRecord[]> {
  const records: CandidateRecord[] = [];
  const usedRawTexts = new Set<string>();

  const addRecord = (rec: Omit<CandidateRecord, "embedding">) => {
    const key = rec.rawText.slice(0, 200);
    if (usedRawTexts.has(key)) return;
    usedRawTexts.add(key);
    records.push(rec);
  };

  for (const set of parsed.questionSets) {
    const sharedBlock = parsed.sharedContextBlocks.find((b) => b.text === set.sharedContext);
    if (sharedBlock) {
      addRecord({
        sourceDocumentId: docId,
        pageNumber: sharedBlock.pageNumber,
        rawText: sharedBlock.text,
        cleanedText: sharedBlock.text,
        detectedLanguage: lang,
        status: "pending_review",
        questionSetId: null,
        questionNumber: null,
        isSharedContext: true,
        extractionConfidence: sharedBlock.confidence,
        extractionFlags: [...sharedBlock.flags],
        rawJson: sharedBlock.rawJson,
      });
    }

    const setBlocks = parsed.pages.flatMap((p) => p.blocks.filter((b) =>
      b.questionNumber !== undefined && set.questionNumbers.includes(b.questionNumber)
    ));

    setBlocks.sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0));

    for (const block of setBlocks) {
      const opts = normalizeOptions(block);
      const text = opts ? `${block.text}\n\nOptions:\n${opts.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")}` : block.text;
      addRecord({
        sourceDocumentId: docId,
        pageNumber: block.pageNumber,
        rawText: block.text,
        cleanedText: text,
        detectedLanguage: lang,
        status: "pending_review",
        questionSetId: set.groupId,
        questionNumber: block.questionNumber ?? null,
        isSharedContext: false,
        extractionConfidence: block.confidence,
        extractionFlags: [...block.flags],
        rawJson: block.rawJson,
      });
    }
  }

  // Only independent blocks classified as actual questions become candidates.
  // Plain text blocks (navigation, menus, page headers) are excluded.
  for (const block of parsed.independentQuestions) {
    if (block.type !== "question") continue;
    if (!block.questionNumber) continue;
    const opts = normalizeOptions(block);
    const text = opts ? `${block.text}\n\nOptions:\n${opts.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")}` : block.text;
      addRecord({
        sourceDocumentId: docId,
        pageNumber: block.pageNumber,
        rawText: block.text,
        cleanedText: text,
        detectedLanguage: lang,
        status: "pending_review",
        questionSetId: null,
        questionNumber: block.questionNumber ?? null,
        isSharedContext: false,
        extractionConfidence: block.confidence,
        extractionFlags: [...block.flags],
        rawJson: block.rawJson,
      });
  }

  for (const block of parsed.sharedContextBlocks) {
    const already = records.find((r) => r.rawText === block.text && r.isSharedContext);
    if (!already) {
      addRecord({
        sourceDocumentId: docId,
        pageNumber: block.pageNumber,
        rawText: block.text,
        cleanedText: block.text,
        detectedLanguage: lang,
        status: "pending_review",
        questionSetId: null,
        questionNumber: null,
        isSharedContext: true,
        extractionConfidence: block.confidence,
        extractionFlags: [...block.flags],
        rawJson: block.rawJson,
      });
    }
  }

  return records;
}

export async function attachEmbeddings(records: CandidateRecord[]): Promise<CandidateRecord[]> {
  const texts = records.map((r) => r.cleanedText);
  if (texts.length === 0) return records;
  const vecs = await embedTextsBatched(texts, 8);
  return records.map((r, i) => ({ ...r, embedding: vecs[i] }));
}
