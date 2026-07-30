<script setup lang="ts">
import GridPattern from "../universal/patterns/GridPattern.vue";
import MLoader from "../universal/patterns/MLoader.vue";

withDefaults(
  defineProps<{
    title?: string;
    message?: string;
  }>(),
  {
    title: "Execution worker ready",
    message: "Waiting for a Magic NetSuite task",
  },
);
</script>

<template>
  <section class="execution-standby" role="status" aria-live="polite">
    <GridPattern class="execution-standby__pattern">
      <div class="execution-standby__content">
        <MLoader />
        <strong>{{ title }}</strong>
        <p>{{ message }}</p>
      </div>
    </GridPattern>
  </section>
</template>

<style scoped>
.execution-standby {
  width: 100%;
  min-height: 18rem;
  overflow: hidden;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.375rem;
  background: var(--p-slate-50, #f8fafc);
}

.execution-standby__pattern {
  min-height: 18rem;
}

.execution-standby__content {
  display: flex;
  min-height: 18rem;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.45rem;
  color: var(--p-slate-500, #64748b);
  text-align: center;
}

.execution-standby__content :deep(.loader-container) {
  margin-bottom: 0.4rem;
}

.execution-standby__content strong {
  color: var(--p-slate-700, #334155);
  font-size: 0.9rem;
}

.execution-standby__content p {
  margin: 0;
  font-size: 0.75rem;
}
</style>
