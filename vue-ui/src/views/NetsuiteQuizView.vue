<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MSelect from "../components/universal/input/MSelect.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
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
  type NetsuiteQuiz,
  type QuizAnswer,
  type QuizCitation,
  type QuizMode,
  type QuizQuestion,
  type QuizSummary,
} from "../utils/netsuiteQuiz";
import {
  deleteQuiz,
  getQuiz,
  importQuizzes,
  listQuizzes,
} from "../utils/quizStore";

type QuizPhase = "setup" | "question" | "results";
type QuizResultReason = "completed" | "time-expired" | "exited";

const ALL_BANKS_ID = "__all_banks__";
const quizzes = ref<QuizSummary[]>([]);
const activeQuiz = ref<NetsuiteQuiz | null>(null);
const selectedQuizId = ref("");
const mode = ref<QuizMode>("assisted");
const questionCount = ref<number | null>(null);
const phase = ref<QuizPhase>("setup");
const sessionQuestions = ref<QuizQuestion[]>([]);
const currentIndex = ref(0);
const selections = ref<Record<string, string[]>>({});
const answers = ref<Record<string, QuizAnswer>>({});
const resultReason = ref<QuizResultReason>("completed");
const resultQuestionIds = ref<string[]>([]);
const loading = ref(true);
const loadingQuiz = ref(false);
const quizFileInput = ref<HTMLInputElement | null>(null);
const transferBusy = ref(false);
const transferNotice = ref<{
  type: "success" | "error";
  message: string;
} | null>(null);
const deleteCandidate = ref<QuizSummary | null>(null);
const error = ref("");
const remainingSeconds = ref(0);
const citationPanel = ref<{ citation: QuizCitation; url: string } | null>(null);
const citationFrame = ref<HTMLIFrameElement | null>(null);
const citationFrameStatus = ref<"loading" | "ready" | "error">("loading");
const citationFrameMessage = ref("");
const citationPanelWidth = ref(44);
const isResizingCitation = ref(false);
let timer: number | null = null;
let citationStatusTimer: number | null = null;
let stopCitationResize: (() => void) | null = null;

const countOptions = computed(() =>
  getQuestionCountOptions(activeQuiz.value?.questions.length ?? 0),
);
const currentQuestion = computed(
  () => sessionQuestions.value[currentIndex.value] ?? null,
);
const currentSelection = computed(() =>
  currentQuestion.value
    ? selections.value[currentQuestion.value.id] ?? []
    : [],
);
const currentAnswer = computed(() =>
  currentQuestion.value ? answers.value[currentQuestion.value.id] ?? null : null,
);
const resultQuestions = computed(() => {
  const included = new Set(resultQuestionIds.value);
  return sessionQuestions.value.filter((question) => included.has(question.id));
});
const answeredCount = computed(() => Object.keys(answers.value).length);
const score = computed(
  () => Object.values(answers.value).filter((answer) => answer.correct).length,
);
const scorePercent = computed(() =>
  resultQuestions.value.length
    ? Math.round((score.value / resultQuestions.value.length) * 100)
    : 0,
);
const resultEyebrow = computed(() => {
  if (resultReason.value === "exited") return "Session ended";
  if (resultReason.value === "time-expired") return "Time expired";
  return mode.value === "exam" ? "Exam complete" : "Practice complete";
});
const resultScoreText = computed(() =>
  resultQuestions.value.length
    ? `${score.value} / ${resultQuestions.value.length} correct`
    : "No answered questions",
);
const resultDetail = computed(() =>
  resultReason.value === "exited"
    ? `${resultQuestions.value.length} of ${sessionQuestions.value.length} answered · ${scorePercent.value}% score`
    : `${scorePercent.value}% score`,
);
const progressPercent = computed(() =>
  sessionQuestions.value.length
    ? Math.round(((currentIndex.value + 1) / sessionQuestions.value.length) * 100)
    : 0,
);
const canStart = computed(
  () =>
    Boolean(activeQuiz.value) &&
    Boolean(questionCount.value) &&
    (activeQuiz.value?.questions.length ?? 0) >= 10,
);
const correctOptionText = computed(() => {
  const question = currentQuestion.value;
  if (!question) return "";
  const correct = new Set(question.correctOptionIds);
  return question.options
    .filter((option) => correct.has(option.id))
    .map((option) => option.text)
    .join(", ");
});

const clearTimer = () => {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
};

const clearCitationStatusTimer = () => {
  if (citationStatusTimer !== null) {
    window.clearTimeout(citationStatusTimer);
    citationStatusTimer = null;
  }
};

const finishExam = (
  reason: Exclude<QuizResultReason, "exited"> = "completed",
) => {
  answers.value = gradeQuizSelections(
    sessionQuestions.value,
    selections.value,
  );
  resultReason.value = reason;
  resultQuestionIds.value = sessionQuestions.value.map(
    (question) => question.id,
  );
  clearTimer();
  clearCitationStatusTimer();
  citationPanel.value = null;
  phase.value = "results";
};

const startTimer = () => {
  clearTimer();
  if (mode.value !== "exam") return;
  timer = window.setInterval(() => {
    remainingSeconds.value = Math.max(0, remainingSeconds.value - 1);
    if (remainingSeconds.value === 0) finishExam("time-expired");
  }, 1000);
};

const loadSelectedQuiz = async () => {
  if (!selectedQuizId.value) {
    activeQuiz.value = null;
    questionCount.value = null;
    return;
  }
  loadingQuiz.value = true;
  error.value = "";
  try {
    if (selectedQuizId.value === ALL_BANKS_ID) {
      const banks = (
        await Promise.all(quizzes.value.map((quiz) => getQuiz(quiz.id)))
      ).filter((quiz): quiz is NetsuiteQuiz => Boolean(quiz));
      const now = Date.now();
      activeQuiz.value = {
        id: ALL_BANKS_ID,
        title: "All banks shuffled",
        description:
          "A combined session drawn randomly from every available NetSuite question bank.",
        questions: combineQuizQuestions(banks),
        createdAt: now,
        updatedAt: now,
      };
    } else {
      activeQuiz.value = await getQuiz(selectedQuizId.value);
    }
    const options = getQuestionCountOptions(
      activeQuiz.value?.questions.length ?? 0,
    );
    questionCount.value = options[options.length - 1]?.value ?? null;
  } catch (cause) {
    activeQuiz.value = null;
    questionCount.value = null;
    error.value =
      cause instanceof Error ? cause.message : "The quiz could not be loaded.";
  } finally {
    loadingQuiz.value = false;
  }
};

const loadQuizzes = async () => {
  loading.value = true;
  error.value = "";
  try {
    quizzes.value = await listQuizzes();
    if (
      deleteCandidate.value &&
      !quizzes.value.some((quiz) => quiz.id === deleteCandidate.value?.id)
    ) {
      deleteCandidate.value = null;
    }
    if (
      !selectedQuizId.value ||
      (selectedQuizId.value !== ALL_BANKS_ID &&
        !quizzes.value.some((quiz) => quiz.id === selectedQuizId.value))
    ) {
      selectedQuizId.value =
        quizzes.value.length > 1 ? ALL_BANKS_ID : quizzes.value[0]?.id ?? "";
    }
    await loadSelectedQuiz();
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : "Quizzes could not be loaded.";
  } finally {
    loading.value = false;
  }
};

const exportSelectedQuizzes = async () => {
  if (!activeQuiz.value || transferBusy.value) return;
  transferBusy.value = true;
  transferNotice.value = null;
  try {
    const banks =
      selectedQuizId.value === ALL_BANKS_ID
        ? (
            await Promise.all(quizzes.value.map((quiz) => getQuiz(quiz.id)))
          ).filter((quiz): quiz is NetsuiteQuiz => Boolean(quiz))
        : [activeQuiz.value];
    const payload = createQuizExportPackage(banks);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const name =
      banks.length === 1
        ? banks[0]!.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        : "all-banks";
    link.href = url;
    link.download = `magic-netsuite-quizzes-${name || "export"}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    transferNotice.value = {
      type: "success",
      message: `Exported ${banks.length} quiz bank${banks.length === 1 ? "" : "s"}.`,
    };
  } catch (cause) {
    transferNotice.value = {
      type: "error",
      message:
        cause instanceof Error ? cause.message : "The quiz export failed.",
    };
  } finally {
    transferBusy.value = false;
  }
};

const chooseQuizImport = () => {
  if (!transferBusy.value) quizFileInput.value?.click();
};

const requestDeleteSelectedQuiz = () => {
  if (
    transferBusy.value ||
    !selectedQuizId.value ||
    selectedQuizId.value === ALL_BANKS_ID
  ) {
    return;
  }
  deleteCandidate.value =
    quizzes.value.find((quiz) => quiz.id === selectedQuizId.value) ?? null;
  transferNotice.value = null;
};

const confirmDeleteQuiz = async () => {
  const candidate = deleteCandidate.value;
  if (!candidate || transferBusy.value) return;
  transferBusy.value = true;
  transferNotice.value = null;
  try {
    const result = await deleteQuiz(candidate.id);
    quizzes.value = result.quizzes;
    deleteCandidate.value = null;
    selectedQuizId.value =
      result.quizzes.length > 1
        ? ALL_BANKS_ID
        : result.quizzes[0]?.id ?? "";
    await loadSelectedQuiz();
    transferNotice.value = {
      type: "success",
      message: `Deleted “${candidate.title}”.`,
    };
  } catch (cause) {
    transferNotice.value = {
      type: "error",
      message:
        cause instanceof Error ? cause.message : "The quiz bank could not be deleted.",
    };
  } finally {
    transferBusy.value = false;
  }
};

const handleQuizImport = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || transferBusy.value) return;
  transferBusy.value = true;
  transferNotice.value = null;
  try {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Quiz import files must be 10 MB or smaller.");
    }
    const payload = JSON.parse(await file.text()) as unknown;
    getQuizImportCandidates(payload);
    const result = await importQuizzes(payload);
    selectedQuizId.value = result.quizIds[0] ?? selectedQuizId.value;
    await loadQuizzes();
    transferNotice.value = {
      type: "success",
      message: `Imported ${result.imported} bank${result.imported === 1 ? "" : "s"} · ${result.added} added · ${result.replaced} replaced.`,
    };
  } catch (cause) {
    transferNotice.value = {
      type: "error",
      message:
        cause instanceof Error ? cause.message : "The quiz import failed.",
    };
  } finally {
    transferBusy.value = false;
    input.value = "";
  }
};

watch(selectedQuizId, () => {
  deleteCandidate.value = null;
  if (!loading.value && !transferBusy.value) void loadSelectedQuiz();
});

const startQuiz = () => {
  if (!activeQuiz.value || !questionCount.value || !canStart.value) return;
  sessionQuestions.value = selectRandomQuestions(
    activeQuiz.value.questions,
    questionCount.value,
  );
  currentIndex.value = 0;
  selections.value = {};
  answers.value = {};
  resultReason.value = "completed";
  resultQuestionIds.value = [];
  remainingSeconds.value = getExamDurationSeconds(questionCount.value);
  phase.value = "question";
  startTimer();
};

const restartSetup = () => {
  clearTimer();
  clearCitationStatusTimer();
  citationPanel.value = null;
  phase.value = "setup";
  sessionQuestions.value = [];
  selections.value = {};
  answers.value = {};
  resultReason.value = "completed";
  resultQuestionIds.value = [];
  currentIndex.value = 0;
};

const exitSession = () => {
  const completedQuestions =
    mode.value === "exam"
      ? sessionQuestions.value.filter(
          (question) => (selections.value[question.id]?.length ?? 0) > 0,
        )
      : sessionQuestions.value.filter((question) =>
          Boolean(answers.value[question.id]),
        );

  if (mode.value === "exam") {
    answers.value = gradeQuizSelections(
      completedQuestions,
      selections.value,
    );
  }
  resultReason.value = "exited";
  resultQuestionIds.value = completedQuestions.map(
    (question) => question.id,
  );
  clearTimer();
  clearCitationStatusTimer();
  citationPanel.value = null;
  phase.value = "results";
};

const toggleOption = (optionId: string) => {
  const question = currentQuestion.value;
  if (!question || (mode.value === "assisted" && currentAnswer.value)) return;

  if (question.type === "single") {
    selections.value = {
      ...selections.value,
      [question.id]: [optionId],
    };
    if (mode.value === "assisted") recordCurrentAnswer();
    return;
  }

  const selected = new Set(currentSelection.value);
  if (selected.has(optionId)) selected.delete(optionId);
  else selected.add(optionId);
  selections.value = {
    ...selections.value,
    [question.id]: [...selected],
  };
};

const recordCurrentAnswer = () => {
  const question = currentQuestion.value;
  if (!question) return;
  const selectedOptionIds = [...currentSelection.value];
  answers.value = {
    ...answers.value,
    [question.id]: {
      questionId: question.id,
      selectedOptionIds,
      correct: isQuizAnswerCorrect(question, selectedOptionIds),
    },
  };
};

const checkMultipleAnswer = () => {
  if (currentSelection.value.length > 0) recordCurrentAnswer();
};

const goToPreviousQuestion = () => {
  if (currentIndex.value <= 0) return;
  closeCitationPanel();
  currentIndex.value -= 1;
};

const advanceAssisted = () => {
  closeCitationPanel();
  if (currentIndex.value >= sessionQuestions.value.length - 1) {
    resultReason.value = "completed";
    resultQuestionIds.value = sessionQuestions.value.map(
      (question) => question.id,
    );
    phase.value = "results";
    return;
  }
  currentIndex.value += 1;
};

const advanceExam = () => {
  closeCitationPanel();
  if (currentIndex.value >= sessionQuestions.value.length - 1) {
    finishExam();
    return;
  }
  currentIndex.value += 1;
};

const optionState = (question: QuizQuestion, optionId: string) => {
  const selected = currentSelection.value.includes(optionId);
  const feedbackVisible = mode.value === "assisted" && Boolean(currentAnswer.value);
  return {
    selected,
    correct:
      feedbackVisible && question.correctOptionIds.includes(optionId),
    incorrect:
      feedbackVisible &&
      selected &&
      !question.correctOptionIds.includes(optionId),
  };
};

const optionLabel = (index: number) =>
  String.fromCharCode("A".charCodeAt(0) + index);

const openCitation = (citation: QuizCitation) => {
  clearCitationStatusTimer();
  citationFrameStatus.value = "loading";
  citationFrameMessage.value = "Preparing the highlighted documentation…";
  citationPanel.value = {
    citation,
    url: buildCitationHighlightUrl(citation),
  };
  citationStatusTimer = window.setTimeout(() => {
    if (citationFrameStatus.value === "loading") {
      citationFrameStatus.value = "error";
      citationFrameMessage.value =
        "The embedded reader did not respond. Reload the extension, or open this citation in a browser tab.";
    }
  }, 15_000);
};

const openCitationInTab = () => {
  if (citationPanel.value) {
    void chrome.tabs.create({ url: citationPanel.value.url });
  }
};

const closeCitationPanel = () => {
  clearCitationStatusTimer();
  citationPanel.value = null;
};

const handleCitationFrameMessage = (event: MessageEvent) => {
  if (
    event.source !== citationFrame.value?.contentWindow ||
    event.data?.source !== "magic-netsuite-quiz-citation"
  ) {
    return;
  }
  clearCitationStatusTimer();
  if (event.data.status === "ready") {
    citationFrameStatus.value = "ready";
    citationFrameMessage.value = "";
    return;
  }
  citationFrameStatus.value = "error";
  citationFrameMessage.value =
    String(event.data.detail || "") ||
    "The citation could not be highlighted inside the documentation.";
};

const resizeCitationPanel = (delta: number) => {
  citationPanelWidth.value = Math.min(
    70,
    Math.max(28, citationPanelWidth.value + delta),
  );
};

const startCitationResize = (event: PointerEvent) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const workspace = (event.currentTarget as HTMLElement).parentElement;
  const workspaceWidth = workspace?.clientWidth || window.innerWidth;
  const startX = event.clientX;
  const startWidth = citationPanelWidth.value;
  isResizingCitation.value = true;

  const onMove = (moveEvent: PointerEvent) => {
    const deltaPct = ((startX - moveEvent.clientX) / workspaceWidth) * 100;
    citationPanelWidth.value = Math.min(
      70,
      Math.max(28, startWidth + deltaPct),
    );
  };
  const onUp = () => {
    isResizingCitation.value = false;
    document.body.classList.remove("quiz-citation-resizing");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    stopCitationResize = null;
  };

  document.body.classList.add("quiz-citation-resizing");
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  stopCitationResize = onUp;
};

const selectedAnswerText = (question: QuizQuestion, answer: QuizAnswer) => {
  const selected = new Set(answer.selectedOptionIds);
  return question.options
    .filter((option) => selected.has(option.id))
    .map((option) => option.text)
    .join(", ") || "No answer";
};

const correctAnswerText = (question: QuizQuestion) => {
  const correct = new Set(question.correctOptionIds);
  return question.options
    .filter((option) => correct.has(option.id))
    .map((option) => option.text)
    .join(", ");
};

const handleQuizLibraryChanged = (message: { type?: string }) => {
  if (message.type === "QUIZZES_CHANGED" && !transferBusy.value) {
    void loadQuizzes();
  }
};

onMounted(() => {
  chrome.runtime.onMessage.addListener(handleQuizLibraryChanged);
  window.addEventListener("message", handleCitationFrameMessage);
  void loadQuizzes();
});
onBeforeUnmount(() => {
  clearTimer();
  clearCitationStatusTimer();
  stopCitationResize?.();
  window.removeEventListener("message", handleCitationFrameMessage);
  chrome.runtime.onMessage.removeListener(handleQuizLibraryChanged);
});
</script>

<template>
  <main class="quiz-view">
    <header class="quiz-header">
      <div class="heading">
        <span class="heading-icon"><i class="pi pi-question-circle"></i></span>
        <div>
          <h1>NetSuite Quiz</h1>
          <p>Documentation-grounded practice and timed exam sessions</p>
        </div>
      </div>
      <div v-if="phase === 'question'" class="session-summary">
        <span>
          Question <strong>{{ currentIndex + 1 }}</strong> /
          {{ sessionQuestions.length }}
        </span>
        <span v-if="mode === 'assisted'">
          <strong>{{ answeredCount }}</strong> answered
        </span>
        <span v-else class="timer" :class="{ urgent: remainingSeconds <= 300 }">
          <i class="pi pi-clock"></i>
          {{ formatQuizTime(remainingSeconds) }}
        </span>
        <button type="button" class="quiet-button" @click="exitSession">
          Exit session
        </button>
      </div>
    </header>

    <div class="quiz-body" :class="{ 'citation-open': citationPanel }">
      <div class="quiz-primary">
    <div v-if="loading" class="full-state">
      <MLoader />
      <p>Loading quiz library…</p>
    </div>

    <div v-else-if="error && quizzes.length === 0" class="full-state error-state">
      <i class="pi pi-exclamation-circle"></i>
      <strong>Quiz library unavailable</strong>
      <p>{{ error }}</p>
      <button type="button" class="button" @click="loadQuizzes">Try again</button>
    </div>

    <section v-else-if="phase === 'setup'" class="setup-workspace">
      <aside class="quiz-library">
        <div class="pane-heading">
          <div class="pane-heading-copy">
            <span class="eyebrow">Question banks</span>
            <strong>{{ quizzes.length }} available</strong>
          </div>
          <div class="library-actions">
            <input
              ref="quizFileInput"
              type="file"
              accept=".json,application/json"
              tabindex="-1"
              aria-hidden="true"
              @change="handleQuizImport"
            />
            <button
              type="button"
              class="icon-button"
              title="Import quiz banks from JSON"
              :disabled="transferBusy"
              @click="chooseQuizImport"
            >
              <i class="pi pi-upload"></i>
            </button>
            <button
              type="button"
              class="icon-button"
              :title="
                selectedQuizId === ALL_BANKS_ID
                  ? 'Export all quiz banks as JSON'
                  : 'Export selected quiz bank as JSON'
              "
              :disabled="!activeQuiz || transferBusy"
              @click="exportSelectedQuizzes"
            >
              <i class="pi pi-download"></i>
            </button>
            <button
              type="button"
              class="icon-button delete-bank-button"
              title="Delete selected quiz bank"
              aria-label="Delete selected quiz bank"
              :disabled="
                transferBusy ||
                !selectedQuizId ||
                selectedQuizId === ALL_BANKS_ID
              "
              @click="requestDeleteSelectedQuiz"
            >
              <i class="pi pi-trash"></i>
            </button>
            <button
              type="button"
              class="icon-button"
              title="Refresh quiz library"
              :disabled="transferBusy"
              @click="loadQuizzes"
            >
              <i
                class="pi pi-refresh"
                :class="{ 'pi-spin': loadingQuiz || transferBusy }"
              ></i>
            </button>
          </div>
        </div>

        <div
          v-if="transferNotice"
          class="transfer-notice"
          :class="transferNotice.type"
          role="status"
        >
          <i
            class="pi"
            :class="
              transferNotice.type === 'success'
                ? 'pi-check-circle'
                : 'pi-exclamation-triangle'
            "
          ></i>
          <span>{{ transferNotice.message }}</span>
          <button
            type="button"
            title="Dismiss import or export status"
            @click="transferNotice = null"
          >
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div
          v-if="deleteCandidate"
          class="delete-confirm"
          role="alert"
          aria-live="assertive"
        >
          <i class="pi pi-exclamation-triangle"></i>
          <span>
            Delete <strong :title="deleteCandidate.title">{{ deleteCandidate.title }}</strong>?
            This cannot be undone.
          </span>
          <div class="delete-confirm-actions">
            <button
              type="button"
              class="button"
              :disabled="transferBusy"
              @click="deleteCandidate = null"
            >
              Cancel
            </button>
            <button
              type="button"
              class="button danger-button"
              :disabled="transferBusy"
              @click="confirmDeleteQuiz"
            >
              <i
                class="pi"
                :class="transferBusy ? 'pi-spin pi-spinner' : 'pi-trash'"
              ></i>
              Delete
            </button>
          </div>
        </div>

        <div v-if="quizzes.length === 0" class="library-empty">
          <span class="empty-icon"><i class="pi pi-sparkles"></i></span>
          <strong>No AI quizzes yet</strong>
          <p>
            Research official docs with the batch tools, then create a cited
            question bank with <code>magic_netsuite_create_quiz</code>.
          </p>
        </div>

        <template v-else>
          <button
            v-if="quizzes.length > 1"
            type="button"
            class="quiz-row combined-row"
            :class="{ selected: selectedQuizId === ALL_BANKS_ID }"
            @click="selectedQuizId = ALL_BANKS_ID"
          >
            <span class="quiz-row-icon"><i class="pi pi-shuffle"></i></span>
            <span>
              <strong>All banks shuffled</strong>
              <small>
                {{ quizzes.reduce((total, quiz) => total + quiz.questionCount, 0) }}
                questions across {{ quizzes.length }} banks
              </small>
            </span>
          </button>
          <button
            v-for="quiz in quizzes"
            :key="quiz.id"
            type="button"
            class="quiz-row"
            :class="{ selected: selectedQuizId === quiz.id }"
            @click="selectedQuizId = quiz.id"
          >
            <span class="quiz-row-icon"><i class="pi pi-book"></i></span>
            <span>
              <strong :title="quiz.title">{{ quiz.title }}</strong>
              <small>{{ quiz.questionCount }} questions</small>
            </span>
          </button>
        </template>
      </aside>

      <div class="setup-main">
        <div v-if="!activeQuiz" class="full-state compact">
          <span class="empty-icon"><i class="pi pi-file-edit"></i></span>
          <strong>Quiz workspace ready</strong>
          <p>
            Generated quizzes will appear here with assisted and exam launch
            controls. Questions may include SuiteScript, SuiteQL, FreeMarker,
            JSON, XML, or other language-tagged code blocks.
          </p>
          <div class="tool-contracts">
            <code>magic_netsuite_create_quiz</code>
            <code>magic_netsuite_list_quizzes</code>
            <code>magic_netsuite_get_quiz</code>
            <code>magic_netsuite_delete_quiz</code>
          </div>
        </div>

        <template v-else>
          <div class="setup-title">
            <span class="eyebrow">Selected question bank</span>
            <h2>{{ activeQuiz.title }}</h2>
            <p>{{ activeQuiz.description || "No description provided." }}</p>
          </div>

          <div class="setup-grid">
            <section class="configuration-block">
              <h3>Session mode</h3>
              <div class="mode-grid">
                <button
                  type="button"
                  class="mode-card"
                  :class="{ selected: mode === 'assisted' }"
                  @click="mode = 'assisted'"
                >
                  <span class="mode-icon"><i class="pi pi-lightbulb"></i></span>
                  <span>
                    <strong>Assisted practice</strong>
                    <small>
                      Immediate correctness, explanation, correct answer, and
                      relevant documentation evidence when available.
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  class="mode-card"
                  :class="{ selected: mode === 'exam' }"
                  @click="mode = 'exam'"
                >
                  <span class="mode-icon"><i class="pi pi-stopwatch"></i></span>
                  <span>
                    <strong>Exam simulation</strong>
                    <small>
                      No feedback until submission. Timer scales to 90 minutes
                      for 60 questions.
                    </small>
                  </span>
                </button>
              </div>
            </section>

            <section class="configuration-block">
              <h3>Random question count</h3>
              <MSelect
                v-model="questionCount"
                :options="countOptions"
                option-label="label"
                option-value="value"
                :disabled="countOptions.length === 0"
                placeholder="At least 10 questions required"
                class="count-select"
              />
              <p class="configuration-note">
                A fresh random subset is selected each time. Sessions support
                10–60 questions.
              </p>
              <div v-if="mode === 'exam' && questionCount" class="time-preview">
                <i class="pi pi-clock"></i>
                {{ formatQuizTime(getExamDurationSeconds(questionCount)) }}
                available
              </div>
            </section>
          </div>

          <div v-if="activeQuiz.questions.length < 10" class="inline-warning">
            <i class="pi pi-info-circle"></i>
            This bank needs at least 10 validated questions before it can start.
          </div>

          <footer class="setup-actions">
            <span>
              {{ activeQuiz.questions.length }} sourced questions ·
              {{ mode === "assisted" ? "feedback after each answer" : "timed final review" }}
            </span>
            <button
              type="button"
              class="button primary-button"
              :disabled="!canStart"
              @click="startQuiz"
            >
              <i class="pi pi-play"></i>
              Start {{ mode === "assisted" ? "practice" : "exam" }}
            </button>
          </footer>
        </template>
      </div>
    </section>

    <section v-else-if="phase === 'question' && currentQuestion" class="question-workspace">
      <div class="progress-track" aria-hidden="true">
        <span :style="{ width: `${progressPercent}%` }"></span>
      </div>

      <article class="question-panel">
        <div class="question-meta">
          <span>{{ currentQuestion.topic || "NetSuite documentation" }}</span>
          <span>
            {{ currentQuestion.type === "multiple" ? "Select all that apply" : "Select one answer" }}
          </span>
        </div>
        <h2>{{ currentQuestion.prompt }}</h2>

        <figure v-if="currentQuestion.code" class="question-code">
          <figcaption>
            <span>{{ currentQuestion.code.caption || "Code sample" }}</span>
            <code>{{ currentQuestion.code.language }}</code>
          </figcaption>
          <pre><code>{{ currentQuestion.code.content }}</code></pre>
        </figure>

        <div
          class="option-list"
          :class="{ locked: mode === 'assisted' && currentAnswer }"
        >
          <button
            v-for="(option, index) in currentQuestion.options"
            :key="option.id"
            type="button"
            class="answer-option"
            :class="optionState(currentQuestion, option.id)"
            :aria-pressed="currentSelection.includes(option.id)"
            @click="toggleOption(option.id)"
          >
            <span class="option-marker">
              <i
                v-if="currentQuestion.type === 'multiple' && currentSelection.includes(option.id)"
                class="pi pi-check"
              ></i>
              <template v-else>{{ optionLabel(index) }}</template>
            </span>
            <span>{{ option.text }}</span>
            <i
              v-if="optionState(currentQuestion, option.id).correct"
              class="pi pi-check-circle option-result"
            ></i>
            <i
              v-else-if="optionState(currentQuestion, option.id).incorrect"
              class="pi pi-times-circle option-result"
            ></i>
          </button>
        </div>

        <section
          v-if="mode === 'assisted' && currentAnswer"
          class="answer-feedback"
          :class="{ correct: currentAnswer.correct, incorrect: !currentAnswer.correct }"
          aria-live="polite"
        >
          <div class="feedback-title">
            <i :class="currentAnswer.correct ? 'pi pi-check-circle' : 'pi pi-times-circle'"></i>
            <strong>{{ currentAnswer.correct ? "Correct" : "Not quite" }}</strong>
          </div>
          <p><b>Correct answer:</b> {{ correctOptionText }}</p>
          <p>{{ currentQuestion.explanation }}</p>
          <div v-if="currentQuestion.citations?.length" class="citations">
            <span class="eyebrow">Documentation evidence</span>
            <button
              v-for="(citation, index) in currentQuestion.citations"
              :key="`${citation.url}:${index}`"
              type="button"
              class="citation"
              :title="citation.quote"
              @click="openCitation(citation)"
            >
              <span><i class="pi pi-book"></i>{{ citation.title }}</span>
              <small>“{{ citation.quote }}”</small>
            </button>
          </div>
        </section>

        <footer class="question-actions">
          <span>
            {{
              mode === "assisted"
                ? "Reviewed answers stay locked when you revisit them."
                : "You can revisit and change answers until the exam is submitted."
            }}
          </span>
          <div class="question-navigation">
            <button
              type="button"
              class="button"
              :disabled="currentIndex === 0"
              @click="goToPreviousQuestion"
            >
              <i class="pi pi-arrow-left"></i>
              Previous
            </button>
            <button
              v-if="
                mode === 'assisted' &&
                currentQuestion.type === 'multiple' &&
                !currentAnswer
              "
              type="button"
              class="button primary-button"
              :disabled="currentSelection.length === 0"
              @click="checkMultipleAnswer"
            >
              Check answer
            </button>
            <button
              v-else-if="mode === 'assisted' && currentAnswer"
              type="button"
              class="button primary-button"
              @click="advanceAssisted"
            >
              {{ currentIndex === sessionQuestions.length - 1 ? "View results" : "Next question" }}
              <i class="pi pi-arrow-right"></i>
            </button>
            <button
              v-else-if="mode === 'exam'"
              type="button"
              class="button primary-button"
              @click="advanceExam"
            >
              {{ currentIndex === sessionQuestions.length - 1 ? "Submit exam" : "Next question" }}
              <i class="pi pi-arrow-right"></i>
            </button>
          </div>
        </footer>
      </article>
    </section>

    <section v-else class="results-workspace">
      <header class="results-summary">
        <span class="results-icon"><i class="pi pi-chart-bar"></i></span>
        <div>
          <span class="eyebrow">{{ resultEyebrow }}</span>
          <h2>{{ resultScoreText }}</h2>
          <p>{{ resultDetail }}</p>
        </div>
        <button type="button" class="button primary-button" @click="restartSetup">
          <i class="pi pi-replay"></i>
          New session
        </button>
      </header>

      <div class="review-list">
        <div v-if="resultQuestions.length === 0" class="full-state compact">
          <span class="empty-icon"><i class="pi pi-info-circle"></i></span>
          <strong>No questions were answered</strong>
          <p>Start a new session whenever you are ready.</p>
        </div>
        <article
          v-for="(question, index) in resultQuestions"
          :key="question.id"
          class="review-item"
          :class="{ correct: answers[question.id]?.correct }"
        >
          <span class="review-index">{{ index + 1 }}</span>
          <div>
            <strong>{{ question.prompt }}</strong>
            <p>
              <b>Your answer:</b>
              {{ selectedAnswerText(question, answers[question.id] || {
                questionId: question.id,
                selectedOptionIds: [],
                correct: false
              }) }}
            </p>
            <p><b>Correct answer:</b> {{ correctAnswerText(question) }}</p>
            <p>{{ question.explanation }}</p>
            <button
              v-for="(citation, citationIndex) in question.citations"
              :key="`${citation.url}:${citationIndex}`"
              type="button"
              class="review-citation"
              @click="openCitation(citation)"
            >
              <i class="pi pi-book"></i>
              {{ citation.title }}
            </button>
          </div>
          <i
            class="pi review-result"
            :class="answers[question.id]?.correct ? 'pi-check-circle' : 'pi-times-circle'"
          ></i>
        </article>
      </div>
    </section>
      </div>

      <template v-if="citationPanel">
        <div
          class="citation-resize-handle"
          :class="{ active: isResizingCitation }"
          role="separator"
          tabindex="0"
          aria-label="Resize quiz and documentation panels"
          aria-orientation="vertical"
          :aria-valuenow="Math.round(citationPanelWidth)"
          aria-valuemin="28"
          aria-valuemax="70"
          @pointerdown="startCitationResize"
          @keydown.left.prevent="resizeCitationPanel(2)"
          @keydown.right.prevent="resizeCitationPanel(-2)"
        >
          <span></span>
        </div>
        <aside
          class="citation-panel"
          :style="{ flexBasis: `${citationPanelWidth}%` }"
          aria-label="NetSuite documentation citation"
        >
          <header class="citation-panel-header">
            <span class="citation-panel-icon"><i class="pi pi-book"></i></span>
            <div>
              <span class="eyebrow">NetSuite documentation</span>
              <strong :title="citationPanel.citation.title">
                {{ citationPanel.citation.title }}
              </strong>
            </div>
            <button
              type="button"
              class="icon-button"
              title="Open documentation in a browser tab"
              @click="openCitationInTab"
            >
              <i class="pi pi-external-link"></i>
            </button>
            <button
              type="button"
              class="icon-button"
              title="Close documentation panel"
              @click="closeCitationPanel"
            >
              <i class="pi pi-times"></i>
            </button>
          </header>
          <div class="citation-evidence">
            <i class="pi pi-highlighter"></i>
            <span>{{ citationPanel.citation.quote }}</span>
          </div>
          <div
            v-if="citationFrameStatus !== 'ready'"
            class="citation-reader-status"
            :class="{ error: citationFrameStatus === 'error' }"
            role="status"
          >
            <i
              class="pi"
              :class="
                citationFrameStatus === 'error'
                  ? 'pi-exclamation-triangle'
                  : 'pi-spin pi-spinner'
              "
            ></i>
            <span>{{ citationFrameMessage }}</span>
          </div>
          <iframe
            ref="citationFrame"
            :key="citationPanel.url"
            :src="citationPanel.url"
            :title="citationPanel.citation.title"
          ></iframe>
        </aside>
      </template>
    </div>
  </main>
</template>

<style scoped>
.quiz-view {
  --quiz-accent: #4f46e5;
  --quiz-button-accent: #8c9bff;
  --quiz-button-accent-hover: #7b8cf7;
  --quiz-border: #a5b4fc;
  --quiz-surface: #f1f4fe;
  --quiz-icon-surface: #e0e7ff;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  color: var(--p-slate-800, #1e293b);
  background: var(--p-slate-50, #f8fafc);
}

.quiz-body {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.quiz-primary {
  display: flex;
  flex: 1 1 0;
  min-width: 24rem;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.quiz-header {
  display: flex;
  min-height: 3.6rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
  background: #fff;
}
.heading,
.session-summary,
.pane-heading,
.setup-actions,
.question-actions,
.results-summary,
.feedback-title {
  display: flex;
  align-items: center;
}
.heading {
  min-width: 0;
  gap: 0.65rem;
}
.heading-icon,
.empty-icon,
.results-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--quiz-accent);
  background: var(--quiz-icon-surface);
}
.heading-icon {
  width: 2rem;
  height: 2rem;
  border-radius: 0.375rem;
}
h1,
h2,
h3,
p,
figure {
  margin: 0;
}
h1 {
  font-size: 1rem;
}
.heading p,
.setup-title p {
  margin-top: 0.1rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.75rem;
}
.session-summary {
  gap: 0.75rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.74rem;
  white-space: nowrap;
}
.session-summary strong {
  color: var(--p-slate-800, #1e293b);
}
.timer {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--quiz-accent);
}
.timer.urgent {
  color: #b91c1c;
}

.button,
.quiet-button,
.icon-button {
  display: inline-flex;
  height: 1.95rem;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 0.3rem;
  color: var(--p-slate-700, #334155);
  background: #fff;
  font: inherit;
  font-size: 0.75rem;
  white-space: nowrap;
  cursor: pointer;
}
.button,
.quiet-button {
  padding: 0 0.7rem;
}
.quiet-button {
  height: 1.75rem;
  color: var(--p-slate-500, #64748b);
}
.icon-button {
  width: 1.95rem;
  padding: 0;
}
.button:hover:not(:disabled),
.quiet-button:hover:not(:disabled),
.icon-button:hover:not(:disabled) {
  border-color: var(--quiz-border);
  color: var(--quiz-accent);
  background: var(--quiz-surface);
}
.button:focus-visible,
.quiet-button:focus-visible,
.icon-button:focus-visible,
.quiz-row:focus-visible,
.mode-card:focus-visible,
.answer-option:focus-visible,
.citation:focus-visible {
  outline: 2px solid var(--quiz-border);
  outline-offset: 1px;
}
.button:disabled,
.icon-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-button {
  border-color: var(--quiz-button-accent);
  color: #fff;
  background: var(--quiz-button-accent);
}
.primary-button:hover:not(:disabled) {
  color: #fff;
  background: var(--quiz-button-accent-hover);
}

.full-state {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 2rem;
  color: var(--p-slate-500, #64748b);
  text-align: center;
}
.full-state.compact {
  max-width: 36rem;
  align-self: center;
}
.full-state p {
  max-width: 34rem;
  font-size: 0.78rem;
  line-height: 1.55;
}
.error-state > i {
  color: #b91c1c;
  font-size: 1.5rem;
}

.setup-workspace {
  display: grid;
  grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.quiz-library {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  border-right: 1px solid var(--p-slate-200, #e2e8f0);
  background: #fff;
}
.pane-heading {
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
}
.pane-heading-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.12rem;
}
.library-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
}
.library-actions > input[type="file"] {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.transfer-notice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.4rem;
  margin: 0.4rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--quiz-border);
  border-radius: 0.3rem;
  color: var(--p-slate-700, #334155);
  background: var(--quiz-surface);
  font-size: 0.67rem;
  line-height: 1.4;
}
.transfer-notice.error {
  border-color: #fca5a5;
  color: #991b1b;
  background: #fef2f2;
}
.transfer-notice > i {
  margin-top: 0.1rem;
}
.transfer-notice > button {
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.delete-bank-button:hover:not(:disabled) {
  border-color: #fca5a5;
  color: #b91c1c;
  background: #fef2f2;
}
.delete-confirm {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.45rem;
  margin: 0.4rem;
  padding: 0.5rem;
  border: 1px solid #fca5a5;
  border-radius: 0.3rem;
  color: #7f1d1d;
  background: #fef2f2;
  font-size: 0.68rem;
  line-height: 1.4;
}
.delete-confirm > i {
  margin-top: 0.12rem;
}
.delete-confirm > span {
  min-width: 0;
}
.delete-confirm > span strong {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  vertical-align: bottom;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.delete-confirm-actions {
  display: flex;
  grid-column: 2;
  justify-content: flex-end;
  gap: 0.3rem;
}
.danger-button {
  border-color: #dc2626;
  color: #fff;
  background: #dc2626;
}
.danger-button:hover:not(:disabled) {
  border-color: #b91c1c;
  color: #fff;
  background: #b91c1c;
}
.pane-heading strong {
  font-size: 0.8rem;
}
.eyebrow {
  color: var(--p-slate-500, #64748b);
  font-size: 0.64rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.library-empty {
  display: flex;
  flex: 1;
  min-height: 12rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 1.25rem;
  color: var(--p-slate-500, #64748b);
  text-align: center;
}
.empty-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.375rem;
}
.library-empty strong {
  color: var(--p-slate-700, #334155);
  font-size: 0.84rem;
}
.library-empty p {
  max-width: 17rem;
  font-size: 0.72rem;
  line-height: 1.5;
}
.library-empty code,
.tool-contracts code {
  font-family: var(--font-mono);
}
.quiz-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.55rem;
  margin: 0.3rem 0.4rem 0;
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.quiz-row:hover {
  border-color: var(--p-slate-200, #e2e8f0);
  background: var(--p-slate-50, #f8fafc);
}
.quiz-row.selected {
  border-color: var(--quiz-border);
  color: var(--quiz-accent);
  background: var(--quiz-surface);
}
.quiz-row-icon {
  display: grid;
  width: 1.8rem;
  height: 1.8rem;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 0.3rem;
  color: var(--p-slate-500, #64748b);
  background: var(--p-slate-100, #f1f5f9);
}
.quiz-row.selected .quiz-row-icon {
  color: var(--quiz-accent);
  background: var(--quiz-icon-surface);
}
.combined-row {
  margin-bottom: 0.25rem;
  border-bottom-color: var(--p-slate-200, #e2e8f0);
}
.quiz-row > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}
.quiz-row strong,
.quiz-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quiz-row strong {
  color: var(--p-slate-800, #1e293b);
  font-size: 0.78rem;
}
.quiz-row small {
  color: var(--p-slate-500, #64748b);
  font-size: 0.65rem;
}

.setup-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  padding: 1rem;
}
.tool-contracts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem;
}
.tool-contracts code {
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.25rem;
  color: var(--quiz-accent);
  background: #fff;
  font-size: 0.68rem;
}
.setup-title {
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
}
.setup-title h2 {
  margin-top: 0.2rem;
  font-size: 1.15rem;
}
.setup-title p {
  max-width: 48rem;
  line-height: 1.5;
}
.setup-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(15rem, 0.8fr);
  gap: 1rem;
  padding: 1rem 0;
}
.configuration-block h3 {
  margin-bottom: 0.55rem;
  font-size: 0.8rem;
}
.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}
.mode-card {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.7rem;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.375rem;
  color: inherit;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.mode-card:hover {
  border-color: var(--quiz-border);
}
.mode-card.selected {
  border-color: var(--quiz-border);
  color: var(--quiz-accent);
  background: var(--quiz-surface);
}
.mode-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 0.35rem;
  color: var(--p-slate-600, #475569);
  background: var(--p-slate-100, #f1f5f9);
}
.mode-card.selected .mode-icon {
  color: var(--quiz-accent);
  background: var(--quiz-icon-surface);
}
.mode-card > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.25rem;
}
.mode-card strong {
  color: var(--p-slate-800, #1e293b);
  font-size: 0.8rem;
}
.mode-card small {
  color: var(--p-slate-500, #64748b);
  font-size: 0.68rem;
  line-height: 1.45;
}
.count-select {
  max-width: 18rem;
}
.configuration-note,
.time-preview {
  margin-top: 0.45rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.7rem;
  line-height: 1.45;
}
.time-preview {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--quiz-accent);
  font-family: var(--font-mono);
  font-weight: 600;
}
.inline-warning {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid #fde68a;
  border-radius: 0.3rem;
  color: #92400e;
  background: #fffbeb;
  font-size: 0.72rem;
}
.setup-actions {
  justify-content: space-between;
  gap: 1rem;
  margin-top: auto;
  padding-top: 0.8rem;
  border-top: 1px solid var(--p-slate-200, #e2e8f0);
}
.setup-actions > span,
.question-actions > span {
  color: var(--p-slate-500, #64748b);
  font-size: 0.7rem;
}

.question-workspace,
.results-workspace {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.question-workspace {
  display: flex;
  flex-direction: column;
}
.progress-track {
  height: 0.25rem;
  flex: 0 0 auto;
  background: var(--p-slate-200, #e2e8f0);
}
.progress-track span {
  display: block;
  height: 100%;
  background: var(--quiz-accent);
  transition: width 0.2s ease;
}
.question-panel {
  width: min(100%, 56rem);
  margin: 0 auto;
  padding: 1.25rem;
}
.question-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.67rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.question-panel > h2 {
  margin-top: 0.65rem;
  font-size: 1.05rem;
  line-height: 1.45;
}
.question-code {
  margin-top: 0.8rem;
  overflow: hidden;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 0.35rem;
  background: #0f172a;
}
.question-code figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem 0.65rem;
  border-bottom: 1px solid #334155;
  color: #cbd5e1;
  background: #1e293b;
  font-size: 0.67rem;
}
.question-code figcaption code,
.question-code pre {
  font-family: var(--font-mono);
}
.question-code figcaption code {
  color: #a5b4fc;
}
.question-code pre {
  max-height: 20rem;
  overflow: auto;
  margin: 0;
  padding: 0.8rem;
  color: #e2e8f0;
  font-size: 0.75rem;
  line-height: 1.55;
  tab-size: 2;
}
.option-list {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
}
.answer-option {
  display: grid;
  grid-template-columns: 1.9rem minmax(0, 1fr) auto;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.35rem;
  color: inherit;
  background: #fff;
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}
.answer-option:hover {
  border-color: var(--quiz-border);
}
.answer-option.selected {
  border-color: var(--quiz-border);
  color: var(--quiz-accent);
  background: var(--quiz-surface);
}
.answer-option.correct {
  border-color: #86efac;
  color: #166534;
  background: #f0fdf4;
}
.answer-option.incorrect {
  border-color: #fca5a5;
  color: #991b1b;
  background: #fef2f2;
}
.option-marker {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 0.3rem;
  color: var(--p-slate-500, #64748b);
  background: var(--p-slate-50, #f8fafc);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}
.selected .option-marker {
  border-color: var(--quiz-border);
  color: var(--quiz-accent);
  background: var(--quiz-icon-surface);
}
.correct .option-marker {
  border-color: #86efac;
  color: #166534;
  background: #dcfce7;
}
.incorrect .option-marker {
  border-color: #fca5a5;
  color: #991b1b;
  background: #fee2e2;
}
.option-result {
  font-size: 1rem;
}
.option-list.locked .answer-option {
  cursor: default;
}

.answer-feedback {
  margin-top: 0.8rem;
  padding: 0.75rem;
  border: 1px solid;
  border-radius: 0.35rem;
}
.answer-feedback.correct {
  border-color: #86efac;
  color: #166534;
  background: #f0fdf4;
}
.answer-feedback.incorrect {
  border-color: #fca5a5;
  color: #991b1b;
  background: #fef2f2;
}
.feedback-title {
  gap: 0.4rem;
}
.answer-feedback > p {
  margin-top: 0.45rem;
  font-size: 0.75rem;
  line-height: 1.5;
}
.citations {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.7rem;
}
.citation {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 0.3rem;
  color: inherit;
  background: color-mix(in srgb, #fff 75%, transparent);
  text-align: left;
  cursor: pointer;
}
.citation span {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
}
.citation small {
  overflow: hidden;
  max-width: 100%;
  color: var(--p-slate-600, #475569);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.question-actions {
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.9rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--p-slate-200, #e2e8f0);
}
.question-navigation {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.4rem;
}

.results-workspace {
  padding: 1rem;
}
.results-summary {
  gap: 0.75rem;
  max-width: 58rem;
  margin: 0 auto;
  padding: 0.8rem;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.375rem;
  background: #fff;
}
.results-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.375rem;
}
.results-summary > div {
  min-width: 0;
  flex: 1;
}
.results-summary h2 {
  margin-top: 0.1rem;
  font-size: 1rem;
}
.results-summary p {
  color: var(--p-slate-500, #64748b);
  font-size: 0.72rem;
}
.review-list {
  display: grid;
  max-width: 58rem;
  gap: 0.5rem;
  margin: 0.65rem auto 0;
}
.review-item {
  display: grid;
  grid-template-columns: 1.8rem minmax(0, 1fr) auto;
  gap: 0.65rem;
  padding: 0.7rem;
  border: 1px solid #fca5a5;
  border-radius: 0.35rem;
  background: #fff;
}
.review-item.correct {
  border-color: #86efac;
}
.review-index {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border-radius: 0.3rem;
  color: var(--quiz-accent);
  background: var(--quiz-icon-surface);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}
.review-item strong {
  font-size: 0.78rem;
}
.review-item p {
  margin-top: 0.3rem;
  color: var(--p-slate-600, #475569);
  font-size: 0.7rem;
  line-height: 1.45;
}
.review-result {
  color: #b91c1c;
  font-size: 1rem;
}
.review-item.correct .review-result {
  color: #15803d;
}
.review-citation {
  margin-top: 0.4rem;
  padding: 0;
  border: 0;
  color: var(--quiz-accent);
  background: transparent;
  font: inherit;
  font-size: 0.68rem;
  cursor: pointer;
}

.citation-resize-handle {
  position: relative;
  z-index: 3;
  display: flex;
  flex: 0 0 7px;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  border-inline: 1px solid var(--p-slate-200, #e2e8f0);
  background: var(--p-slate-100, #f1f5f9);
  touch-action: none;
}
.citation-resize-handle span {
  width: 2px;
  height: 2.25rem;
  border-radius: 999px;
  background: var(--p-slate-400, #94a3b8);
}
.citation-resize-handle:hover,
.citation-resize-handle:focus-visible,
.citation-resize-handle.active {
  outline: none;
  border-color: var(--quiz-border);
  background: var(--quiz-icon-surface);
}
.citation-resize-handle:hover span,
.citation-resize-handle:focus-visible span,
.citation-resize-handle.active span {
  background: var(--quiz-accent);
}
.citation-panel {
  display: flex;
  flex: 0 0 auto;
  height: 100%;
  min-width: 20rem;
  min-height: 0;
  align-self: stretch;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}
.citation-panel-header {
  display: flex;
  min-height: 3.35rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
}
.citation-panel-header > div {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.1rem;
}
.citation-panel-header strong {
  overflow: hidden;
  color: var(--p-slate-800, #1e293b);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.citation-panel-icon {
  display: grid;
  width: 1.9rem;
  height: 1.9rem;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 0.3rem;
  color: var(--quiz-accent);
  background: var(--quiz-icon-surface);
}
.citation-evidence {
  display: flex;
  max-height: 5.2rem;
  flex: 0 0 auto;
  align-items: flex-start;
  gap: 0.45rem;
  overflow: auto;
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--quiz-border);
  color: var(--p-slate-600, #475569);
  background: var(--quiz-surface);
  font-size: 0.68rem;
  line-height: 1.45;
}
.citation-evidence i {
  margin-top: 0.1rem;
  flex: 0 0 auto;
  color: var(--quiz-accent);
}
.citation-reader-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.65rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
  color: var(--p-slate-600, #475569);
  background: var(--p-slate-50, #f8fafc);
  font-size: 0.68rem;
  line-height: 1.4;
}
.citation-reader-status.error {
  color: #92400e;
  background: #fffbeb;
}
.citation-panel iframe {
  display: block;
  width: 100%;
  height: 0;
  flex: 1 1 0;
  min-height: 0;
  align-self: stretch;
  border: 0;
  background: #fff;
}
:global(body.quiz-citation-resizing) {
  cursor: col-resize;
  user-select: none;
}
:global(body.quiz-citation-resizing) .citation-panel iframe {
  pointer-events: none;
}

@media (max-width: 820px) {
  .session-summary > span:not(.timer) {
    display: none;
  }
  .setup-workspace {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .quiz-library {
    max-height: 15rem;
    border-right: 0;
    border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
  }
  .setup-main {
    overflow: visible;
  }
  .setup-grid,
  .mode-grid {
    grid-template-columns: 1fr;
  }
  .quiz-body.citation-open .quiz-primary {
    display: none;
  }
  .citation-resize-handle {
    display: none;
  }
  .citation-panel {
    width: 100%;
    min-width: 0;
    flex: 1 1 100% !important;
  }
}
</style>
