import { SECTIONS } from "@qb/shared";

export interface SectionTopic {
  section: string;
  topic: string;
  subtopic: string;
  confidence: number;
}

const SECTION_KEYWORDS: Record<string, { section: string; topic: string; subtopic: string; keywords: string[] }[]> = {
  "English Language": [
    { section: "English Language", topic: "Rearrangement", subtopic: "Word Sequence", keywords: ["three words in bold", "correct sequence", "sequence of these words"] },
    { section: "English Language", topic: "Rearrangement", subtopic: "Sentence Rearrangement", keywords: ["rearrange the parts", "parts of the sentence", "grammatically correct and contextually"] },
    { section: "English Language", topic: "Rearrangement", subtopic: "Phrase Replacement", keywords: ["replace the phrase", "phrase printed in bold", "no replacement required"] },
    { section: "English Language", topic: "Reading Comprehension", subtopic: "Passage", keywords: ["read the following passage", "passage carefully", "rc was based on"] },
    { section: "English Language", topic: "Fill in the Blanks", subtopic: "Cloze Test", keywords: ["blank spaces", "fill the blank", "corresponding to each blank"] },
    { section: "English Language", topic: "Grammar", subtopic: "Sentence Correction", keywords: ["grammatically correct", "find the sentence", "sentence(s) which is/are grammatically"] },
    { section: "English Language", topic: "Vocabulary", subtopic: "Synonym/Antonym", keywords: ["word which can replace", "similar meaning", "most similar meaning"] },
  ],
  "Quantitative Aptitude": [
    { section: "Quantitative Aptitude", topic: "Data Interpretation", subtopic: "Line Graph", keywords: ["line graph shows", "number of people", "visited five", "parks"] },
    { section: "Quantitative Aptitude", topic: "Data Interpretation", subtopic: "Table", keywords: ["table shows", "items sold", "percentage of items", "type a items sold"] },
    { section: "Quantitative Aptitude", topic: "Data Interpretation", subtopic: "Caselet", keywords: ["data shows total", "male and female", "companies in a seminar"] },
    { section: "Quantitative Aptitude", topic: "Number Series", subtopic: "Missing Term", keywords: ["what will come in the place of question mark", "number series", "place of question mark"] },
    { section: "Quantitative Aptitude", topic: "Quadratic Equations", subtopic: "Two Equations", keywords: ["two equations questions", "solve both equations", "x²", "y²"] },
    { section: "Quantitative Aptitude", topic: "Arithmetic", subtopic: "Simple Interest", keywords: ["simple interest", "rate of interest on simple"] },
    { section: "Quantitative Aptitude", topic: "Arithmetic", subtopic: "Time and Work", keywords: ["more efficient than", "complete a work", "days", "work alone"] },
    { section: "Quantitative Aptitude", topic: "Arithmetic", subtopic: "Speed Time Distance", keywords: ["train", "crosses a platform", "speed of", "km/hr", "upstream", "downstream"] },
    { section: "Quantitative Aptitude", topic: "Arithmetic", subtopic: "Age Problems", keywords: ["ratio of age", "years ago", "present age"] },
    { section: "Quantitative Aptitude", topic: "Arithmetic", subtopic: "Profit and Loss", keywords: ["marks up price", "cost price", "discount", "loss", "profit"] },
    { section: "Quantitative Aptitude", topic: "Arithmetic", subtopic: "Mixture and Alligation", keywords: ["mixture of milk and water", "proportion of milk", "water is added"] },
    { section: "Quantitative Aptitude", topic: "Mensuration", subtopic: "Surface Area Volume", keywords: ["sphere", "melted", "cylinder", "surface area"] },
    { section: "Quantitative Aptitude", topic: "Partnership", subtopic: "Profit Sharing", keywords: ["partners", "invested", "ratio of", "profit share"] },
    { section: "Quantitative Aptitude", topic: "Boat and Stream", subtopic: "Upstream Downstream", keywords: ["speed of stream", "upstream", "downstream", "still water"] },
  ],
  "Reasoning Ability": [
    { section: "Reasoning Ability", topic: "Seating Arrangement", subtopic: "Two Rows", keywords: ["two rows", "facing north", "facing south", "row 1", "row 2", "each student in row 1 faces"] },
    { section: "Reasoning Ability", topic: "Seating Arrangement", subtopic: "Linear", keywords: ["sit in a linear row", "faces in the north direction", "persons sit in a linear"] },
    { section: "Reasoning Ability", topic: "Seating Arrangement", subtopic: "Vertical", keywords: ["vertical row", "immediate above", "bottommost position", "sits consecutive"] },
    { section: "Reasoning Ability", topic: "Coding-Decoding", subtopic: "Language Code", keywords: ["code language", "coded as", "work is worship", "work hard always"] },
    { section: "Reasoning Ability", topic: "Syllogism", subtopic: "Conclusions", keywords: ["statements followed by two conclusions", "only a few", "only summer is", "all bus is train", "no chocolates are biscuits"] },
    { section: "Reasoning Ability", topic: "Puzzle", subtopic: "Scheduling", keywords: ["different cities", "different dates", "months", "goes to", "on an odd-numbered date"] },
    { section: "Reasoning Ability", topic: "Blood Relations", subtopic: "Family Tree", keywords: ["son in law", "brother in law", "generations", "family members", "mother", "father", "sister", "brother"] },
    { section: "Reasoning Ability", topic: "Inequalities", subtopic: "Symbolic", keywords: ["d>g", "v<q", "w>s", "statement:", "conclusions:"] },
    { section: "Reasoning Ability", topic: "Number Series", subtopic: "Digit Pairs", keywords: ["pairs of digits", "number series", "as in the number series"] },
    { section: "Reasoning Ability", topic: "Alphabet Test", subtopic: "Word Formation", keywords: ["vowels are arranged", "alphabetical increasing order", "consonants are arranged", "word"] },
    { section: "Reasoning Ability", topic: "Direction Sense", subtopic: "Final Direction", keywords: ["walks", "km north", "km east", "final direction"] },
  ],
};

function matchKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) hits++;
  }
  return hits;
}

export function classifyQuestion(
  questionText: string,
  sharedContext: string,
  options: string[],
  questionNumber?: number,
  paperKey?: string
): SectionTopic {
  const combined = `${sharedContext} ${questionText} ${options.join(" ")}`.toLowerCase();
  let best: SectionTopic = { section: "English Language", topic: "General", subtopic: "Unclassified", confidence: 0.1 };

  const rangeSection = questionNumber ? inferSectionFromRange(questionNumber, paperKey) : null;

  for (const [section, rules] of Object.entries(SECTION_KEYWORDS)) {
    for (const rule of rules) {
      const hits = matchKeywords(combined, rule.keywords);
      if (hits > 0) {
        let confidence = Math.min(0.95, 0.5 + hits * 0.15);
        if (rangeSection && section === rangeSection) confidence = Math.min(0.98, confidence + 0.15);
        if (confidence > best.confidence) {
          best = { section: rule.section, topic: rule.topic, subtopic: rule.subtopic, confidence };
        }
      }
    }
  }

  if (rangeSection && best.confidence < 0.7) {
    best = { section: rangeSection, topic: best.topic, subtopic: best.subtopic, confidence: Math.max(best.confidence, 0.7) };
  }

  if (!SECTIONS.includes(best.section as any)) {
    best.section = "English Language";
  }

  return best;
}

export function inferSectionFromRange(questionNumber: number, paperKey?: string): string {
  if (paperKey?.includes("ibps-po-prelims-2020")) {
    if (questionNumber <= 30) return "English Language";
    if (questionNumber <= 65) return "Quantitative Aptitude";
    return "Reasoning Ability";
  }
  if (questionNumber <= 35) return "English Language";
  if (questionNumber <= 65) return "Quantitative Aptitude";
  return "Reasoning Ability";
}