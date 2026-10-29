import * as mupdf from "mupdf";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SOURCE_PDF = join(ROOT, "storage", "raw", "ibps-po-prelims-2020.pdf");
const OUT_DIR = join(ROOT, "storage", "fixtures");
const OUT_PDF = join(OUT_DIR, "ibps-po-prelims-2020-with-key.pdf");

const PAGE_COUNT = Number(process.env.FIXTURE_PAGES ?? 3);
const ANSWERS = (process.env.FIXTURE_ANSWERS ?? "")
  .split(",")
  .map((pair) => pair.trim())
  .filter(Boolean);

const defaultAnswers: string[] = [];
const keyPattern = /Q(\d{1,3})\.\s/g;
const srcText = (() => {
  const doc = mupdf.Document.openDocument(readFileSync(SOURCE_PDF), "application/pdf");
  let text = "";
  for (let i = 0; i < Math.min(PAGE_COUNT, doc.countPages()); i++) {
    text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  }
  return text;
})();

const numbers = [...srcText.matchAll(keyPattern)].map((m) => Number(m[1]));
const letters = "ABCDE";
for (const n of numbers) {
  defaultAnswers.push(`${n}:${letters[(n * 7) % 5]}`);
}
const answerPairs = ANSWERS.length > 0 ? ANSWERS : defaultAnswers;

function buildRawPdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  let content = "BT\n/F1 11 Tf\n40 800 Td\n14 TL\n";
  for (const line of lines) {
    content += `(${escape(line)}) Tj\nT*\n`;
  }
  content += "ET\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

function buildAnswerPagePdf(entries: Array<{ number: number; letter: string }>): Buffer {
  const lines: string[] = [];
  lines.push("Answer Key");
  for (let i = 0; i < entries.length; i += 5) {
    const chunk = entries.slice(i, i + 5);
    lines.push(chunk.map((e) => `Q${e.number} (${e.letter})`).join("   "));
  }
  return buildRawPdf(lines);
}

const entries = answerPairs.map((pair) => {
  const [number, letter] = pair.split(":");
  return { number: Number(number), letter: (letter || "A").toUpperCase() };
});

const answerDoc = new mupdf.PDFDocument(buildAnswerPagePdf(entries));
const outDoc = new mupdf.PDFDocument(readFileSync(SOURCE_PDF));

while (outDoc.countPages() > PAGE_COUNT) {
  outDoc.deletePage(outDoc.countPages() - 1);
}
outDoc.graftPage(outDoc.countPages(), answerDoc, 0);

mkdirSync(OUT_DIR, { recursive: true });
const saved = outDoc.saveToBuffer({});
writeFileSync(OUT_PDF, Buffer.from((saved as any).asUint8Array()));
console.log(
  `wrote ${OUT_PDF} (${outDoc.countPages() - 1} question pages + 1 answer page, ${entries.length} answers)`,
);
