import { test, expect, describe } from "bun:test";
import { detectAnswerKeyPages, scoreAnswerKeyPage } from "../src/rag/extract";
import { RagPage } from "../src/rag/pdf";

function page(pageNumber: number, text: string): RagPage {
  return { pageNumber, text };
}

describe("rag answer key page detection", () => {
  test("scores a page with an answer key heading high", () => {
    const score = scoreAnswerKeyPage("Answer Key\nQ.No Answer\n1 B", false);
    expect(score).toBeGreaterThanOrEqual(5);
  });

  test("scores a dense answer list higher than a question page", () => {
    const answerList = "1 (B) 2 (C) 3 (A) 4 (D) 5 (E) 6 (B) 7 (C) 8 (A)";
    const questionPage = "Q1. What is the answer?\n(a) one\n(b) two\n(c) three\n(d) four";
    expect(scoreAnswerKeyPage(answerList, false)).toBeGreaterThan(scoreAnswerKeyPage(questionPage, false));
  });

  test("detects the answer table pages of a paper", () => {
    const pages = [
      page(1, "Directions (1-4): read carefully\nQ1. first question\n(a) x\n(b) y"),
      page(2, "Q2. second question\n(a) x\n(b) y"),
      page(3, "Answer Key\nQ.No  Answer\n1  B\n2  C\n3  D"),
    ];

    expect(detectAnswerKeyPages(pages)).toEqual([3]);
  });

  test("falls back to the tail pages when no heading is found", () => {
    const pages = [
      page(1, "Q1. first question\n(a) x\n(b) y"),
      page(2, "Q2. second question\n(a) x\n(b) y"),
      page(3, "1 B 2 C 3 D 4 E"),
    ];

    expect(detectAnswerKeyPages(pages)).toContain(3);
  });
});
