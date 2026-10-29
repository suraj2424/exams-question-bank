import { test, expect, describe } from "bun:test";
import { normalizePaperKey, extractPaperKeyFromUrl, extractPaperKeyFromTitle, inferDocKind, isSolutionsDoc, pairPaperKeys } from "../src/paper-key";

describe("paper-key", () => {
  test("normalizePaperKey strips domain and cleans", () => {
    expect(normalizePaperKey("https://www.careerpower.in/2021/ibps-po-prelims-2020.pdf")).toBe("careerpower-in-2021-ibps-po-prelims-2020-pdf");
    expect(normalizePaperKey("careerpower.in/2021/ibps-po-prelims-solutions-2020.pdf")).toBe("careerpower-in-2021-ibps-po-prelims-solutions-2020-pdf");
  });

  test("extractPaperKeyFromUrl handles path", () => {
    expect(extractPaperKeyFromUrl("https://www.careerpower.in/2021/ibps-po-prelims-2020.pdf")).toBe("ibps-po-prelims-2020-pdf");
  });

  test("extractPaperKeyFromTitle", () => {
    expect(extractPaperKeyFromTitle("IBPS PO Prelims 2020 Memory Based")).toBe("ibps-po-prelims-2020-memory-based");
  });

  test("inferDocKind detects solutions", () => {
    expect(inferDocKind("ibps-po-prelims-2020", "Solutions", "url")).toBe("solutions");
    expect(inferDocKind("ibps-po-prelims-2020", "Questions", "url")).toBe("questions");
    expect(inferDocKind("ibps-po-prelims-2020-sol", "Paper", "url")).toBe("solutions");
  });

  test("isSolutionsDoc", () => {
    expect(isSolutionsDoc("ibps-po-prelims-2020-sol", "", "")).toBe(true);
    expect(isSolutionsDoc("ibps-po-prelims-2020", "Solutions", "")).toBe(true);
    expect(isSolutionsDoc("ibps-po-prelims-2020", "Questions", "")).toBe(false);
  });

  test("pairPaperKeys groups by base", () => {
    const keys = [
      "ibps-po-prelims-2020",
      "ibps-po-prelims-2020-solutions",
      "ibps-po-prelims-2019",
      "ibps-po-prelims-2019-sol",
    ];
    const pairs = pairPaperKeys(keys);
    expect(pairs.get("ibps-po-prelims-2020")?.questions).toBe("ibps-po-prelims-2020");
    expect(pairs.get("ibps-po-prelims-2020")?.solutions).toBe("ibps-po-prelims-2020-solutions");
    expect(pairs.get("ibps-po-prelims-2019")?.questions).toBe("ibps-po-prelims-2019");
    expect(pairs.get("ibps-po-prelims-2019")?.solutions).toBe("ibps-po-prelims-2019-sol");
  });
});