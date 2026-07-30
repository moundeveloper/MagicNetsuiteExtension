import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  JOBS_CHANGED_EVENT,
  listJobs,
  type Job,
  type JobStatus,
} from "../utils/jobsDb";

const ACTIVE_STATUSES = new Set<JobStatus>([
  "queued",
  "running",
  "retry-requested",
  "cancel-requested",
]);

export const useJobs = () => {
  const jobs = ref<Job[]>([]);
  const loading = ref(true);
  const error = ref("");
  let loadSequence = 0;

  const refresh = async () => {
    const sequence = ++loadSequence;
    loading.value = true;
    error.value = "";
    try {
      const nextJobs = await listJobs();
      if (sequence === loadSequence) jobs.value = nextJobs;
    } catch (cause) {
      if (sequence === loadSequence) {
        error.value =
          cause instanceof Error ? cause.message : "Jobs could not be loaded.";
      }
    } finally {
      if (sequence === loadSequence) loading.value = false;
    }
  };

  const handleChanged = () => void refresh();

  const activeJobs = computed(() =>
    jobs.value
      .filter((job) => ACTIVE_STATUSES.has(job.status))
      .sort(
        (a, b) =>
          (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt),
      ),
  );

  const completedJobs = computed(() =>
    jobs.value.filter((job) => !ACTIVE_STATUSES.has(job.status)),
  );

  onMounted(() => {
    window.addEventListener(JOBS_CHANGED_EVENT, handleChanged);
    void refresh();
  });

  onBeforeUnmount(() => {
    window.removeEventListener(JOBS_CHANGED_EVENT, handleChanged);
  });

  return {
    jobs,
    loading,
    error,
    activeJobs,
    completedJobs,
    refresh,
  };
};
