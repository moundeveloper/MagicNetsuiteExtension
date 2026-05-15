<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Button, InputText } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import MTableStatic from "../components/universal/table/MTableStatic.vue";
import MTableColumnStatic from "../components/universal/table/MTableColumnStatic.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import { fetchBundleList, type Bundle } from "../utils/bundleTools";
import { getNetsuiteEnvironment } from "../utils/api";

const props = defineProps<{ vhOffset: number }>();

const router = useRouter();

// ── State ──────────────────────────────────────────────────────────────────
const loading = ref(false);
const errorMsg = ref("");
const bundles = ref<Bundle[]>([]);
const domain = ref("");
const searchQuery = ref("");

// ── Type filter — neither active = show both ───────────────────────────────
const showInstalled = ref(false);
const showCreated = ref(false);

// ── Derived stats ──────────────────────────────────────────────────────────
const installedCount = computed(() => bundles.value.filter((b) => b.type === "installed").length);
const createdCount = computed(() => bundles.value.filter((b) => b.type === "created").length);

// ── Filter ─────────────────────────────────────────────────────────────────
const filteredBundles = computed(() => {
  // Apply type filter first
  const neitherActive = !showInstalled.value && !showCreated.value;
  const typeSource = neitherActive
    ? bundles.value
    : bundles.value.filter(
        (b) =>
          (showInstalled.value && b.type === "installed") ||
          (showCreated.value && b.type === "created")
      );

  // Then apply text search
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return typeSource;
  return typeSource.filter(
    (b) =>
      b.name.toLowerCase().includes(q) ||
      b.bundleId.toLowerCase().includes(q) ||
      b.abstract.toLowerCase().includes(q) ||
      b.appId.toLowerCase().includes(q) ||
      b.createdBy.toLowerCase().includes(q)
  );
});

// ── Load ───────────────────────────────────────────────────────────────────
const loadBundles = async () => {
  loading.value = true;
  errorMsg.value = "";
  try {
    domain.value = await getNetsuiteEnvironment();
    if (domain.value === "unknown") {
      errorMsg.value =
        "No active NetSuite tab found. Open a NetSuite page and try again.";
      return;
    }
    bundles.value = await fetchBundleList(domain.value);
  } catch (err: any) {
    errorMsg.value = String(err?.message ?? err);
  } finally {
    loading.value = false;
  }
};

// ── Navigation ─────────────────────────────────────────────────────────────
const navigateToBundle = (bundle: Bundle) => {
  router.push({
    path: `/bundles/${bundle.bundleId}`,
    query: { data: JSON.stringify(bundle) },
  });
};

// ── Context menus ──────────────────────────────────────────────────────────
const bundleIdContextMenu = [
  {
    label: "Copy Bundle ID",
    icon: "pi pi-copy",
    action: (row: Bundle) => navigator.clipboard.writeText(row.bundleId),
  },
  {
    label: "View Details",
    icon: "pi pi-eye",
    action: (row: Bundle) => navigateToBundle(row),
  },
];

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(loadBundles);
</script>

<template>
  <MCard
    flex
    autoHeight
    direction="row"
    gap="0.5"
    padding=""
    outlined
    elevated
    :style="{ height: `${vhOffset}vh` }"
  >
    <template #default>
      <!-- ── Sidebar ── -->
      <ExpandableSidebar expandedWidth="220px" :defaultExpanded="true">
        <template #collapsed>
          <button
            class="sidebar-icon-btn"
            title="Reload bundles"
            :disabled="loading"
            @click="loadBundles"
          >
            <i
              :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'"
              class="text-sm"
            ></i>
          </button>
        </template>

        <template #default>
          <!-- Stats -->
          <div class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>Stats</h4>
              <button
                class="sidebar-icon-btn"
                title="Reload bundles"
                :disabled="loading"
                @click="loadBundles"
              >
                <i
                  :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'"
                  class="text-xs"
                ></i>
              </button>
            </div>
            <div class="flex flex-col gap-1">
              <div class="stat-row">
                <span class="stat-label">Total</span>
                <span class="stat-value">{{ bundles.length }}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Installed</span>
                <span class="stat-value stat-value--installed">{{ installedCount }}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Created</span>
                <span class="stat-value stat-value--created">{{ createdCount }}</span>
              </div>
              <div v-if="searchQuery || showInstalled || showCreated" class="stat-row">
                <span class="stat-label">Showing</span>
                <span class="stat-value">{{ filteredBundles.length }}</span>
              </div>
            </div>
          </div>

          <!-- About -->
          <div class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>About</h4>
            </div>
            <p class="sidebar-about">
              <strong>Installed</strong> — bundles from the SuiteApp marketplace
              or installed from a third party.<br /><br />
              <strong>Created</strong> — bundles built and published in-house.
              Click any row to inspect its components.
            </p>
          </div>
        </template>
      </ExpandableSidebar>

      <!-- ── Main area ── -->
      <div class="bundles-main">
        <!-- Toolbar -->
        <div class="bundles-toolbar">
          <div class="bundles-toolbar__left">
            <i class="pi pi-box text-indigo-500"></i>
            <span class="bundles-title">Bundles</span>
            <span v-if="!loading && bundles.length > 0" class="bundles-count">
              {{ filteredBundles.length }} / {{ bundles.length }}
            </span>
            <!-- Type filter toggles -->
            <div class="type-filters">
              <button
                class="type-filter-btn type-filter-btn--installed"
                :class="{ active: showInstalled }"
                @click="showInstalled = !showInstalled"
                title="Toggle installed bundles"
              >
                Installed
              </button>
              <button
                class="type-filter-btn type-filter-btn--created"
                :class="{ active: showCreated }"
                @click="showCreated = !showCreated"
                title="Toggle created bundles"
              >
                Created
              </button>
            </div>
          </div>
          <div class="bundles-toolbar__right">
            <InputText
              v-model="searchQuery"
              placeholder="Search bundles…"
              size="small"
              class="bundles-search"
            />
            <Button
              icon="pi pi-refresh"
              size="small"
              :loading="loading"
              title="Reload bundles"
              @click="loadBundles"
            />
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="bundles-error">
          <i class="pi pi-exclamation-triangle"></i>
          {{ errorMsg }}
        </div>

        <!-- Table -->
        <MTableStatic
          v-else
          :rows="filteredBundles"
          :loading="loading"
          style="flex: 1; min-height: 0;"
        >
          <MTableColumnStatic label="Name" field="name" width="2fr" :filterable="true">
            <template #default="{ value, row }">
              <div
                class="bundle-name-cell group"
                @click="navigateToBundle(row)"
              >
                <i class="pi pi-eye text-sm text-indigo-400"></i>
                <span class="group-hover:underline">{{ value }}</span>
              </div>
            </template>
          </MTableColumnStatic>
          <MTableColumnStatic label="Type" field="type" width="100px">
            <template #default="{ value }">
              <span :class="['bundle-type-badge', `bundle-type-badge--${value}`]">
                {{ value === "installed" ? "Installed" : "Created" }}
              </span>
            </template>
          </MTableColumnStatic>
          <MTableColumnStatic label="Bundle ID" field="bundleId" width="100px" :filterable="true" :contextMenu="bundleIdContextMenu" />
          <MTableColumnStatic label="Version" field="version" width="90px" />
          <MTableColumnStatic label="App ID" field="appId" width="100px" />
          <MTableColumnStatic label="Abstract" field="abstract" width="3fr" :filterable="true" />
          <MTableColumnStatic label="Created By" field="createdBy" width="1fr" :filterable="true" />
          <MTableColumnStatic label="Created On" field="createdOn" width="110px" />
          <MTableColumnStatic label="Last Update" field="lastUpdate" width="110px" />

          <template #empty>
            <div class="flex flex-col items-center justify-center p-8 gap-3">
              <i class="pi pi-box text-4xl text-[var(--p-slate-300)]"></i>
              <p class="text-[var(--p-slate-500)]">No bundles found.</p>
            </div>
          </template>
        </MTableStatic>
      </div>
    </template>
  </MCard>
</template>

<style scoped>
/* ── Main area ──────────────────────────────────────────────────────────── */
.bundles-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ── Toolbar ────────────────────────────────────────────────────────────── */
.bundles-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-slate-200);
  flex-shrink: 0;
  gap: 8px;
  min-height: 48px;
}

.bundles-toolbar__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bundles-toolbar__right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bundles-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-slate-800);
}

.bundles-count {
  font-size: 0.72rem;
  color: var(--p-slate-500);
  background: var(--p-slate-100);
  padding: 2px 8px;
  border-radius: 99px;
  border: 1px solid var(--p-slate-200);
}

.bundles-search {
  width: 220px;
}

/* ── Type filter toggles ────────────────────────────────────────────────── */
.type-filters {
  display: flex;
  align-items: center;
  gap: 4px;
}

.type-filter-btn {
  font-size: 0.7rem;
  font-weight: 500;
  padding: 2px 9px;
  border-radius: 99px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  background: var(--p-slate-100);
  color: var(--p-slate-500);
}

.type-filter-btn--installed {
  border-color: var(--p-blue-200);
  color: var(--p-blue-600);
  background: var(--p-blue-50);
}

.type-filter-btn--installed.active {
  background: var(--p-blue-500);
  border-color: var(--p-blue-500);
  color: #fff;
}

.type-filter-btn--created {
  border-color: var(--p-emerald-200);
  color: var(--p-emerald-600);
  background: var(--p-emerald-50);
}

.type-filter-btn--created.active {
  background: var(--p-emerald-500);
  border-color: var(--p-emerald-500);
  color: #fff;
}

/* ── Type badge in table ────────────────────────────────────────────────── */
.bundle-type-badge {
  font-size: 0.68rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 99px;
  white-space: nowrap;
}

.bundle-type-badge--installed {
  background: var(--p-blue-50);
  color: var(--p-blue-600);
  border: 1px solid var(--p-blue-200);
}

.bundle-type-badge--created {
  background: var(--p-emerald-50);
  color: var(--p-emerald-600);
  border: 1px solid var(--p-emerald-200);
}

/* ── Error ──────────────────────────────────────────────────────────────── */
.bundles-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--p-red-600);
  font-size: 0.875rem;
}

/* ── Name cell ──────────────────────────────────────────────────────────── */
.bundle-name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

/* ── Sidebar sections ───────────────────────────────────────────────────── */
.sidebar-section {
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0.5rem 0.4rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.sidebar-section-header h4 {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-slate-400);
  margin: 0;
}

.sidebar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--p-slate-500);
  transition: background 0.15s;
}

.sidebar-icon-btn:hover:not(:disabled) {
  background: var(--p-slate-200);
  color: var(--p-slate-700);
}

.sidebar-icon-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── Stat rows ──────────────────────────────────────────────────────────── */
.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--p-slate-500);
}

.stat-value {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-slate-700);
  background: var(--p-slate-100);
  padding: 1px 7px;
  border-radius: 99px;
}

.stat-value--installed {
  background: var(--p-blue-50);
  color: var(--p-blue-600);
}

.stat-value--created {
  background: var(--p-emerald-50);
  color: var(--p-emerald-600);
}

/* ── About ──────────────────────────────────────────────────────────────── */
.sidebar-about {
  font-size: 0.72rem;
  color: var(--p-slate-500);
  line-height: 1.5;
  margin: 0;
}
</style>
