import { NimClient } from "./nim-client";

const TRANSLATION_PROMPT_QUANT_REASONING = `You are translating IBPS PO exam questions from English to Hindi for a bilingual practice app.

Translate the following to natural, exam-appropriate Hindi. Preserve:
- Numbers, units, symbols exactly (do not translate 5%, 10 km/hr, ₹500, 3:4, etc.)
- Option order and keys (A, B, C, D, E)
- Mathematical notation
- Proper nouns

Return JSON ONLY:
{
  "prompt": string,
  "options": [{ "key": string, "text": string }],
  "explanation": string
}

Input:
- English prompt (may include shared context)
- Options array: [{key, text}]
- English explanation

Output Hindi equivalents.`;

const TRANSLATION_PROMPT_ENGLISH = `You are creating Hindi support content for an IBPS PO English Language question.

The TESTED ENGLISH must NOT be translated. Only provide:
- Hindi instructions (one line, e.g., "निम्नलिखित प्रश्न का सही विकल्प चुनें।")
- Hindi explanation of the answer (why the option is correct)
- Hindi glossary: key English terms from the question with Hindi meanings

Return JSON ONLY:
{
  "instructions": string,
  "explanation": string,
  "glossary": { "english_term": "hindi_meaning" }
}

Do NOT translate the question text or options.`;

export async function translateQuantReasoning(
  client: NimClient,
  prompt: string,
  options: { key: string; text: string }[],
  explanation: string
): Promise<{ prompt: string; options: { key: string; text: string }[]; explanation: string }> {
  const messages = [
    { role: "system", content: TRANSLATION_PROMPT_QUANT_REASONING },
    {
      role: "user",
      content: `Prompt: ${prompt}\n\nOptions: ${JSON.stringify(options)}\n\nExplanation: ${explanation}`,
    },
  ];
  return client.chatJson(messages, { maxTokens: 16384, responseFormat: { type: "json_object" }, enableThinking: false });
}

export async function translateEnglishLanguage(
  client: NimClient,
  prompt: string,
  options: { key: string; text: string }[],
  explanation: string,
  keyTerms?: string[]
): Promise<{ instructions: string; explanation: string; glossary: Record<string, string> }> {
  const messages = [
    { role: "system", content: TRANSLATION_PROMPT_ENGLISH },
    {
      role: "user",
      content: `Question (DO NOT TRANSLATE): ${prompt}\n\nOptions (DO NOT TRANSLATE): ${JSON.stringify(options)}\n\nExplanation to translate to Hindi: ${explanation}\n\nKey terms for glossary: ${keyTerms?.join(", ") || "auto-detect"}`,
    },
  ];
  return client.chatJson(messages, { maxTokens: 4096, responseFormat: { type: "json_object" }, enableThinking: false });
}

export async function translateQuestion(
  client: NimClient,
  section: string,
  prompt: string,
  options: { key: string; text: string }[],
  explanation: string,
  sharedContext?: string
): Promise<{
  prompt: string;
  options: { key: string; text: string }[];
  explanation: string;
  instructions?: string;
  glossary?: Record<string, string>;
}> {
  const fullPrompt = sharedContext ? `${sharedContext}\n\n${prompt}` : prompt;

  if (section === "English Language") {
    const result = await translateEnglishLanguage(client, fullPrompt, options, explanation);
    return {
      prompt: fullPrompt,
      options,
      explanation,
      instructions: result.instructions,
      explanation: result.explanation,
      glossary: result.glossary,
    };
  }

  const result = await translateQuantReasoning(client, fullPrompt, options, explanation);
  return {
    prompt: result.prompt,
    options: result.options,
    explanation: result.explanation,
  };
}