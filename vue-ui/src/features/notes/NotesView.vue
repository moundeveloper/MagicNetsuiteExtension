<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkspace } from './stores/workspace'
import Sidebar from './components/Sidebar.vue'
import SearchModal from './components/SearchModal.vue'
import PageView from './components/PageView.vue'
import EmptyState from './components/EmptyState.vue'
import './assets/main.css'

const ws = useWorkspace()
const router = useRouter()
const route = useRoute()
const appRoot = ref<HTMLElement | null>(null)

const sidebarOpen = ref(true)
const sidebarWidth = ref(260)
const searchOpen = ref(false)
const theme = ref<'light' | 'dark'>('light')
const tabIds = ref<string[]>([])
const draggingTabId = ref<string | null>(null)
const tabDrop = ref<{ id: string; side: 'before' | 'after' } | null>(null)

const pageTabs = computed(() =>
  tabIds.value
    .map((id) => ws.pages.find((p) => p.id === id && !p.trashedAt))
    .filter((p): p is NonNullable<typeof p> => !!p),
)

watch(
  () => route.params.id,
  (id) => {
    if (typeof id !== 'string') return
    if (!tabIds.value.includes(id)) tabIds.value = [...tabIds.value, id].slice(-12)
    localStorage.setItem('slate-page-tabs', JSON.stringify(tabIds.value))
  },
)

provide('openSearch', () => (searchOpen.value = true))
provide('openPageTab', openPageTab)
provide('navigatePage', navigatePage)
provide('toggleTheme', toggleTheme)
provide('theme', theme)

function applyTheme(t: 'light' | 'dark') {
  theme.value = t
  document.body.dataset.notesTheme = t
  localStorage.setItem('slate-theme', t)
}

function toggleTheme() {
  applyTheme(theme.value === 'light' ? 'dark' : 'light')
}

async function newPage() {
  const p = await ws.createPage(null, '')
  openPageTab(p.id, true)
}

function openTab(id: string) {
  router.push({ name: 'notes-page', params: { id } })
}

function openPageTab(id: string, activate = false) {
  const existed = tabIds.value.includes(id)
  if (!existed) {
    tabIds.value = [...tabIds.value, id].slice(-12)
    localStorage.setItem('slate-page-tabs', JSON.stringify(tabIds.value))
  }
  if (activate || existed) router.push({ name: 'notes-page', params: { id } })
}

function navigatePage(id: string) {
  if (tabIds.value.includes(id)) {
    router.push({ name: 'notes-page', params: { id } })
    return
  }
  const currentId = typeof route.params.id === 'string' ? route.params.id : null
  const currentIndex = currentId ? tabIds.value.indexOf(currentId) : -1
  if (currentIndex >= 0) {
    const next = [...tabIds.value]
    next[currentIndex] = id
    tabIds.value = next
    localStorage.setItem('slate-page-tabs', JSON.stringify(tabIds.value))
  } else {
    tabIds.value = [...tabIds.value, id].slice(-12)
    localStorage.setItem('slate-page-tabs', JSON.stringify(tabIds.value))
  }
  router.push({ name: 'notes-page', params: { id } })
}

function closeTab(id: string) {
  const index = tabIds.value.indexOf(id)
  tabIds.value = tabIds.value.filter((tabId) => tabId !== id)
  localStorage.setItem('slate-page-tabs', JSON.stringify(tabIds.value))
  if (route.params.id !== id) return
  const nextId = tabIds.value[Math.max(0, index - 1)] ?? tabIds.value[0]
  if (nextId) router.push({ name: 'notes-page', params: { id: nextId } })
  else router.push('/notes')
}

function onTabMouseup(e: MouseEvent, id: string) {
  if (e.button !== 1) return
  e.preventDefault()
  e.stopPropagation()
  closeTab(id)
}

function preventTabMiddle(e: MouseEvent) {
  if (e.button !== 1) return
  e.preventDefault()
  e.stopPropagation()
}

async function addRootTab() {
  const p = await ws.createPage(null, '')
  openPageTab(p.id, true)
}

function onTabDragStart(id: string, e: DragEvent) {
  draggingTabId.value = id
  e.dataTransfer?.setData('slate/tab-id', id)
  e.dataTransfer!.effectAllowed = 'move'
}

function onTabDragOver(id: string, e: DragEvent) {
  const moving = draggingTabId.value ?? e.dataTransfer?.getData('slate/tab-id')
  if (!moving || moving === id) return
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tabDrop.value = { id, side: e.clientX < rect.left + rect.width / 2 ? 'before' : 'after' }
}

function onTabDrop(id: string, e: DragEvent) {
  e.preventDefault()
  const moving = draggingTabId.value ?? e.dataTransfer?.getData('slate/tab-id')
  const drop = tabDrop.value
  draggingTabId.value = null
  tabDrop.value = null
  if (!moving || moving === id || !drop) return
  const next = tabIds.value.filter((tabId) => tabId !== moving)
  const targetIndex = next.indexOf(drop.id)
  next.splice(drop.side === 'before' ? targetIndex : targetIndex + 1, 0, moving)
  tabIds.value = next
  localStorage.setItem('slate-page-tabs', JSON.stringify(tabIds.value))
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchOpen.value = !searchOpen.value
  } else if (mod && e.key === '\\') {
    e.preventDefault()
    sidebarOpen.value = !sidebarOpen.value
  } else if (mod && e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    newPage()
  }
}

// sidebar resize
let resizing = false
function startResize() {
  resizing = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
function onMouseMove(e: MouseEvent) {
  if (!resizing) return
  const left = appRoot.value?.getBoundingClientRect().left ?? 0
  sidebarWidth.value = Math.min(420, Math.max(180, e.clientX - left))
}
function stopResize() {
  if (!resizing) return
  resizing = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onMounted(async () => {
  const saved = localStorage.getItem('slate-theme') as 'light' | 'dark' | null
  applyTheme(saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', stopResize)
  await ws.load()
  try {
    const savedTabs = JSON.parse(localStorage.getItem('slate-page-tabs') ?? '[]')
    if (Array.isArray(savedTabs)) tabIds.value = savedTabs.filter((id): id is string => typeof id === 'string')
  } catch (err) {
    console.error('Failed to restore saved page tabs from localStorage.', err)
    tabIds.value = []
  }
  if (typeof route.params.id === 'string' && !tabIds.value.includes(route.params.id)) {
    tabIds.value = [...tabIds.value, route.params.id]
    localStorage.setItem('slate-page-tabs', JSON.stringify(tabIds.value))
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', stopResize)
  delete document.body.dataset.notesTheme
})
</script>

<template>
  <div ref="appRoot" class="notes-workspace app" v-if="ws.loaded">
    <aside class="sidebar" v-show="sidebarOpen" :style="{ width: sidebarWidth + 'px' }">
      <Sidebar
        @open-search="searchOpen = true"
        @toggle-sidebar="sidebarOpen = false"
      />
      <div class="resize-handle" @mousedown.prevent="startResize" />
    </aside>
    <main class="main">
      <button v-if="!sidebarOpen" class="icon-btn sidebar-opener" title="Open sidebar (Ctrl+\)" @click="sidebarOpen = true">☰</button>
      <div class="page-tabs">
        <button
          v-for="tab in pageTabs"
          :key="tab.id"
          class="page-tab"
          :class="{
            active: route.params.id === tab.id,
            'drop-before': tabDrop?.id === tab.id && tabDrop.side === 'before',
            'drop-after': tabDrop?.id === tab.id && tabDrop.side === 'after',
          }"
          draggable="true"
          @click="openTab(tab.id)"
          @mousedown="preventTabMiddle"
          @pointerdown="preventTabMiddle"
          @mouseup="onTabMouseup($event, tab.id)"
          @auxclick.stop.prevent="onTabMouseup($event, tab.id)"
          @dragstart="onTabDragStart(tab.id, $event)"
          @dragover="onTabDragOver(tab.id, $event)"
          @dragleave="tabDrop = null"
          @drop="onTabDrop(tab.id, $event)"
          @dragend="draggingTabId = null; tabDrop = null"
        >
          <span class="tab-icon">{{ tab.icon ?? (tab.type === 'database' ? '▦' : '📄') }}</span>
          <span class="tab-title">{{ tab.title || 'Untitled' }}</span>
          <span class="tab-close" title="Close tab" @click.stop="closeTab(tab.id)">×</span>
        </button>
        <button class="tab-add" title="New root page" @click="addRootTab">＋</button>
      </div>
      <div class="notes-page-scroll">
        <PageView v-if="typeof route.params.id === 'string'" :id="route.params.id" />
        <EmptyState v-else />
      </div>
    </main>
    <SearchModal v-if="searchOpen" @close="searchOpen = false" />
  </div>
  <div v-else class="notes-workspace loading">Loading workspace…</div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}
.sidebar {
  position: relative;
  flex-shrink: 0;
  background: var(--notes-bg-sidebar);
  border-right: 1px solid var(--notes-border);
  display: flex;
  flex-direction: column;
}
.resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}
.main {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.page-tabs {
  position: relative;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 1px;
  min-height: 36px;
  padding: 4px 8px 0;
  background: var(--notes-bg);
  border-bottom: 1px solid var(--notes-border);
  overflow-x: auto;
  flex: 0 0 auto;
}
.notes-page-scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.page-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
  max-width: 220px;
  height: 31px;
  padding: 0 6px 0 8px;
  border-radius: 6px 6px 0 0;
  color: var(--notes-text-secondary);
  font-size: 13px;
  flex-shrink: 0;
}
.page-tab.drop-before::before,
.page-tab.drop-after::after {
  content: '';
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 2px;
  border-radius: 2px;
  background: var(--notes-accent);
}
.page-tab.drop-before::before { left: -1px; }
.page-tab.drop-after::after { right: -1px; }
.page-tab:hover { background: var(--notes-bg-hover); }
.page-tab.active {
  background: var(--notes-bg-active);
  color: var(--notes-text);
}
.tab-icon {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
  font-size: 13px;
}
.tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--notes-text-faint);
  flex-shrink: 0;
}
.tab-close:hover {
  background: var(--notes-bg-hover);
  color: var(--notes-text);
}
.tab-add {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  color: var(--notes-text-secondary);
  flex-shrink: 0;
}
.tab-add:hover { background: var(--notes-bg-hover); }
.sidebar-opener {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 20;
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--notes-text-secondary);
}
</style>
