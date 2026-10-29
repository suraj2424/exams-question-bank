import { test, expect, describe } from "bun:test";
import { parseSolutionText, joinAnswerKey, ParsedAnswerKey } from "../src/answer-key";

describe("answer-key", () => {
  const sampleSolutions = `
S1. Ans.(e)
Sol. ACB is the correct sequence. The role played by human rights organisations in documenting and questioning state functioning and excesses is a necessary component of civil society activism

S2. Ans.(e)
Sol. BCA is the correct sequence. The C&AG's observations in its financial audit report relate to the denial of States' share in the divisible taxes pool.

S3. Ans.(b)
Sol. CAB is the correct sequence. Many countries have chosen to ignore the connection between biodiversity and well-being, and depleted ecological capital in pursuit of financial prosperity.

S31. Ans.(a)
Sol. Total boys in A = 40, B = 30, C = 34. Total = 104.
`;

  test("parseSolutionText extracts entries", () => {
    const result = parseSolutionText(sampleSolutions);
    expect(result.entries.length).toBeGreaterThanOrEqual(3);
    const e1 = result.entries.find((e) => e.questionNumber === 1);
    expect(e1?.key).toBe("E");
    expect(e1?.explanation).toContain("ACB is the correct sequence");
  });

  test("parseSolutionText handles different formats", () => {
    const alt = "S 1. Ans.(a) Sol. This is a test.";
    const result = parseSolutionText(alt);
    expect(result.entries.some((e) => e.questionNumber === 1 && e.key === "A")).toBe(true);
  });

  test("joinAnswerKey maps answers to questions", () => {
    const answerKey: ParsedAnswerKey = {
      paperTitle: "test",
      entries: [
        { questionNumber: 1, key: "E", explanation: "Expl 1" },
        { questionNumber: 31, key: "A", explanation: "Expl 31" },
      ],
    };
    const questions = [{ number: 1, setId: null }, { number: 31, setId: "set_001" }, { number: 50, setId: null }];
    const map = joinAnswerKey(questions, answerKey);
    expect(map.get(1)?.key).toBe("E");
    expect(map.get(31)?.key).toBe("A");
    expect(map.has(50)).toBe(false);
  });
});