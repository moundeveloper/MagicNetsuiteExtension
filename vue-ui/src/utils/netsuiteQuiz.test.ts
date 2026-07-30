import { describe, expect, it } from "vitest";
import {
  buildCitationHighlightUrl,
  combineQuizQuestions,
  createQuizExportPackage,
  formatQuizTime,
  getExamDurationSeconds,
  getQuestionCountOptions,
  getQuizImportCandidates,
  gradeQuizSelections,
  isQuizAnswerCorrect,
  selectRandomQuestions,
  stripCitationMarkdown,
  type QuizQuestion,
} from "./netsuiteQuiz";

const question = (id: string): QuizQuestion => ({
  id,
  type: "single",
  prompt: `Question ${id}`,
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  correctOptionIds: ["a"],
  explanation: "Because A is correct.",
  citations: [
    {
      title: "NetSuite Help",
      url: "https://example.app.netsuite.com/app/help/helpcenter.nl?fid=test.html",
      quote: "A is correct.",
    },
  ],
});

const uncitedQuestion = (id: string): QuizQuestion => {
  const value = question(id);
  delete value.citations;
  return value;
};

describe("NetSuite quiz session helpers", () => {
  it("grades single and multiple answers without depending on selection order", () => {
    expect(isQuizAnswerCorrect({ correctOptionIds: ["a"] }, ["a"])).toBe(true);
    expect(isQuizAnswerCorrect({ correctOptionIds: ["a"] }, ["b"])).toBe(false);
    expect(
      isQuizAnswerCorrect({ correctOptionIds: ["a", "c"] }, ["c", "a"]),
    ).toBe(true);
    expect(
      isQuizAnswerCorrect({ correctOptionIds: ["a", "c"] }, ["a"]),
    ).toBe(false);
  });

  it("grades final exam selections only from their latest editable values", () => {
    const questions = [question("one"), question("two")];

    expect(
      gradeQuizSelections(questions, {
        one: ["b"],
        two: [],
      }),
    ).toMatchObject({
      one: { selectedOptionIds: ["b"], correct: false },
      two: { selectedOptionIds: [], correct: false },
    });

    expect(
      gradeQuizSelections(questions, {
        one: ["a"],
        two: ["a"],
      }),
    ).toMatchObject({
      one: { selectedOptionIds: ["a"], correct: true },
      two: { selectedOptionIds: ["a"], correct: true },
    });
  });

  it("scales the exam timer to 90 minutes for 60 questions", () => {
    expect(getExamDurationSeconds(10)).toBe(15 * 60);
    expect(getExamDurationSeconds(60)).toBe(90 * 60);
    expect(formatQuizTime(90 * 60)).toBe("90:00");
  });

  it("offers counts from 10 through the available maximum, capped at 60", () => {
    expect(getQuestionCountOptions(9)).toEqual([]);
    expect(getQuestionCountOptions(26).map((option) => option.value)).toEqual([
      10, 20, 26,
    ]);
    expect(getQuestionCountOptions(100).map((option) => option.value)).toEqual([
      10, 20, 30, 40, 50, 60,
    ]);
  });

  it("selects a bounded random subset without changing the source bank", () => {
    const source = ["1", "2", "3", "4"].map(question);
    const selected = selectRandomQuestions(source, 2, () => 0);
    expect(selected).toHaveLength(2);
    expect(source.map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
    expect(new Set(selected.map((item) => item.id)).size).toBe(2);
  });

  it("creates an embedded-reader fragment from the cited quote", () => {
    const url = buildCitationHighlightUrl({
      title: "Governance",
      url: "https://123.app.netsuite.com/app/help/helpcenter.nl?fid=limits.html#old",
      quote: "  Map/Reduce scripts yield automatically.  ",
    });
    expect(url).toBe(
      "https://123.app.netsuite.com/app/help/helpcenter.nl?fid=limits.html#magic-netsuite-quiz=Map%2FReduce%20scripts%20yield%20automatically.",
    );
  });

  it("removes Markdown decoration from literal citation text", () => {
    const decorated =
      "“Unsupported: `CHAR`, **DEFAULT**, and [*SELECT lists*](https://example.com).”";
    expect(stripCitationMarkdown(decorated)).toBe(
      "Unsupported: CHAR, DEFAULT, and SELECT lists.",
    );

    const url = buildCitationHighlightUrl({
      title: "SuiteQL limitations",
      url: "https://123.app.netsuite.com/app/help/helpcenter.nl?fid=suiteql.html",
      quote: "Subqueries in `SELECT` lists.",
    });
    expect(url).toContain(
      "#magic-netsuite-quiz=Subqueries%20in%20SELECT%20lists.",
    );
  });

  it("combines banks without question ID collisions or source mutation", () => {
    const first = {
      id: "bank-a",
      title: "Bank A",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      questions: [question("shared")],
    };
    const second = {
      ...first,
      id: "bank-b",
      title: "Bank B",
      questions: [question("shared")],
    };

    const combined = combineQuizQuestions([first, second]);

    expect(combined.map((item) => item.id)).toEqual([
      "bank-a:shared",
      "bank-b:shared",
    ]);
    expect(combined.map((item) => item.topic)).toEqual(["Bank A", "Bank B"]);
    expect(first.questions[0]?.id).toBe("shared");
  });

  it("supports questions whose answer is derived without a citation", () => {
    const uncited = uncitedQuestion("code-reasoning");
    expect(uncited.citations).toBeUndefined();
    expect(isQuizAnswerCorrect(uncited, ["a"])).toBe(true);
  });

  it("creates and reads a versioned portable quiz package", () => {
    const quiz = {
      id: "bank-a",
      title: "Bank A",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      questions: [question("one")],
    };
    const exported = createQuizExportPackage([quiz], 123);

    expect(exported).toMatchObject({
      format: "magic-netsuite-quizzes",
      version: 1,
      exportedAt: 123,
    });
    expect(getQuizImportCandidates(exported)).toEqual([quiz]);
    expect(getQuizImportCandidates(quiz)).toEqual([quiz]);
    expect(() =>
      getQuizImportCandidates({
        ...exported,
        version: 2,
      }),
    ).toThrow("Unsupported quiz export version");
  });
});
