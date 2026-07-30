import type { NetsuiteQuiz, QuizSummary } from "./netsuiteQuiz";

export type QuizImportResult = {
  imported: number;
  added: number;
  replaced: number;
  quizIds: string[];
  quizzes: QuizSummary[];
};

export type QuizDeleteResult = {
  deleted: true;
  quiz: QuizSummary;
  quizzes: QuizSummary[];
};

type QuizMessageResponse<T> = {
  ok?: boolean;
  result?: T;
  error?: string;
};

const sendQuizMessage = async <T>(
  message: Record<string, unknown>,
): Promise<T> => {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("The extension background worker is unavailable.");
  }
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as QuizMessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error || "The quiz request failed.");
  }
  return response.result as T;
};

export const listQuizzes = () =>
  sendQuizMessage<QuizSummary[]>({ type: "QUIZZES_LIST" });

export const getQuiz = (id: string) =>
  sendQuizMessage<NetsuiteQuiz | null>({ type: "QUIZZES_GET", id });

export const deleteQuiz = (id: string) =>
  sendQuizMessage<QuizDeleteResult>({ type: "QUIZZES_DELETE", id });

export const importQuizzes = (payload: unknown) =>
  sendQuizMessage<QuizImportResult>({
    type: "QUIZZES_IMPORT",
    payload,
  });
