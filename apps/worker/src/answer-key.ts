export interface AnswerKeyEntry {
  questionNumber: number;
  key: string;
  explanation: string;
}

export interface ParsedAnswerKey {
  paperTitle: string;
  entries: AnswerKeyEntry[];
}

const SOLUTION_PARSER_PROMPT = `You are parsing an IBPS PO exam solutions document. The text contains entries like:

S1. Ans.(e)
Sol. ACB is the correct sequence. The role played by human rights organisations...

S2. Ans.(e)
Sol. BCA is the correct sequence. The C&AG's observations...

Your task: Extract ALL question-answer pairs and their explanations.

Return JSON ONLY:
{
  "paperTitle": string,
  "entries": [{ "questionNumber": number, "key": string, "explanation": string }]
}

Rules:
1. Question numbers may be written as S1, S2, S3... or S 1, S 2.
2. Answer key format: Ans.(x) where x is a-e or A-E.
3. Explanation follows "Sol." or "Solution:" until the next S<number> or end of text.
4. If explanation is missing, use empty string.
5. Only return entries where you can confidently extract both question number and answer key.
`;

export function parseSolutionText(text: string): ParsedAnswerKey {
  const entries: AnswerKeyEntry[] = [];

  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

  const pattern = /S\s*(\d{1,3})\s*\.?\s*Ans\.?\s*\(([A-Ea-e])\)\s*Sol\.?\s*([\s\S]*?)(?=\s*S\s*\d{1,3}\s*\.?\s*Ans\.?\s*\(|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const qNum = parseInt(match[1], 10);
    const key = match[2].toUpperCase();
    const explanation = match[3].trim().replace(/\s+/g, " ");
    if (!isNaN(qNum)) {
      entries.push({ questionNumber: qNum, key, explanation });
    }
  }

  if (entries.length === 0) {
    const altPattern = /S\s*(\d{1,3})\s*[.:]\s*([A-Ea-e])\s*(?:Sol\.?|Solution:)\s*([\s\S]*?)(?=\s*S\s*\d{1,3}\s*[.:]|$)/gi;
    while ((match = altPattern.exec(normalized)) !== null) {
      const qNum = parseInt(match[1], 10);
      const key = match[2].toUpperCase();
      const explanation = match[3].trim().replace(/\s+/g, " ");
      if (!isNaN(qNum)) {
        entries.push({ questionNumber: qNum, key, explanation });
      }
    }
  }

  const paperTitle = extractPaperTitle(text);

  return { paperTitle, entries };
}

function extractPaperTitle(text: string): string {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (/IBPS PO|Memory Based|Prelims|Mains/i.test(trimmed) && trimmed.length > 10 && trimmed.length < 100) {
      return trimmed;
    }
  }
  return "Unknown Paper";
}

export async function parseSolutionWithLLM(
  client: any,
  solutionText: string,
  imageBase64?: string
): Promise<ParsedAnswerKey> {
  const messages: any[] = [
    { role: "system", content: SOLUTION_PARSER_PROMPT },
    { role: "user", content: `Parse this solutions document:\n\n${solutionText.slice(0, 30000)}` },
  ];
  if (imageBase64) {
    messages[1].content = [
      { type: "text", text: messages[1].content as string },
      { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    ];
  }
  return client.chatJson(messages, { maxTokens: 16384, responseFormat: { type: "json_object" }, enableThinking: false });
}

export function joinAnswerKey(
  questions: Array<{ number: number; setId: string | null }>,
  answerKey: ParsedAnswerKey
): Map<number, { key: string; explanation: string }> {
  const map = new Map<number, { key: string; explanation: string }>();
  for (const entry of answerKey.entries) {
    const q = questions.find((q) => q.number === entry.questionNumber);
    if (q) {
      map.set(entry.questionNumber, { key: entry.key, explanation: entry.explanation });
    }
  }
  return map;
}