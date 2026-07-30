<script setup lang="ts">
import { computed } from "vue";
import type { JobStatus } from "../../utils/jobsDb";

const props = defineProps<{ status: JobStatus }>();

const label = computed(() =>
  props.status
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" "),
);
</script>

<template>
  <span class="job-status-badge" :class="`status-${status}`">
    {{ label }}
  </span>
</template>

<style scoped>
.job-status-badge {
  display: inline-flex;
  min-height: 1.25rem;
  align-items: center;
  padding: 0 0.4rem;
  border-radius: 999px;
  color: var(--p-slate-600, #475569);
  background: var(--p-slate-100, #f1f5f9);
  font-size: 0.64rem;
  font-weight: 600;
  white-space: nowrap;
}

.status-succeeded {
  color: #166534;
  background: #dcfce7;
}

.status-failed {
  color: #991b1b;
  background: #fee2e2;
}

.status-running {
  color: #075985;
  background: #e0f2fe;
}

.status-retry-requested,
.status-cancel-requested {
  color: #3730a3;
  background: var(--ui-violet-icon-surface, #e0e7ff);
}
</style>
