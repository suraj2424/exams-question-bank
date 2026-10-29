import { NimClient } from "./nim-client";

export interface StructuredQuestion {
  number: number;
  text: string;
  options: { key: string; text: string }[];
  section: string;
  topic: string;
  subtopic: string;
  difficulty: number;
  setId: string | null;
  sourcePage: number | null;
}

export interface StructuredSet {
  setId: string;
  sharedContext: string;
  questionNumbers: number[];
  type: string;
  figures: { page: number; description: string; data: any }[];
}

export interface StructuredDocument {
  paperTitle: string;
  sections: { section: string; topic: string; subtopic: string; questionRange: string }[];
  sets: StructuredSet[];
  questions: StructuredQuestion[];
}

const STRUCTURE_PROMPT = `You are an expert at parsing Indian banking exam (IBPS PO) question papers. Given the text content of a page (or multiple pages) from an exam paper, extract structured question data.

Return JSON ONLY with this exact schema:
{
  "paperTitle": string,
  "sections": [{ "section": string, "topic": string, "subtopic": string, "questionRange": string }],
  "sets": [{
    "setId": string,
    "sharedContext": string,
    "questionNumbers": number[],
    "type": "connected_set" | "reading_comprehension" | "data_interpretation" | "puzzle",
    "figures": [{ "page": number, "description": string, "data": object | null }]
  }],
  "questions": [{
    "number": number,
    "text": string,
    "options": [{ "key": string, "text": string }],
    "section": "English Language" | "Quantitative Aptitude" | "Reasoning Ability",
    "topic": string,
    "subtopic": string,
    "difficulty": number,
    "setId": string | null,
    "sourcePage": number
  }]
}

Rules:
1. Identify question numbers (Q1, Q2, etc.) and their full text.
2. Extract all options (a)-(e) or (A)-(E) with their text.
3. Detect shared contexts (Directions for Q1-4, passage for Q13-20, DI sets, puzzle sets).
4. Assign section: "English Language" (grammar, vocabulary, reading comprehension, rearrangement), "Quantitative Aptitude" (arithmetic, DI, number series, equations), "Reasoning Ability" (puzzles, seating, coding, syllogism, inequalities, blood relations).
5. Topic/subtopic should be specific (e.g., "Data Interpretation" / "Line Graph", "Seating Arrangement" / "Two Rows").
6. Difficulty 1-5 (1=easy, 5=hard).
7. setId is the set's setId if the question belongs to a set, else null.
8. sourcePage is the page number where the question appears.
9. For DI sets with charts/graphs, include figures array with page, description, and extracted data if possible.
10. Do NOT include answers or explanations - only question text and options.
`;

export async function structureDocument(
  client: NimClient,
  pages: Array<{ pageNumber: number; text: string; imageBase64?: string }>,
  paperTitle: string
): Promise<StructuredDocument> {
  const messages: any[] = [
    { role: "system", content: STRUCTURE_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: `Paper: ${paperTitle}. Total pages: ${pages.length}.` },
        ...pages.flatMap((p) => [
          { type: "text", text: `--- PAGE ${p.pageNumber} ---\n${p.text}` },
          ...(p.imageBase64 ? [{ type: "image_url", image_url: { url: `data:image/png;base64,${p.imageBase64}` } }] : []),
        ]),
      ],
    },
  ];

  const result = await client.chatJson<StructuredDocument>(messages, {
    maxTokens: 16384,
    responseFormat: { type: "json_object" },
    enableThinking: false,
  });
  return result;
}

export async function structurePage(
  client: NimClient,
  pageText: string,
  pageNumber: number,
  imageBase64?: string
): Promise<StructuredDocument> {
  return structureDocument(client, [{ pageNumber, text: pageText, imageBase64 }], "");
}