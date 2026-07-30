export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "retry-requested"
  | "cancel-requested";

export type Job = {
  id: string;
  title: string;
  kind?: string;
  status: JobStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  environment: string;
  account: string;
  result?: unknown;
  error?: string;
  sourcePath?: string;
  message?: string;
  indeterminate?: boolean;
  attempt: number;
};

export type CreateJobInput = Omit<
  Job,
  "id" | "status" | "progress" | "createdAt" | "updatedAt" | "attempt"
> & {
  id?: string;
  status?: JobStatus;
  progress?: number;
  createdAt?: number;
  updatedAt?: number;
  attempt?: number;
};

export type JobFilters = {
  status?: JobStatus | "all";
  environment?: string;
  query?: string;
};

export type JobRequestAction = "retry" | "cancel";

const TERMINAL_STATUSES = new Set<JobStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

const RETRYABLE_STATUSES = new Set<JobStatus>(["failed", "cancelled"]);
const CANCELLABLE_STATUSES = new Set<JobStatus>([
  "queued",
  "running",
  "retry-requested",
]);
export const JOBS_STORAGE_KEY = "magic_netsuite_jobs_v1";
export const JOBS_CHANGED_EVENT = "magic-netsuite-jobs-changed";

export const clampJobProgress = (progress: number) => {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
};

export const isTerminalJobStatus = (status: JobStatus) =>
  TERMINAL_STATUSES.has(status);

export const canRequestJobRetry = (status: JobStatus) =>
  RETRYABLE_STATUSES.has(status);

export const canRequestJobCancel = (status: JobStatus) =>
  CANCELLABLE_STATUSES.has(status);

/**
 * Builds a persisted request patch. This does not claim that upstream work has
 * restarted or stopped; a producer must observe and acknowledge the request.
 */
export const buildJobRequestPatch = (
  status: JobStatus,
  action: JobRequestAction,
  now = Date.now(),
): Partial<Job> | null => {
  if (action === "retry" && canRequestJobRetry(status)) {
    return {
      status: "retry-requested",
      progress: 0,
      updatedAt: now,
      finishedAt: undefined,
    };
  }
  if (action === "cancel" && canRequestJobCancel(status)) {
    return {
      status: "cancel-requested",
      updatedAt: now,
    };
  }
  return null;
};

type JobMessageResponse<T> = {
  ok?: boolean;
  result?: T;
  error?: string;
};

const sendJobMessage = async <T>(
  message: Record<string, unknown>,
): Promise<T> => {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("The extension background worker is unavailable.");
  }
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as JobMessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error || "The jobs store request failed.");
  }
  return response.result as T;
};

let changeBridgeInstalled = false;

const emitChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(JOBS_CHANGED_EVENT));
  }
};

const installJobChangeBridge = () => {
  if (
    changeBridgeInstalled ||
    typeof chrome === "undefined" ||
    typeof window === "undefined"
  ) {
    return;
  }
  changeBridgeInstalled = true;
  chrome.runtime?.onMessage?.addListener((message) => {
    if (message?.type === "JOBS_CHANGED") emitChanged();
  });
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[JOBS_STORAGE_KEY]) emitChanged();
  });
};

installJobChangeBridge();

export const createJob = (input: CreateJobInput): Promise<Job> =>
  sendJobMessage<Job>({ type: "JOBS_CREATE", job: input });

export const updateJob = async (
  id: string,
  patch: Partial<Omit<Job, "id" | "createdAt">>,
) =>
  sendJobMessage<boolean>({
    type: "JOBS_UPDATE",
    id,
    patch: {
      ...patch,
      ...(patch.progress === undefined
        ? {}
        : { progress: clampJobProgress(patch.progress) }),
      updatedAt: patch.updatedAt ?? Date.now(),
    },
  });

export const getJob = (id: string) =>
  sendJobMessage<Job | null>({ type: "JOBS_GET", id });

export const listJobs = async (filters: JobFilters = {}): Promise<Job[]> => {
  const rows = await sendJobMessage<Job[]>({ type: "JOBS_LIST" });
  const query = filters.query?.trim().toLowerCase();
  return rows.filter((job) => {
    if (
      filters.status &&
      filters.status !== "all" &&
      job.status !== filters.status
    ) {
      return false;
    }
    if (filters.environment && job.environment !== filters.environment) {
      return false;
    }
    if (
      query &&
      !`${job.title} ${job.kind ?? ""} ${job.account} ${job.environment} ${job.error ?? ""}`
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }
    return true;
  });
};

export const requestJobAction = async (
  id: string,
  action: JobRequestAction,
) =>
  sendJobMessage<boolean>({
    type: "JOBS_REQUEST_ACTION",
    id,
    action,
  });

export const clearCompletedJobs = () =>
  sendJobMessage<number>({ type: "JOBS_CLEAR_COMPLETED" });
