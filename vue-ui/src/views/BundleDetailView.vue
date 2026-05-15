<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MTabs from "../components/universal/tabs/MTabs.vue";
import MTableStatic from "../components/universal/table/MTableStatic.vue";
import MTableColumnStatic from "../components/universal/table/MTableColumnStatic.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import {
  fetchBundleComponents,
  type Bundle,
  type BundleComponent,
} from "../utils/bundleTools";
import { getNetsuiteEnvironment } from "../utils/api";

const props = defineProps<{ vhOffset: number }>();

const route = useRoute();
const router = useRouter();

// ── State ──────────────────────────────────────────────────────────────────
const bundle = ref<Bundle | null>(null);
const components = ref<BundleComponent[]>([]);
const loading = ref(false);
const errorMsg = ref("");
const domain = ref("");
const activeCategory = ref("");

// ── Parse bundle from route query ──────────────────────────────────────────
onMounted(async () => {
  if (route.query.data) {
    try {
      bundle.value = JSON.parse(route.query.data as string);
    } catch {
      errorMsg.value = "Invalid bundle data.";
      return;
    }
  }

  if (!bundle.value) {
    errorMsg.value = "No bundle data found. Navigate here from the Bundles list.";
    return;
  }

  await loadComponents();
});

// ── Load components ─────────────────────────────────────────────────────────
const loadComponents = async () => {
  if (!bundle.value) return;

  loading.value = true;
  errorMsg.value = "";

  try {
    domain.value = await getNetsuiteEnvironment();
    if (domain.value === "unknown") {
      errorMsg.value =
        "No active NetSuite tab found. Open a NetSuite page and try again.";
      return;
    }
    components.value = await fetchBundleComponents(
      domain.value,
      bundle.value.bundleId
    );
  } catch (err: any) {
    errorMsg.value = String(err?.message ?? err);
  } finally {
    loading.value = false;
  }
};

// ── Category / subcategory grouping ────────────────────────────────────────
interface SubCategoryGroup {
  subCategory: string;
  components: BundleComponent[];
}

interface CategoryGroup {
  category: string;
  tabName: string;
  subGroups: SubCategoryGroup[];
  total: number;
}

const categoryGroups = computed((): CategoryGroup[] => {
  const grouped = new Map<string, Map<string, BundleComponent[]>>();

  for (const c of components.value) {
    if (!grouped.has(c.category)) {
      grouped.set(c.category, new Map());
    }
    const subMap = grouped.get(c.category)!;
    if (!subMap.has(c.subCategory)) {
      subMap.set(c.subCategory, []);
    }
    subMap.get(c.subCategory)!.push(c);
  }

  return Array.from(grouped.entries()).map(([category, subMap], idx) => {
    const subGroups: SubCategoryGroup[] = Array.from(subMap.entries()).map(
      ([subCategory, comps]) => ({ subCategory, components: comps })
    );
    const total = subGroups.reduce((acc, g) => acc + g.components.length, 0);
    return { category, tabName: `cat_${idx}`, subGroups, total };
  });
});

const categoryTabs = computed(() =>
  categoryGroups.value.map((g) => ({ name: g.tabName, label: g.category }))
);

// Activate first tab when groups are ready
watch(
  categoryGroups,
  (groups) => {
    if (groups.length > 0 && !activeCategory.value) {
      activeCategory.value = groups[0]!.tabName;
    }
  },
  { immediate: true }
);

// ── Navigation ─────────────────────────────────────────────────────────────
const navigateBack = () => {
  router.push("/bundles");
};
</script>

<template>
  <!-- No bundle / bad URL -->
  <div
    v-if="!bundle && !loading"
    class="flex flex-col items-center justify-center p-12 gap-4 text-[var(--p-slate-500)]"
  >
    <i class="pi pi-box text-4xl text-[var(--p-slate-300)]"></i>
    <p>{{ errorMsg || "Bundle not found." }}</p>
    <Button size="small" @click="navigateBack">
      <i class="pi pi-arrow-left mr-2"></i>
      Back to Bundles
    </Button>
  </div>

  <!-- Main view -->
  <MCard
    v-else
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
      <ExpandableSidebar expandedWidth="240px" :defaultExpanded="true">
        <template #collapsed>
          <button
            class="sidebar-icon-btn"
            title="Back to Bundles"
            @click="navigateBack"
          >
            <i class="pi pi-arrow-left text-sm"></i>
          </button>
        </template>

        <template #default>
          <!-- Back nav -->
          <div class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>Navigation</h4>
            </div>
            <Button size="small" text class="w-full" @click="navigateBack">
              <i class="pi pi-arrow-left mr-2 text-xs"></i>
              Back to Bundles
            </Button>
          </div>

          <!-- Bundle metadata -->
          <div v-if="bundle" class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>Bundle Info</h4>
            </div>
            <div class="flex flex-col gap-1">
              <div class="meta-row">
                <span class="meta-label">Bundle ID</span>
                <span class="meta-value mono">{{ bundle.bundleId }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">Version</span>
                <span class="meta-value">{{ bundle.version }}</span>
              </div>
              <div v-if="bundle.appId" class="meta-row">
                <span class="meta-label">App ID</span>
                <span class="meta-value mono">{{ bundle.appId }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">Created By</span>
                <span class="meta-value">{{ bundle.createdBy }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">Created On</span>
                <span class="meta-value">{{ bundle.createdOn }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">Last Update</span>
                <span class="meta-value">{{ bundle.lastUpdate }}</span>
              </div>
            </div>
            <p v-if="bundle.abstract" class="meta-abstract">
              {{ bundle.abstract }}
            </p>
          </div>

          <!-- Category nav -->
          <div v-if="categoryGroups.length > 0" class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>Categories</h4>
              <span class="total-badge">{{ components.length }}</span>
            </div>
            <div class="flex flex-col gap-1">
              <button
                v-for="group in categoryGroups"
                :key="group.tabName"
                class="category-nav-btn"
                :class="{ 'is-active': activeCategory === group.tabName }"
                @click="activeCategory = group.tabName"
              >
                <span class="flex-1 text-left truncate">{{
                  group.category
                }}</span>
                <span class="category-count">{{ group.total }}</span>
              </button>
            </div>
          </div>
        </template>
      </ExpandableSidebar>

      <!-- ── Main panel ── -->
      <div class="detail-main">
        <!-- Header bar -->
        <div class="detail-header">
          <div class="detail-header-left">
            <i class="pi pi-box text-indigo-500"></i>
            <span class="detail-title">{{ bundle?.name }}</span>
            <span class="detail-badge">Bundle {{ bundle?.bundleId }}</span>
          </div>
          <div class="detail-header-right">
            <Button
              icon="pi pi-refresh"
              size="small"
              :loading="loading"
              title="Reload components"
              @click="loadComponents"
            />
          </div>
        </div>

        <!-- Loading -->
        <div
          v-if="loading"
          class="flex-1 flex items-center justify-center"
        >
          <MLoader text="Loading components…" />
        </div>

        <!-- Error -->
        <div v-else-if="errorMsg" class="detail-error">
          <i class="pi pi-exclamation-triangle"></i>
          {{ errorMsg }}
        </div>

        <!-- Empty -->
        <div
          v-else-if="components.length === 0"
          class="flex-1 flex items-center justify-center text-[var(--p-slate-400)]"
        >
          <div class="text-center">
            <i class="pi pi-inbox text-4xl mb-3"></i>
            <p>No components found for this bundle.</p>
          </div>
        </div>

        <!-- Tabbed component view -->
        <MTabs
          v-else
          :tabs="categoryTabs"
          v-model="activeCategory"
          class="flex-1 min-h-0 p-2"
        >
          <template #tab-content="{ activeTab }">
            <div
              v-for="group in categoryGroups"
              :key="group.tabName"
              v-show="activeTab === group.tabName"
              class="components-scroll"
            >
              <!-- One section per subcategory -->
              <div
                v-for="subGroup in group.subGroups"
                :key="subGroup.subCategory"
                class="subgroup"
              >
                <div v-if="subGroup.subCategory" class="subgroup-header">
                  <i class="pi pi-folder text-xs text-slate-400"></i>
                  <span>{{ subGroup.subCategory }}</span>
                  <span class="subgroup-count">{{
                    subGroup.components.length
                  }}</span>
                </div>
                <MTableStatic
                  :rows="subGroup.components"
                  class="subgroup-table"
                >
                  <MTableColumnStatic label="Name" field="name" width="3fr" />
                  <MTableColumnStatic
                    label="Script / Record ID"
                    field="id"
                    width="2fr"
                  >
                    <template #default="{ value }">
                      <code v-if="value" class="id-code">{{ value }}</code>
                      <span v-else class="text-[var(--p-slate-400)]">—</span>
                    </template>
                  </MTableColumnStatic>
                  <MTableColumnStatic
                    label="Referenced By"
                    field="referencedBy"
                    width="2fr"
                  >
                    <template #default="{ value }">
                      <span v-if="value">{{ value }}</span>
                      <span v-else class="text-[var(--p-slate-400)]">—</span>
                    </template>
                  </MTableColumnStatic>
                  <MTableColumnStatic label="Locked" field="isLocked" width="80px">
                    <template #default="{ value }">
                      <span
                        v-if="value"
                        class="text-amber-600 font-semibold text-xs"
                        >🔒 Yes</span
                      >
                      <span v-else class="text-[var(--p-slate-400)] text-xs"
                        >No</span
                      >
                    </template>
                  </MTableColumnStatic>
                </MTableStatic>
              </div>
            </div>
          </template>
        </MTabs>
      </div>
    </template>
  </MCard>
</template>

<style scoped>
/* ── Main panel ─────────────────────────────────────────────────────────── */
.detail-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ── Header bar ─────────────────────────────────────────────────────────── */
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-slate-200);
  flex-shrink: 0;
  gap: 8px;
  min-height: 48px;
}

.detail-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.detail-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.detail-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-slate-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 340px;
}

.detail-badge {
  font-size: 0.72rem;
  color: var(--p-slate-500);
  background: var(--p-slate-100);
  padding: 2px 8px;
  border-radius: 99px;
  border: 1px solid var(--p-slate-200);
  white-space: nowrap;
}

/* ── Error ──────────────────────────────────────────────────────────────── */
.detail-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--p-red-600);
  font-size: 0.875rem;
}

/* ── Component scroll area ──────────────────────────────────────────────── */
.components-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 8px;
}

/* ── Subcategory group ──────────────────────────────────────────────────── */
.subgroup {
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
}

.subgroup:last-child {
  margin-bottom: 0;
}

.subgroup-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--p-slate-100);
  border-bottom: 1px solid var(--p-slate-200);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.subgroup-count {
  margin-left: auto;
  background: var(--p-slate-200);
  color: var(--p-slate-600);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 99px;
}

.subgroup-table {
  border-radius: 0;
}

/* ── ID code ────────────────────────────────────────────────────────────── */
.id-code {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.72rem;
  background: var(--p-slate-100);
  color: var(--p-indigo-700);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── Sidebar sections ───────────────────────────────────────────────────── */
.sidebar-section {
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0.5rem 0.5rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
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

.sidebar-icon-btn:hover {
  background: var(--p-slate-200);
  color: var(--p-slate-700);
}

/* ── Meta rows ──────────────────────────────────────────────────────────── */
.meta-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 0;
}

.meta-label {
  font-size: 0.7rem;
  color: var(--p-slate-400);
  flex-shrink: 0;
}

.meta-value {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--p-slate-700);
  text-align: right;
  word-break: break-all;
}

.meta-value.mono {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
}

.meta-abstract {
  margin: 0.5rem 0 0;
  font-size: 0.7rem;
  color: var(--p-slate-500);
  line-height: 1.5;
  font-style: italic;
}

/* ── Total badge ────────────────────────────────────────────────────────── */
.total-badge {
  font-size: 0.68rem;
  font-weight: 600;
  background: var(--p-slate-200);
  color: var(--p-slate-600);
  padding: 1px 7px;
  border-radius: 99px;
}

/* ── Category nav buttons ───────────────────────────────────────────────── */
.category-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 0.76rem;
  color: var(--p-slate-600);
  transition: background 0.13s;
  width: 100%;
}

.category-nav-btn:hover {
  background: var(--p-slate-200);
  color: var(--p-slate-800);
}

.category-nav-btn.is-active {
  background: var(--p-indigo-50, #eef2ff);
  color: var(--p-indigo-700, #4338ca);
  font-weight: 600;
}

.category-count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 0.66rem;
  font-weight: 600;
  background: var(--p-slate-200);
  color: var(--p-slate-600);
  padding: 1px 5px;
  border-radius: 99px;
}

.category-nav-btn.is-active .category-count {
  background: var(--p-indigo-100, #e0e7ff);
  color: var(--p-indigo-700, #4338ca);
}
</style>
