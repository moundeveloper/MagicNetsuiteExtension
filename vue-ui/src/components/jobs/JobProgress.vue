<script setup lang="ts">
import { computed } from "vue";
import { clampJobProgress } from "../../utils/jobsDb";

const props = withDefaults(
  defineProps<{
    progress?: number;
    indeterminate?: boolean;
    label?: string;
  }>(),
  {
    progress: 0,
    indeterminate: false,
    label: "Job progress",
  },
);

const normalizedProgress = computed(() => clampJobProgress(props.progress));
</script>

<template>
  <div
    class="job-progress"
    :class="{ indeterminate }"
    role="progressbar"
    :aria-label="label"
    :aria-valuemin="indeterminate ? undefined : 0"
    :aria-valuemax="indeterminate ? undefined : 100"
    :aria-valuenow="indeterminate ? undefined : normalizedProgress"
  >
    <span
      class="job-progress__fill"
      :style="indeterminate ? undefined : { width: `${normalizedProgress}%` }"
    ></span>
  </div>
</template>

<style scoped>
.job-progress {
  width: 100%;
  height: 0.3rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--p-slate-200, #e2e8f0);
}

.job-progress__fill {
  display: block;
  height: 100%;
  background: var(--ui-violet, #4f46e5);
  transition: width 0.2s ease;
}

.job-progress.indeterminate .job-progress__fill {
  width: 38%;
  animation: job-progress-indeterminate 1.2s ease-in-out infinite;
}

@keyframes job-progress-indeterminate {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(300%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .job-progress.indeterminate .job-progress__fill {
    width: 100%;
    animation: none;
    opacity: 0.6;
  }
}
</style>
