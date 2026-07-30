<script setup lang="ts">
import {
  nextTick,
  onErrorCaptured,
  ref,
  type ComponentPublicInstance
} from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";

type SafeFailure = {
  incidentId: string;
  occurredAt: string;
  routeName: string;
  stage: string;
  errorType: string;
};

const route = useRoute();
const router = useRouter();
const failure = ref<SafeFailure | null>(null);
const resetKey = ref(0);
const copyStatus = ref("");
const heading = ref<HTMLElement | null>(null);

const safeLabel = (value: unknown, fallback: string, maxLength = 80) => {
  const label = String(value ?? "")
    .replace(/[^\w .:/-]/g, "")
    .trim()
    .slice(0, maxLength);
  return label || fallback;
};

const createIncidentId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().slice(0, 8).toUpperCase();
  }

  return Math.random().toString(36).slice(2, 10).toUpperCase();
};

const focusRecoveryHeading = () => {
  void nextTick(() => heading.value?.focus());
};

onErrorCaptured(
  (
    error: unknown,
    _instance: ComponentPublicInstance | null,
    info: string
  ) => {
    failure.value = {
      incidentId: createIncidentId(),
      occurredAt: new Date().toISOString(),
      routeName: safeLabel(route.name, "Unknown view"),
      stage: safeLabel(info, "Vue component lifecycle"),
      errorType: safeLabel(
        error instanceof Error ? error.name : typeof error,
        "UnknownError",
        48
      )
    };
    copyStatus.value = "";
    focusRecoveryHeading();

    // Stop Vue from forwarding the potentially sensitive exception to the
    // global logger. The recovery surface exposes only the safe fields above.
    return false;
  }
);

const reset = () => {
  failure.value = null;
  copyStatus.value = "";
  resetKey.value += 1;
};

const goHome = async () => {
  try {
    await router.replace("/");
    reset();
  } catch {
    window.location.reload();
  }
};

const refreshPage = () => window.location.reload();

const copyDetails = async () => {
  if (!failure.value) return;

  const details = [
    "Magic NetSuite UI failure",
    `Incident: ${failure.value.incidentId}`,
    `Time: ${failure.value.occurredAt}`,
    `View: ${failure.value.routeName}`,
    `Stage: ${failure.value.stage}`,
    `Type: ${failure.value.errorType}`
  ].join("\n");

  try {
    await navigator.clipboard.writeText(details);
    copyStatus.value = "Safe technical details copied.";
  } catch {
    copyStatus.value = "Could not copy. Refresh the page and try again.";
  }
};
</script>

<template>
  <template v-if="!failure" :key="resetKey">
    <slot />
  </template>

  <main v-else class="error-boundary" role="alert" aria-labelledby="app-error-title">
    <section class="error-card">
      <div class="error-icon" aria-hidden="true">
        <i class="pi pi-exclamation-triangle"></i>
      </div>

      <div class="error-copy">
        <p class="eyebrow">Application recovery</p>
        <h1 id="app-error-title" ref="heading" tabindex="-1">
          This view stopped unexpectedly
        </h1>
        <p>
          Your saved settings are untouched. Refresh the page to retry the
          view, or return home.
        </p>
      </div>

      <dl class="technical-details" aria-label="Technical details">
        <div>
          <dt>Incident</dt>
          <dd>{{ failure.incidentId }}</dd>
        </div>
        <div>
          <dt>View</dt>
          <dd :title="failure.routeName">{{ failure.routeName }}</dd>
        </div>
        <div>
          <dt>Error type</dt>
          <dd :title="failure.errorType">{{ failure.errorType }}</dd>
        </div>
        <div>
          <dt>Stage</dt>
          <dd :title="failure.stage">{{ failure.stage }}</dd>
        </div>
      </dl>

      <div class="recovery-actions">
        <Button
          size="small"
          icon="pi pi-refresh"
          label="Try again"
          @click="refreshPage"
        />
        <Button
          size="small"
          severity="secondary"
          outlined
          icon="pi pi-home"
          label="Go home"
          @click="goHome"
        />
        <Button
          size="small"
          severity="secondary"
          text
          icon="pi pi-copy"
          label="Copy details"
          @click="copyDetails"
        />
      </div>

      <p class="copy-status" role="status" aria-live="polite">
        {{ copyStatus }}
      </p>
    </section>
  </main>
</template>

<style scoped>
.error-boundary {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: var(--p-slate-100);
}

.error-card {
  width: min(42rem, 100%);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem 1rem;
  padding: 1rem;
  border: 1px solid #a5b4fc;
  border-radius: 0.375rem;
  background: var(--surface-card, #ffffff);
  box-shadow: 0 12px 28px rgb(15 23 42 / 12%);
}

.error-icon {
  width: 2.25rem;
  height: 2.25rem;
  display: grid;
  place-items: center;
  border-radius: 0.375rem;
  background: #e0e7ff;
  color: #4f46e5;
}

.error-icon i {
  font-size: 1rem;
}

.error-copy {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 0.15rem;
  color: #4f46e5;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: var(--p-slate-800);
  font-size: 1.05rem;
  line-height: 1.35;
}

h1:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: 3px;
}

.error-copy > p:last-child {
  max-width: 36rem;
  margin: 0.35rem 0 0;
  color: var(--p-slate-600);
  font-size: 0.78rem;
}

.technical-details {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: var(--p-slate-50);
}

.technical-details div {
  min-width: 0;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.technical-details div:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.technical-details dt {
  color: var(--p-slate-500);
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
}

.technical-details dd {
  overflow: hidden;
  margin: 0.1rem 0 0;
  color: var(--p-slate-700);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recovery-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.recovery-actions :deep(.p-button) {
  min-height: 2rem;
  border-radius: 0.25rem;
  white-space: nowrap;
}

.copy-status {
  min-height: 1.1rem;
  grid-column: 1 / -1;
  margin: -0.2rem 0 0;
  color: var(--p-slate-500);
  font-size: 0.68rem;
}

@media (max-width: 520px) {
  .technical-details {
    grid-template-columns: minmax(0, 1fr);
  }

  .technical-details div:nth-last-child(2) {
    border-bottom: 1px solid var(--p-slate-200);
  }

  .recovery-actions :deep(.p-button) {
    flex: 1 1 calc(50% - 0.4rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .error-card,
  .recovery-actions :deep(.p-button) {
    scroll-behavior: auto;
    transition: none;
  }
}
</style>
