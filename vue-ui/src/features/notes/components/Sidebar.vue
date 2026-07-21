<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspace } from '../stores/workspace'
import PageTreeItem from './PageTreeItem.vue'
import TrashPanel from './TrashPanel.vue'

const emit = defineEmits<{ (e: 'open-search'): void; (e: 'toggle-sidebar'): void }>()
const ws = useWorkspace()
const router = useRouter()
const theme = inject<Ref<'light' | 'dark'>>('theme')!
const toggleTheme = inject<() => void>('toggleTheme')!

const trashOpen = ref(false)

async function newPage(type: 'page' | 'database' = 'page') {
  const p = await ws.createPage(null, '', type)
  router.push({ name: 'notes-page', params: { id: p.id } })
}

// drop page to root level
function onRootDrop(e: DragEvent) {
  const id = e.dataTransfer?.getData('slate/page-id')
  if (id) ws.movePage(id, null, ws.childrenOf(null).length)
}
</script>

<template>
  <div class="sb">
    <div class="sb-header">
      <span class="sb-title">Notes</span>
      <button class="icon-btn" :title="theme === 'light' ? 'Dark mode' : 'Light mode'" @click="toggleTheme()">
        {{ theme === 'light' ? '☾' : '☀' }}
      </button>
      <button class="icon-btn" title="Collapse sidebar (Ctrl+\)" @click="emit('toggle-sidebar')">«</button>
    </div>

    <button class="sb-row" @click="emit('open-search')">
      <span class="sb-icon">🔍</span> Search <span class="sb-kbd">Ctrl+K</span>
    </button>
    <button class="sb-row" @click="newPage()">
      <span class="sb-icon">＋</span> New page
    </button>
    <button class="sb-row" @click="newPage('database')">
      <span class="sb-icon">▦</span> New database
    </button>

    <div class="sb-scroll">
      <template v-if="ws.favorites.length">
        <div class="sb-label">Favorites</div>
        <PageTreeItem v-for="p in ws.favorites" :key="'fav-' + p.id" :page="p" :depth="0" flat />
      </template>

      <div class="sb-label">Pages</div>
      <div @dragover.prevent @drop="onRootDrop">
        <PageTreeItem v-for="p in ws.childrenOf(null)" :key="p.id" :page="p" :depth="0" />
        <div v-if="!ws.childrenOf(null).length" class="sb-empty">No pages yet</div>
      </div>
    </div>

    <div class="sb-footer">
      <button class="sb-row" @click="trashOpen = true">
        <span class="sb-icon">🗑</span> Trash
        <span v-if="ws.trashedPages.length" class="sb-count">{{ ws.trashedPages.length }}</span>
      </button>
    </div>

    <TrashPanel v-if="trashOpen" @close="trashOpen = false" />
  </div>
</template>

<style scoped>
.sb { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.sb-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 12px 8px;
}
.sb-title { font-weight: 600; flex: 1; }
.sb-row {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% - 16px);
  min-height: 30px;
  margin: 0 8px;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--notes-text-secondary);
  font-size: 14px;
  text-align: left;
}
.sb-row:hover { background: var(--notes-bg-hover); }
.sb-icon {
  width: 18px;
  height: 18px;
  text-align: center;
  font-size: 13px;
  line-height: 18px;
  flex-shrink: 0;
}
.sb-kbd { margin-left: auto; font-size: 11px; color: var(--notes-text-faint); }
.sb-count {
  margin-left: auto; font-size: 11px; color: var(--notes-text-faint);
  background: var(--notes-bg-active); border-radius: 8px; padding: 0 6px;
}
.sb-scroll { flex: 1; overflow-y: auto; padding: 4px 0 12px; }
.sb-label {
  padding: 12px 16px 4px;
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--notes-text-faint);
}
.sb-empty { padding: 4px 16px; color: var(--notes-text-faint); font-size: 13px; }
.sb-footer { border-top: 1px solid var(--notes-border); padding: 8px 0; }
</style>
