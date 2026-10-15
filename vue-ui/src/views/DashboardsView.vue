<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import MSelect from "../components/universal/input/MSelect.vue";
import MInput from "../components/universal/input/MInput.vue";
import DashboardRuntime from "../features/dashboards/DashboardRuntime.vue";
import DashboardEditor from "../features/dashboards/DashboardEditor.vue";
import {
  dashboardCommand,
  observeDashboards,
  type Dashboard,
  type DashboardDefinition,
} from "../features/dashboards/api";
import { dashboardTemplate } from "../features/dashboards/templates";
import {
  openSavedDashboard,
  useDashboardLaunch,
} from "../features/dashboards/launch";
import { useSettings } from "../states/settingsState";
import {
  normalizeDashboardShortcut,
  reservedDashboardShortcuts,
} from "../../../shared/dashboardLaunch";
const { settings } = useSettings();
const wheelDialog = ref(false);
const wheelDraft = ref("");
const wheelError = ref("");
function configureWheel() {
  wheelDraft.value = settings.dashboardWheelShortcut;
  wheelError.value = "";
  wheelDialog.value = true;
}
function saveWheelShortcut() {
  try {
    const shortcut = normalizeDashboardShortcut(wheelDraft.value);
    const reserved = reservedDashboardShortcuts({
      ...settings,
      dashboardWheelShortcut: "",
    });
    if (
      shortcut &&
      (reserved.some((value) => {
        try {
          return normalizeDashboardShortcut(value) === shortcut;
        } catch {
          return false;
        }
      }) ||
        Object.entries(preferences.value).some(
          ([id, pref]) =>
            library.value.some((d) => d.id === id) &&
            pref.shortcut === shortcut,
        ))
    )
      throw new Error(
        "This shortcut is already assigned. Choose another combination.",
      );
    settings.dashboardWheelShortcut = shortcut;
    wheelDialog.value = false;
  } catch (e) {
    wheelError.value = e instanceof Error ? e.message : String(e);
  }
}
const { preferences, update: updateLaunch } = useDashboardLaunch();
const shortcutDialog = ref(false);
const shortcutDraft = ref("");
const shortcutError = ref("");
const shortcutBusy = ref(false);
const shortcutTarget = ref("");
async function togglePin() {
  if (!selected.value) return;
  try {
    await updateLaunch(selected.value.id, {
      pinned: !preferences.value[selected.value.id]?.pinned,
    });
  } catch (e) {
    error.value = String(e);
  }
}
function configureShortcut() {
  if (!selected.value) return;
  shortcutTarget.value = selected.value.id;
  shortcutDraft.value = preferences.value[selected.value.id]?.shortcut || "";
  shortcutError.value = "";
  shortcutDialog.value = true;
}
async function saveShortcut() {
  shortcutBusy.value = true;
  try {
    await updateLaunch(shortcutTarget.value, { shortcut: shortcutDraft.value });
    shortcutDialog.value = false;
  } catch (e) {
    shortcutError.value = e instanceof Error ? e.message : String(e);
  } finally {
    shortcutBusy.value = false;
  }
}
const route = useRoute();
const router = useRouter();
const props = withDefaults(
  defineProps<{ vhOffset?: number; tabActive?: boolean }>(),
  {
    vhOffset: 130,
    tabActive: true,
  },
);
const collapsed = ref(false);
const previewExpanded = ref(false);
const previewVisible = computed(
  () => previewExpanded.value || route.query.preview === "1",
);
const importing = ref<HTMLInputElement>();
const historyOpen = ref(false);
const versions = ref<{ revision: number; savedAt: string; current: boolean }[]>(
  [],
);
const restoreRevision = ref<number>();
const historyBusy = ref(false);
type Summary = Omit<
  Dashboard,
  "layout" | "components" | "actions" | "initialState"
> & { actionCount: number };
const library = ref<Summary[]>([]);
const opened = ref<Dashboard[]>([]);
const selectedId = ref("");
const selected = computed(() =>
  opened.value.find((d) => d.id === selectedId.value),
);
const query = ref("");
const filter = ref("all");
const loading = ref(false);
const error = ref("");
const edit = ref<{
  dashboard?: Dashboard;
  initial: DashboardDefinition;
} | null>(null);
const deleting = ref(false);
const deleteBusy = ref(false);
const creating = ref(false);
const createMode = ref<"client" | "server" | "hybrid">("server");
const copied = ref(false);
const filtered = computed(() =>
  library.value.filter(
    (d) =>
      (filter.value === "all" || d.mode === filter.value) &&
      `${d.title} ${d.description} ${d.tags.join(" ")}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
  ),
);
const modeOptions = [
  { label: "All modes", value: "all" },
  { label: "Client", value: "client" },
  { label: "Server", value: "server" },
  { label: "Hybrid", value: "hybrid" },
];
let refreshSequence = 0;
let stopObserver: (() => void) | undefined;
const refresh = async () => {
  const seq = ++refreshSequence;
  loading.value = true;
  try {
    const list = await dashboardCommand<Summary[]>("list");
    const docs = await Promise.all(
      opened.value
        .filter((d) => list.some((s) => s.id === d.id))
        .map((d) => dashboardCommand<Dashboard>("get", { dashboardId: d.id })),
    );
    if (seq !== refreshSequence) return;
    library.value = list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Preserve tabs opened while the refresh was awaiting other definitions.
    opened.value = opened.value
      .filter((d) => list.some((s) => s.id === d.id))
      .map((d) => docs.find((fresh) => fresh.id === d.id) || d);
    if (
      selectedId.value &&
      !opened.value.some((d) => d.id === selectedId.value)
    )
      selectedId.value = opened.value[0]?.id || "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === refreshSequence) loading.value = false;
  }
};
const openDashboard = async (id: string) => {
  error.value = "";
  try {
    const d = await dashboardCommand<Dashboard>("get", { dashboardId: id });
    opened.value = [d];
    selectedId.value = d.id;
    await router.replace({ query: { ...route.query, dashboard: d.id } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
};
const startCreate = () => {
  creating.value = false;
  edit.value = {
    initial: dashboardTemplate(createMode.value, Date.now().toString(36)),
  };
};
const startEdit = () => {
  if (selected.value)
    edit.value = {
      dashboard: JSON.parse(JSON.stringify(selected.value)),
      initial: JSON.parse(JSON.stringify(selected.value)),
    };
};
const saved = async (d: Dashboard) => {
  edit.value = null;
  await refresh();
  await openDashboard(d.id);
};
const deleteSelected = async () => {
  if (!selected.value) return;
  deleteBusy.value = true;
  error.value = "";
  try {
    await dashboardCommand("delete", {
      dashboardId: selected.value.id,
      expectedRevision: selected.value.revision,
    });
    opened.value = [];
    selectedId.value = "";
    const next = { ...route.query };
    delete next.dashboard;
    await router.replace({ query: next });
    deleting.value = false;
    await refresh();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    deleteBusy.value = false;
  }
};
const exportSelected = async () => {
  if (!selected.value) return;
  try {
    const payload = await dashboardCommand("export", {
      dashboardId: selected.value.id,
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.value.name}.dashboard.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error.value = String(e);
  }
};
const importFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const d = await dashboardCommand<Dashboard>("import", {
      payload,
      verbose: true,
    });
    await saved(d);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    input.value = "";
  }
};
const showHistory = async () => {
  if (!selected.value) return;
  try {
    const result = await dashboardCommand("history", {
      dashboardId: selected.value.id,
    });
    versions.value = result.versions;
    restoreRevision.value = result.versions.find(
      (v: any) => !v.current,
    )?.revision;
    historyOpen.value = true;
  } catch (e) {
    error.value = String(e);
  }
};
const restore = async () => {
  if (!selected.value || !restoreRevision.value) return;
  historyBusy.value = true;
  try {
    await dashboardCommand("history", {
      dashboardId: selected.value.id,
      expectedRevision: selected.value.revision,
      restoreRevision: restoreRevision.value,
    });
    historyOpen.value = false;
    await refresh();
  } catch (e) {
    error.value = String(e);
  } finally {
    historyBusy.value = false;
  }
};
const copyPrompt = async () => {
  try {
    await navigator.clipboard.writeText(
      "Use the Magic NetSuite MCP dashboard tools to build a dynamic dashboard for my repetitive SuiteScript workflow. First call magic_netsuite_dashboard_catalog and magic_netsuite_dashboard_list. Reuse the provided components; create reusable custom component templates or sanitized HTML/SVG visuals where useful. Choose client, server or hybrid based on module limitations. Hybrid actions must have explicit ordered client/server steps and pass JSON results. Bind forms to state and widgets to action results. Add clear action labels, input schemas and accurate read/write risk. Create the dashboard with magic_netsuite_dashboard_create without running its actions. My workflow: ",
    );
    copied.value = true;
  } catch {
    error.value =
      "Clipboard is unavailable. See the MCP dashboard tools in the MCP Server view.";
  }
};
watch(
  () => route.query.dashboard,
  (id) => {
    if (typeof id === "string" && id !== selectedId.value)
      void openDashboard(id);
  },
);
onMounted(async () => {
  stopObserver = observeDashboards(() => {
    void refresh();
  });
  await refresh();
  if (typeof route.query.dashboard === "string")
    await openDashboard(route.query.dashboard);
});
onBeforeUnmount(() => {
  stopObserver?.();
  ++refreshSequence;
});
</script>

<template>
  <section class="dashboards-workbench" style="height: 100%">
    <input
      ref="importing"
      type="file"
      accept=".json,application/json"
      hidden
      @change="importFile"
    />
    <aside v-if="!collapsed" class="dashboard-library">
      <div class="library-heading">
        <span class="library-mark"><i class="pi pi-th-large" /></span>
        <div>
          <h2>Dashboards</h2>
          <p>Manage your dashboards</p>
        </div>
        <button
          title="Refresh dashboards"
          aria-label="Refresh dashboards"
          @click="refresh"
        >
          <i :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" />
        </button>
      </div>
      <Button
        label="New dashboard"
        icon="pi pi-plus"
        size="small"
        class="create-button"
        @click="creating = true"
      />
      <Button
        label="Import dashboard"
        icon="pi pi-upload"
        size="small"
        severity="secondary"
        text
        @click="importing?.click()"
      />
      <Button
        label="Quick selector"
        icon="pi pi-compass"
        size="small"
        severity="secondary"
        text
        aria-label="Configure dashboard wheel"
        :title="settings.dashboardWheelShortcut || 'Configure dashboard wheel'"
        @click="configureWheel"
      />
      <MInput
        v-model="query"
        type="search"
        placeholder="Find a dashboard…"
        outlined
      />
      <MSelect v-model="filter" :options="modeOptions" size="small" />
      <div class="library-count">
        {{ filtered.length }} DASHBOARD{{ filtered.length === 1 ? "" : "S" }}
      </div>
      <nav class="library-list" aria-label="Dashboard library">
        <button
          v-for="d in filtered"
          :key="d.id"
          class="library-item"
          :class="{ active: selectedId === d.id }"
          @click="openDashboard(d.id)"
        >
          <span class="item-icon"
            ><i
              :class="
                d.mode === 'hybrid'
                  ? 'pi pi-directions'
                  : d.mode === 'client'
                    ? 'pi pi-desktop'
                    : 'pi pi-server'
              " /></span
          ><span class="item-detail"
            ><strong>{{ d.title }}</strong
            ><small>{{ d.mode }} · {{ d.actionCount }} actions</small></span
          ><i v-if="selectedId === d.id" class="pi pi-angle-right" />
        </button>
        <p v-if="!filtered.length && library.length" class="muted">
          No dashboards match these filters.
        </p>
      </nav>
      <div class="library-footer">
        <i class="pi pi-sparkles" /><strong>Build with Claude</strong>
        <p>
          Describe the annoying workflow once. Claude can assemble and maintain
          your dashboard through MCP.
        </p>
        <button @click="copyPrompt">
          {{ copied ? "Prompt copied" : "Copy dashboard prompt" }}
          <i class="pi pi-copy" />
        </button>
      </div>
    </aside>
    <main class="dashboard-workspace">
      <div class="workspace-tabs">
        <button
          class="new-tab"
          :aria-label="
            collapsed ? 'Show dashboard library' : 'Hide dashboard library'
          "
          title="Toggle library"
          @click="collapsed = !collapsed"
        >
          <i class="pi pi-bars" />
        </button>
        <div class="manager-label">Dashboard manager</div>
        <button
          class="new-tab"
          aria-label="New dashboard"
          title="New dashboard"
          @click="creating = true"
        >
          <i class="pi pi-plus" />
        </button>
      </div>
      <div v-if="error" class="workbench-error" role="alert">
        {{ error
        }}<button aria-label="Dismiss error" @click="error = ''">
          <i class="pi pi-times" />
        </button>
      </div>
      <template v-if="selected">
        <header class="dashboard-heading">
          <div class="heading-detail" :title="selected.description">
            <h1>{{ selected.title }}</h1>
            <span class="mode-badge">{{ selected.mode }}</span
            ><span v-if="selected.account" class="account-badge">{{
              selected.account
            }}</span>
            <p>{{ selected.description }}</p>
          </div>
          <div class="heading-actions">
            <Button
              label="Open dashboard"
              icon="pi pi-external-link"
              size="small"
              @click="openSavedDashboard(selected)"
            />
            <Button
              :icon="
                preferences[selected.id]?.pinned
                  ? 'pi pi-star-fill'
                  : 'pi pi-star'
              "
              :aria-label="
                preferences[selected.id]?.pinned
                  ? 'Unpin from Home'
                  : 'Pin to Home'
              "
              :title="
                preferences[selected.id]?.pinned
                  ? 'Unpin from Home'
                  : 'Pin to Home'
              "
              size="small"
              text
              severity="secondary"
              @click="togglePin"
            />
            <Button
              icon="pi pi-key"
              aria-label="Set dashboard shortcut"
              :title="
                preferences[selected.id]?.shortcut || 'Set dashboard shortcut'
              "
              size="small"
              text
              severity="secondary"
              @click="configureShortcut"
            />
            <Button
              icon="pi pi-pencil"
              aria-label="Edit dashboard"
              title="Edit dashboard"
              size="small"
              severity="secondary"
              text
              @click="startEdit"
            /><Button
              icon="pi pi-download"
              aria-label="Export dashboard"
              title="Export dashboard"
              size="small"
              severity="secondary"
              text
              @click="exportSelected"
            /><Button
              icon="pi pi-history"
              aria-label="Dashboard history"
              title="Dashboard history"
              size="small"
              severity="secondary"
              text
              @click="showHistory"
            /><button
              title="Delete dashboard"
              aria-label="Delete dashboard"
              @click="deleting = true"
            >
              <i class="pi pi-trash" />
            </button>
          </div>
        </header>
        <div class="dashboard-content">
          <div class="dashboard-summary">
            <p>
              {{
                selected.description ||
                "Open this dashboard to use its live data and actions."
              }}
            </p>
            <p class="muted">
              Pin it to Home for quick access, or assign a keyboard shortcut to
              open it from NetSuite.
            </p>
            <div class="action-summary">
              <span v-for="action in selected.actions" :key="action.id"
                ><i
                  :class="
                    action.risk === 'write' ? 'pi pi-pencil' : 'pi pi-eye'
                  "
                />
                {{ action.title }} · {{ action.mode }}</span
              >
            </div>
            <Button
              :label="previewVisible ? 'Hide preview' : 'Show preview'"
              icon="pi pi-eye"
              text
              size="small"
              @click="previewExpanded = !previewVisible"
            />
          </div>
          <DashboardRuntime
            v-if="previewVisible"
            v-for="d in opened"
            v-show="selectedId === d.id"
            :key="d.id"
            :dashboard="d"
            :active="props.tabActive && selectedId === d.id"
            preview
          />
        </div>
        <footer class="workspace-status">
          <span
            ><i class="pi pi-circle-fill" />{{
              selected.actions.length
            }}
            actions · revision {{ selected.revision
            }}<template v-if="preferences[selected.id]?.shortcut">
              · {{ preferences[selected.id]?.shortcut }}</template
            ></span
          ><span
            >Client: current page · Server: Suitelet · Hybrid: ordered
            steps</span
          >
        </footer>
      </template>
      <div v-else class="hub-empty">
        <div class="empty-orbit"><i class="pi pi-th-large" /></div>
        <span class="dashboard-eyebrow">LESS REPETITION. MORE DOING.</span>
        <h1>A workspace for the work you repeat.</h1>
        <p>
          Create focused dashboards for your NetSuite routines.<br />Live data,
          useful controls, and SuiteScript actions in one place.
        </p>
        <div class="empty-actions">
          <Button
            label="Create a dashboard"
            icon="pi pi-plus"
            @click="creating = true"
          /><Button
            :label="copied ? 'Prompt copied' : 'Build with Claude'"
            icon="pi pi-sparkles"
            severity="secondary"
            outlined
            @click="copyPrompt"
          />
        </div>
        <div class="mode-cards">
          <article>
            <i class="pi pi-desktop" />
            <h3>Client</h3>
            <p>Work with the current page and record.</p>
          </article>
          <article>
            <i class="pi pi-server" />
            <h3>Server</h3>
            <p>Use files, tasks, rendering, and server modules.</p>
          </article>
          <article>
            <i class="pi pi-directions" />
            <h3>Hybrid</h3>
            <p>Connect page context to server capabilities.</p>
          </article>
        </div>
      </div>
    </main>
    <Dialog
      v-model:visible="wheelDialog"
      modal
      header="Quick dashboard selector"
      :style="{ width: 'min(440px, 92vw)' }"
    >
      <p class="dialog-copy">
        Hold this shortcut to show the navigator in the center of your screen. Point
        to a dashboard or preferred view and release to open its tab. Scroll for more destinations;
        press Esc or release in the center to cancel.
      </p>
      <MInput
        v-model="wheelDraft"
        aria-label="Dashboard wheel shortcut"
        placeholder="Ctrl+Alt+D"
        outlined
      />
      <p class="dialog-copy">Leave it empty to disable the wheel.</p>
      <p v-if="wheelError" role="alert" class="workbench-error">
        {{ wheelError }}
      </p>
      <template #footer
        ><Button
          label="Cancel"
          text
          severity="secondary"
          @click="wheelDialog = false" /><Button
          label="Save wheel shortcut"
          @click="saveWheelShortcut"
      /></template>
    </Dialog>
    <Dialog
      v-model:visible="shortcutDialog"
      modal
      header="Dashboard shortcut"
      :style="{ width: 'min(430px, 92vw)' }"
    >
      <p class="dialog-copy">
        Open this dashboard in its own workspace tab from any NetSuite page. Use
        a shortcut such as Ctrl+Alt+1. Leave it empty to remove the shortcut.
      </p>
      <MInput
        v-model="shortcutDraft"
        placeholder="Ctrl+Alt+1"
        aria-label="Keyboard shortcut"
        outlined
      />
      <p v-if="shortcutError" role="alert" class="workbench-error">
        {{ shortcutError }}
      </p>
      <template #footer
        ><Button
          label="Cancel"
          text
          severity="secondary"
          @click="shortcutDialog = false" /><Button
          label="Save shortcut"
          :loading="shortcutBusy"
          @click="saveShortcut"
      /></template>
    </Dialog>
    <Dialog
      v-model:visible="creating"
      modal
      header="Start a dashboard"
      :style="{ width: 'min(480px,92vw)' }"
      ><p class="dialog-copy">
        Start with a working example, then tailor the layout and actions
        yourself or through Claude.
      </p>
      <div class="mode-choices">
        <button
          v-for="mode in ['client', 'server', 'hybrid'] as const"
          :key="mode"
          :class="{ active: createMode === mode }"
          @click="createMode = mode"
        >
          <i
            :class="
              mode === 'client'
                ? 'pi pi-desktop'
                : mode === 'server'
                  ? 'pi pi-server'
                  : 'pi pi-directions'
            "
          /><strong>{{ mode }}</strong>
        </button>
      </div>
      <p class="dialog-copy">
        {{
          createMode === "client"
            ? "Starter: current record and account helper."
            : createMode === "server"
              ? "Starter: searchable File Cabinet snapshot."
              : "Starter: browser record context → server field inspector."
        }}
      </p>
      <template #footer
        ><Button
          label="Continue"
          icon="pi pi-arrow-right"
          @click="startCreate" /></template
    ></Dialog>
    <DashboardEditor
      v-if="edit"
      :dashboard="edit.dashboard"
      :initial="edit.initial"
      @close="edit = null"
      @saved="saved"
    />
    <Dialog
      v-model:visible="historyOpen"
      modal
      header="Dashboard history"
      :style="{ width: 'min(480px,92vw)' }"
      ><p class="dialog-copy">
        Restore a saved definition and action code as a new revision. Actions do
        not run.
      </p>
      <MSelect
        v-model="restoreRevision"
        :options="
          versions
            .filter((v) => !v.current)
            .map((v) => ({
              label: `Revision ${v.revision} · ${new Date(v.savedAt).toLocaleString()}`,
              value: v.revision,
            }))
        "
        placeholder="No earlier revisions" /><template #footer
        ><Button
          label="Cancel"
          severity="secondary"
          @click="historyOpen = false" /><Button
          label="Restore revision"
          :loading="historyBusy"
          :disabled="!restoreRevision"
          @click="restore" /></template
    ></Dialog>
    <Dialog
      v-model:visible="deleting"
      modal
      header="Delete dashboard?"
      :style="{ width: 'min(440px,92vw)' }"
      ><p class="dialog-copy">
        Delete {{ selected?.title }} and its saved layout, custom components and
        action code?
      </p>
      <template #footer
        ><Button
          label="Cancel"
          severity="secondary"
          @click="deleting = false" /><Button
          label="Delete dashboard"
          severity="danger"
          :loading="deleteBusy"
          @click="deleteSelected" /></template
    ></Dialog>
  </section>
</template>

<style scoped>
.manager-label {
  flex: 1;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  padding: 0.4rem;
}
.dashboard-summary {
  margin-bottom: 0.8rem;
  font-size: 0.8rem;
}
.action-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}
.action-summary > span {
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.4rem;
  color: var(--p-text-muted-color);
}
.dashboards-workbench {
  display: flex;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  overflow: hidden;
  background: var(--p-content-background);
  color: var(--p-text-color);
}
.dashboard-library {
  width: 250px;
  flex-shrink: 0;
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  border-right: 1px solid var(--p-content-border-color);
  background: color-mix(
    in srgb,
    var(--p-content-background) 93%,
    var(--p-primary-color)
  );
}
.library-heading {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 0.3rem;
}
.library-heading h2 {
  margin: 0;
  font-size: 1rem;
  letter-spacing: -0.03em;
}
.library-heading p {
  margin: 0.25rem 0 0;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}
.library-heading > button {
  margin-left: auto;
}
.library-mark,
.item-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--p-highlight-background);
  color: var(--p-primary-color);
}
.dashboard-library button:not(.p-button),
.heading-actions > button,
.new-tab,
.tab-close,
.workspace-tab > button,
.workbench-error button {
  background: transparent;
  color: inherit;
  border: 0;
  cursor: pointer;
}
.create-button {
  justify-content: center;
}
.library-count {
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  color: var(--p-text-muted-color);
  margin-top: 0.5rem;
}
.library-list {
  overflow: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.library-item {
  display: flex;
  text-align: left;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.5rem;
  border-radius: 8px !important;
}
.library-item:hover,
.library-item.active {
  background: var(--p-highlight-background) !important;
}
.item-icon {
  width: 28px;
  height: 28px;
  background: var(--p-content-hover-background);
  flex-shrink: 0;
}
.item-detail {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  flex: 1;
}
.item-detail strong {
  font-size: 0.76rem;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-detail small {
  font-size: 0.66rem;
  color: var(--p-text-muted-color);
  text-transform: capitalize;
}
.library-footer {
  border-top: 1px solid var(--p-content-border-color);
  padding-top: 1rem;
  font-size: 0.75rem;
}
.library-footer > i {
  color: var(--p-primary-color);
  margin-right: 0.5rem;
}
.library-footer p {
  color: var(--p-text-muted-color);
  line-height: 1.7;
  font-size: 0.7rem;
}
.library-footer button {
  padding: 0;
  color: var(--p-primary-color) !important;
  font-size: 0.7rem;
}
.dashboard-workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.workspace-tabs {
  display: flex;
  min-height: 43px;
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-content-hover-background);
}
.tab-scroll {
  display: flex;
  overflow: auto;
  flex: 1;
}
.workspace-tab {
  display: flex;
  align-items: center;
  border-right: 1px solid var(--p-content-border-color);
  border-top: 2px solid transparent;
  white-space: nowrap;
}
.workspace-tab.active {
  background: var(--p-content-background);
  border-top-color: var(--p-primary-color);
}
.workspace-tab > button:first-child {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.7rem 0.8rem;
  font-size: 0.72rem;
}
.tab-close {
  padding: 0.5rem 0.7rem !important;
  font-size: 0.6rem;
  color: var(--p-text-muted-color) !important;
}
.new-tab {
  padding: 0.8rem;
}
.dashboard-heading {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.35rem 0.8rem;
  min-height: 44px;
  align-items: center;
  border-bottom: 1px solid var(--p-content-border-color);
}
.dashboard-eyebrow {
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  color: var(--p-text-muted-color);
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.mode-badge {
  letter-spacing: 0;
  text-transform: capitalize;
  border: 1px solid var(--p-content-border-color);
  padding: 0.2rem 0.5rem;
  border-radius: 20px;
  color: var(--p-primary-color);
}
.heading-detail {
  display: flex;
  gap: 0.55rem;
  align-items: center;
  min-width: 0;
  flex: 1;
}
.dashboard-heading h1 {
  font-size: 0.85rem;
  letter-spacing: -0.02em;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}
.account-badge {
  font-size: 0.65rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}
.dashboard-heading p {
  font-size: 0.7rem;
  margin: 0;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.heading-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}
.heading-actions > button {
  color: var(--p-text-muted-color);
}
.dashboard-content {
  overflow: auto;
  flex: 1;
  padding: 0.8rem;
}
.workspace-status {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--p-content-border-color);
  padding: 0.65rem 1rem;
  font-size: 0.6rem;
  color: var(--p-text-muted-color);
}
.workspace-status i {
  font-size: 0.4rem;
  color: var(--p-primary-color);
  margin-right: 0.4rem;
}
.hub-empty {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  text-align: center;
  background: radial-gradient(
    ellipse at 50% 25%,
    color-mix(in srgb, var(--p-primary-color) 7%, transparent),
    transparent 65%
  );
}
.empty-orbit {
  display: grid;
  place-items: center;
  width: 70px;
  height: 70px;
  border-radius: 20px;
  background: var(--p-highlight-background);
  color: var(--p-primary-color);
  border: 1px solid var(--p-content-border-color);
  font-size: 1.8rem;
  margin-bottom: 1.5rem;
}
.hub-empty h1 {
  font-size: clamp(1.4rem, 2.5vw, 2rem);
  font-weight: 550;
  letter-spacing: -0.04em;
  max-width: 450px;
  line-height: 1.25;
  margin: 1rem 0;
}
.hub-empty > p {
  font-size: 0.8rem;
  line-height: 1.8;
  color: var(--p-text-muted-color);
}
.empty-actions {
  display: flex;
  gap: 0.7rem;
  margin: 1rem 0 2.5rem;
  flex-wrap: wrap;
  justify-content: center;
}
.mode-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  max-width: 640px;
  width: 100%;
}
.mode-cards article {
  text-align: left;
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  padding: 1rem;
  background: var(--p-content-background);
}
.mode-cards i {
  color: var(--p-primary-color);
}
.mode-cards h3 {
  font-size: 0.8rem;
  margin: 0.65rem 0;
}
.mode-cards p {
  font-size: 0.72rem;
  line-height: 1.6;
  margin: 0;
  color: var(--p-text-muted-color);
}
.workbench-error {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  background: color-mix(in srgb, var(--p-red-400) 10%, transparent);
  color: var(--p-red-400);
  padding: 0.8rem;
  font-size: 0.8rem;
  white-space: pre-wrap;
}
.mode-choices {
  display: flex;
  gap: 0.7rem;
}
.mode-choices button {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  padding: 1.2rem;
  cursor: pointer;
  text-transform: capitalize;
}
.mode-choices button.active {
  border-color: var(--p-primary-color);
  background: var(--p-highlight-background);
}
.dialog-copy,
.muted {
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  line-height: 1.7;
}
@media (max-width: 800px) {
  .dashboard-library {
    width: 205px;
    padding: 0.8rem;
  }
  .dashboard-heading {
    padding: 0.35rem 0.6rem;
  }
  .dashboard-heading p {
    display: none;
  }
  .dashboard-content {
    padding: 1rem;
  }
  .workspace-status span:last-child {
    display: none;
  }
  .mode-cards {
    grid-template-columns: 1fr;
    max-width: 350px;
  }
  .hub-empty {
    justify-content: flex-start;
    padding: 2rem 1rem;
  }
}
@media (max-width: 500px) {
  .dashboard-library {
    width: 155px;
    padding: 0.6rem;
  }
  .library-heading p,
  .library-mark {
    display: none;
  }
  .library-footer {
    font-size: 0.65rem;
  }
  .library-footer p {
    font-size: 0.65rem;
  }
  .item-icon {
    display: none;
  }
  .heading-actions {
    flex-wrap: wrap;
    flex-shrink: 1;
    justify-content: flex-end;
  }
  .empty-actions {
    flex-direction: column;
  }
  .dashboard-eyebrow {
    font-size: 0.5rem;
  }
  .hub-empty {
    padding: 1.5rem 0.8rem;
  }
}
</style>
