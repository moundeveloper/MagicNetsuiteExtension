import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteQuiz } from "./quizStore";

describe("quiz store", () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockReset();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
  });

  it("deletes a concrete quiz bank by id", async () => {
    const response = {
      deleted: true as const,
      quiz: {
        id: "suiteql-bank",
        title: "SuiteQL",
        description: "",
        sourceBatchJobId: "batch-1",
        questionCount: 10,
        createdAt: 1,
        updatedAt: 1,
      },
      quizzes: [],
    };
    sendMessage.mockResolvedValue({ ok: true, result: response });

    await expect(deleteQuiz("suiteql-bank")).resolves.toEqual(response);
    expect(sendMessage).toHaveBeenCalledWith({
      type: "QUIZZES_DELETE",
      id: "suiteql-bank",
    });
  });

  it("surfaces a failed deletion from the background worker", async () => {
    sendMessage.mockResolvedValue({
      ok: false,
      error: 'Quiz "missing" was not found.',
    });

    await expect(deleteQuiz("missing")).rejects.toThrow(
      'Quiz "missing" was not found.',
    );
  });
});
