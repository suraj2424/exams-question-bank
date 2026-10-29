import { test, expect, describe } from "bun:test";
import { classifyQuestion, inferSectionFromRange } from "../src/classifier";

describe("classifier", () => {
  test("classifyQuestion detects English Language rearrangement", () => {
    const result = classifyQuestion(
      'The role played by human rights organisations in documenting (A) and questioning state component (B) and excesses is a necessary functioning(C) of civil society activism',
      "Directions (1-4): In each of the questions given below a sentence is given with three words in bold. Choose the option which gives the correct sequence of these words to make the sentence grammatically and contextually correct.",
      ["BAC", "None of these", "CAB", "BCA", "ACB"],
      1
    );
    expect(result.section).toBe("English Language");
    expect(result.topic).toBe("Rearrangement");
    expect(result.subtopic).toBe("Word Sequence");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test("classifyQuestion detects Quant DI line graph", () => {
    const result = classifyQuestion(
      "Find total number of boys visited in park A, B & C together?",
      "Direction (31 – 35): The Line graph shows the number of people (Boys + girls) visited five (A, B, C, D & E) different parks and the number of girls visited out of total people visited these five parks.",
      ["104", "102", "106", "108", "96"],
      31
    );
    expect(result.section).toBe("Quantitative Aptitude");
    expect(result.topic).toBe("Data Interpretation");
    expect(result.subtopic).toBe("Line Graph");
  });

  test("classifyQuestion detects Reasoning two rows", () => {
    const result = classifyQuestion(
      "How many students stand between P and S?",
      "Twelve students stand in two rows with six students standing in each row. Students in row 1 are facing north direction and students in row 2 are facing south direction.",
      ["None", "One", "Two", "More than three", "Three"],
      66
    );
    expect(result.section).toBe("Reasoning Ability");
    expect(result.topic).toBe("Seating Arrangement");
    expect(result.subtopic).toBe("Two Rows");
  });

  test("inferSectionFromRange", () => {
    expect(inferSectionFromRange(1)).toBe("English Language");
    expect(inferSectionFromRange(35)).toBe("English Language");
    expect(inferSectionFromRange(36)).toBe("Quantitative Aptitude");
    expect(inferSectionFromRange(65)).toBe("Quantitative Aptitude");
    expect(inferSectionFromRange(66)).toBe("Reasoning Ability");
    expect(inferSectionFromRange(100)).toBe("Reasoning Ability");
  });
});