import { test, expect, describe } from "bun:test";
import { joinAnswers, normalizeAnswers, normalizeQuestions } from "../src/rag/normalize";

describe("rag normalize", () => {
  test("normalizes questions, options and flags incomplete option sets", () => {
    const result = normalizeQuestions([
      {
        number: 1,
        stem: "  What is 2 + 2?  ",
        options: [
          { key: "a", text: "3" },
          { key: "B", text: "4" },
          { key: "c", text: "5" },
          { key: "d", text: "None" },
          { key: "e", text: "Cannot say" },
        ],
        sharedContext: "Directions (1-4): choose one",
      },
      { number: 2, stem: "Broken question", options: [{ key: "A", text: "only" }] },
    ]);

    expect(result.questions.length).toBe(2);
    const first = result.questions[0];
    expect(first.number).toBe(1);
    expect(first.stem).toBe("What is 2 + 2?");
    expect(first.options.map((o) => o.key)).toEqual(["A", "B", "C", "D", "E"]);
    expect(first.options[1].text).toBe("4");
    expect(first.sharedContext).toBe("Directions (1-4): choose one");
    expect(first.flags).toEqual([]);
    expect(result.questions[1].flags).toContain("options_incomplete");
  });

  test("drops invalid question numbers and duplicate option keys", () => {
    const result = normalizeQuestions([
      { number: 0, stem: "invalid", options: [] },
      { number: 3, stem: "valid", options: [
        { key: "A", text: "first" },
        { key: "A", text: "first but longer" },
        { key: "Z", text: "invalid key" },
        { key: "B", text: "" },
      ] },
    ]);

    expect(result.questions.length).toBe(1);
    expect(result.questions[0].options.length).toBe(1);
    expect(result.questions[0].options[0].text).toBe("first but longer");
    expect(result.warnings.some((w) => w.includes("invalid number"))).toBe(true);
  });

  test("keeps the most complete copy of a duplicated question number", () => {
    const result = normalizeQuestions([
      { number: 7, stem: "short", options: [{ key: "A", text: "a" }] },
      {
        number: 7,
        stem: "full stem",
        options: [
          { key: "A", text: "a" },
          { key: "B", text: "b" },
          { key: "C", text: "c" },
          { key: "D", text: "d" },
        ],
      },
    ]);

    expect(result.questions.length).toBe(1);
    expect(result.questions[0].stem).toBe("full stem");
    expect(result.questions[0].options.length).toBe(4);
    expect(result.warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });

  test("normalizes answer letters and reports conflicts", () => {
    const result = normalizeAnswers([
      { number: 1, key: "b" },
      { number: 1, key: "C" },
      { number: 2, key: "?" },
      { number: 3, key: "E", explanation: "because" },
    ]);

    expect(result.answers.length).toBe(2);
    expect(result.answers[0]).toMatchObject({ number: 1, key: "B" });
    expect(result.answers[1].explanation).toBe("because");
    expect(result.warnings.some((w) => w.includes("conflicting"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("answer letter missing"))).toBe(true);
  });

  test("joins the answer table onto the questions", () => {
    const { questions } = normalizeQuestions([
      {
        number: 1,
        stem: "q1",
        options: [
          { key: "A", text: "a" },
          { key: "B", text: "b" },
          { key: "C", text: "c" },
          { key: "D", text: "d" },
        ],
      },
      {
        number: 2,
        stem: "q2",
        options: [
          { key: "A", text: "a" },
          { key: "B", text: "b" },
          { key: "C", text: "c" },
          { key: "D", text: "d" },
        ],
      },
      {
        number: 3,
        stem: "q3",
        options: [
          { key: "A", text: "a" },
          { key: "B", text: "b" },
          { key: "C", text: "c" },
          { key: "D", text: "d" },
        ],
      },
    ]);
    const { answers } = normalizeAnswers([
      { number: 1, key: "B" },
      { number: 2, key: "E" },
      { number: 9, key: "A" },
    ]);

    const join = joinAnswers(questions, answers);
    expect(join.matched).toBe(1);
    expect(join.missingOption).toBe(1);
    expect(join.entries.find((e) => e.questionNumber === 1)).toEqual({
      questionNumber: 1,
      key: "B",
      optionKey: "B",
      status: "matched",
    });
    expect(join.entries.find((e) => e.questionNumber === 2)?.status).toBe("missing_option");
    expect(join.questionsWithoutAnswer).toEqual([3]);
    expect(join.answersWithoutQuestion).toEqual([9]);
  });
});
