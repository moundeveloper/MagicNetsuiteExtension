export type QuizMode = "assisted" | "exam";
export type QuizQuestionType = "single" | "multiple";

export type QuizOption = {
  id: string;
  text: string;
};

export type QuizCitation = {
  title: string;
  url: string;
  quote: string;
};

export type QuizCodeBlock = {
  language: string;
  content: string;
  caption?: string;
};

export type QuizQuestion = {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  code?: QuizCodeBlock;
  options: QuizOption[];
  correctOptionIds: string[];
  explanation: string;
  citations?: QuizCitation[];
  topic?: string;
};

export type NetsuiteQuiz = {
  id: string;
  title: string;
  description: string;
  questions: QuizQuestion[];
  sourceBatchJobId?: string;
  createdAt: number;
  updatedAt: number;
};

export type QuizSummary = Omit<NetsuiteQuiz, "questions"> & {
  questionCount: number;
};

export type QuizAnswer = {
  questionId: string;
  selectedOptionIds: string[];
  correct: boolean;
};

export type QuizExportPackage = {
  format: "magic-netsuite-quizzes";
  version: 1;
  exportedAt: number;
  quizzes: NetsuiteQuiz[];
};

export const MIN_QUIZ_QUESTIONS = 10;
export const MAX_QUIZ_QUESTIONS = 60;
export const EXAM_SECONDS_PER_QUESTION = 90;

const sortedUnique = (values: string[]) =>
  [...new Set(values.map(String))].sort();

export const isQuizAnswerCorrect = (
  question: Pick<QuizQuestion, "correctOptionIds">,
  selectedOptionIds: string[],
) => {
  const expected = sortedUnique(question.correctOptionIds);
  const selected = sortedUnique(selectedOptionIds);
  return (
    expected.length === selected.length &&
    expected.every((value, index) => value === selected[index])
  );
};

export const gradeQuizSelections = (
  questions: QuizQuestion[],
  selections: Record<string, string[]>,
) =>
  Object.fromEntries(
    questions.map((question) => {
      const selectedOptionIds = [...(selections[question.id] ?? [])];
      return [
        question.id,
        {
          questionId: question.id,
          selectedOptionIds,
          correct: isQuizAnswerCorrect(question, selectedOptionIds),
        } satisfies QuizAnswer,
      ];
    }),
  );

export const getExamDurationSeconds = (questionCount: number) => {
  const normalized = Math.min(
    MAX_QUIZ_QUESTIONS,
    Math.max(MIN_QUIZ_QUESTIONS, Math.floor(questionCount)),
  );
  return normalized * EXAM_SECONDS_PER_QUESTION;
};

export const getQuestionCountOptions = (availableQuestions: number) => {
  const maximum = Math.min(
    MAX_QUIZ_QUESTIONS,
    Math.max(0, Math.floor(availableQuestions)),
  );
  if (maximum < MIN_QUIZ_QUESTIONS) return [];

  const values: number[] = [];
  for (
    let count = MIN_QUIZ_QUESTIONS;
    count <= maximum;
    count += MIN_QUIZ_QUESTIONS
  ) {
    values.push(count);
  }
  if (values[values.length - 1] !== maximum) values.push(maximum);
  return values.map((value) => ({
    value,
    label:
      value === MAX_QUIZ_QUESTIONS
        ? `${value} questions · 90 min exam`
        : `${value} questions`,
  }));
};

export const selectRandomQuestions = (
  questions: QuizQuestion[],
  count: number,
  random: () => number = Math.random,
) => {
  const shuffled = [...questions];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
};

export const combineQuizQuestions = (quizzes: NetsuiteQuiz[]) =>
  quizzes.flatMap((quiz) =>
    quiz.questions.map((question) => ({
      ...question,
      id: `${quiz.id}:${question.id}`,
      topic: question.topic
        ? `${quiz.title} · ${question.topic}`
        : quiz.title,
    })),
  );

export const createQuizExportPackage = (
  quizzes: NetsuiteQuiz[],
  exportedAt = Date.now(),
): QuizExportPackage => ({
  format: "magic-netsuite-quizzes",
  version: 1,
  exportedAt,
  quizzes,
});

export const getQuizImportCandidates = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") {
    throw new Error("The selected file does not contain quiz data.");
  }
  const input = value as Record<string, unknown>;
  if (input.format === "magic-netsuite-quizzes") {
    if (input.version !== 1) {
      throw new Error(`Unsupported quiz export version "${String(input.version)}".`);
    }
    if (!Array.isArray(input.quizzes)) {
      throw new Error("The quiz export package does not contain a quizzes array.");
    }
    return input.quizzes;
  }
  if (Array.isArray(input.quizzes)) return input.quizzes;
  if (Array.isArray(input.questions)) return [input];
  throw new Error("The selected file does not contain a quiz or quiz package.");
};

export const formatQuizTime = (seconds: number) => {
  const normalized = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(normalized / 60);
  const remainder = normalized % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

export const stripCitationMarkdown = (value: string) =>
  value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(`+)([\s\S]*?)\1/g, "$2")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1$2")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/^“([\s\S]*)”$/, "$1")
    .replace(/^'([\s\S]*)'$/, "$1")
    .replace(/^‘([\s\S]*)’$/, "$1");

export const buildCitationHighlightUrl = (citation: QuizCitation) => {
  const quote = stripCitationMarkdown(citation.quote).slice(0, 500);
  if (!quote) return citation.url;
  const baseUrl = citation.url.split("#")[0] ?? citation.url;
  return `${baseUrl}#magic-netsuite-quiz=${encodeURIComponent(quote)}`;
};
