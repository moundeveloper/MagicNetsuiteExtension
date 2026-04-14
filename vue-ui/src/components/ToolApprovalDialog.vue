<template>
  <Teleport to="body">
    <div v-if="visible" class="approval-overlay" @click.self="handleReject">
      <div class="approval-dialog" role="dialog" aria-modal="true">
        <div class="approval-header">
          <span class="approval-warning-icon">
            <i class="pi pi-exclamation-triangle" />
          </span>
          <h3 class="approval-title">Approval Required</h3>
        </div>

        <p class="approval-description">
          The AI wants to run a destructive tool. Review the details below and
          choose whether to allow or deny this action.
        </p>

        <div class="approval-tool-info">
          <div class="approval-tool-name">
            <span class="approval-label">Tool</span>
            <code class="approval-value">{{ toolName }}</code>
          </div>

          <div v-if="hasInput" class="approval-tool-input">
            <span class="approval-label">Parameters</span>
            <pre class="approval-input-pre">{{ formattedInput }}</pre>
          </div>
        </div>

        <div class="approval-actions">
          <button class="btn-reject" @click="handleReject">
            <i class="pi pi-times" />
            Reject
          </button>
          <button class="btn-approve" @click="handleApprove">
            <i class="pi pi-check" />
            Approve
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  visible: boolean;
  toolName: string;
  toolInput: unknown;
}>();

const emit = defineEmits<{
  approve: [];
  reject: [];
}>();

const hasInput = computed(() => {
  if (!props.toolInput) return false;
  return Object.keys(props.toolInput as Record<string, unknown>).length > 0;
});

const formattedInput = computed(() =>
  JSON.stringify(props.toolInput, null, 2)
);

const handleApprove = () => {
  emit("approve");
};

const handleReject = () => {
  emit("reject");
};
</script>

<style scoped>
.approval-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 1rem;
}

.approval-dialog {
  background: white;
  border-radius: 0.75rem;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.2),
    0 4px 16px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 440px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
}

.approval-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.approval-warning-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  background: var(--p-orange-100, #ffedd5);
  border-radius: 50%;
  color: var(--p-orange-600, #ea580c);
  font-size: 0.875rem;
  flex-shrink: 0;
}

.approval-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--p-slate-900, #0f172a);
}

.approval-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-slate-500, #64748b);
  line-height: 1.6;
}

.approval-tool-info {
  background: var(--p-slate-50, #f8fafc);
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.approval-tool-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.approval-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-slate-400, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  min-width: 5rem;
}

.approval-value {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.775rem;
  color: var(--p-slate-700, #334155);
  background: var(--p-slate-100, #f1f5f9);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--p-slate-200, #e2e8f0);
}

.approval-tool-input {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.approval-input-pre {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.725rem;
  color: var(--p-slate-600, #475569);
  background: var(--p-slate-100, #f1f5f9);
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.375rem;
  padding: 0.5rem 0.625rem;
  margin: 0;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.btn-reject,
.btn-approve {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.45rem 0.875rem;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-reject {
  background: var(--p-slate-100, #f1f5f9);
  color: var(--p-slate-700, #334155);
  border: 1px solid var(--p-slate-200, #e2e8f0);
}

.btn-reject:hover {
  background: var(--p-red-50, #fef2f2);
  color: var(--p-red-700, #b91c1c);
  border-color: var(--p-red-200, #fecaca);
}

.btn-approve {
  background: var(--p-slate-800, #1e293b);
  color: white;
}

.btn-approve:hover {
  background: var(--p-slate-900, #0f172a);
}
</style>
