<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { BlockType } from '../types'

const props = defineProps<{ x: number; y: number; blockId: string; query?: string }>()
const emit = defineEmits<{
  (e: 'pick', type: BlockType | 'page'): void
  (e: 'close'): void
}>()

interface Cmd {
  type: BlockType | 'page'
  label: string
  icon: string
  group: string
  aliases: string[]
}

const COMMANDS: Cmd[] = [
  { type: 'paragraph', label: 'Text', icon: '¶', group: 'Basic', aliases: ['text', 'p', 'paragraph'] },
  { type: 'heading1', label: 'Heading 1', icon: 'H1', group: 'Basic', aliases: ['h1', 'heading', 'title'] },
  { type: 'heading2', label: 'Heading 2', icon: 'H2', group: 'Basic', aliases: ['h2', 'subheading'] },
  { type: 'heading3', label: 'Heading 3', icon: 'H3', group: 'Basic', aliases: ['h3'] },
  { type: 'callout', label: 'Callout', icon: '💡', group: 'Basic', aliases: ['callout', 'note'] },
  { type: 'quote', label: 'Quote', icon: '❝', group: 'Basic', aliases: ['quote', 'blockquote'] },
  { type: 'divider', label: 'Divider', icon: '—', group: 'Basic', aliases: ['divider', 'hr', 'separator'] },
  { type: 'bulleted', label: 'Bulleted list', icon: '•', group: 'Lists', aliases: ['bullet', 'ul', 'list'] },
  { type: 'numbered', label: 'Numbered list', icon: '1.', group: 'Lists', aliases: ['numbered', 'ol', 'ordered'] },
  { type: 'todo', label: 'To-do', icon: '☑', group: 'Lists', aliases: ['todo', 'task', 'checkbox'] },
  { type: 'toggle', label: 'Toggle', icon: '▸', group: 'Lists', aliases: ['toggle', 'collapse'] },
  { type: 'code', label: 'Code', icon: '‹›', group: 'Media', aliases: ['code', 'snippet'] },
  { type: 'image', label: 'Image', icon: '🖼', group: 'Media', aliases: ['image', 'img', 'photo', 'picture'] },
  { type: 'page', label: 'Page', icon: '📄', group: 'Navigation', aliases: ['page', 'subpage'] },
]

const selected = ref(0)

watch(
  () => props.query,
  () => {
    selected.value = 0
  },
)

const filtered = computed(() => {
  const q = (props.query ?? '').toLowerCase()
  if (!q) return COMMANDS
  return COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.aliases.some((a) => a.includes(q)),
  )
})

const grouped = computed(() => {
  const map = new Map<string, Cmd[]>()
  for (const c of filtered.value) {
    if (!map.has(c.group)) map.set(c.group, [])
    map.get(c.group)!.push(c)
  }
  return map
})

function flatIndex(cmd: Cmd): number {
  return filtered.value.indexOf(cmd)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopPropagation()
    selected.value = Math.min(filtered.value.length - 1, selected.value + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    selected.value = Math.max(0, selected.value - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    const cmd = filtered.value[selected.value]
    if (cmd) emit('pick', cmd.type)
  }
}

function onClickOutside(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.slash-menu')) emit('close')
}

function onViewportScroll(e: Event) {
  const target = e.target
  if (target instanceof Element && target.closest('.slash-menu')) return
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('mousedown', onClickOutside)
  window.addEventListener('scroll', onViewportScroll, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('mousedown', onClickOutside)
  window.removeEventListener('scroll', onViewportScroll, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="menu slash-menu notes-portal"
      :style="{ left: Math.min(x, 9999) + 'px', top: y + 'px' }"
    >
      <template v-for="[group, cmds] in grouped" :key="group">
        <div class="menu-label">{{ group }}</div>
        <button
          v-for="c in cmds"
          :key="c.label"
          class="menu-item"
          :class="{ selected: flatIndex(c) === selected }"
          @mousemove="selected = flatIndex(c)"
          @click="emit('pick', c.type)"
        >
          <span class="mi-icon">{{ c.icon }}</span>
          {{ c.label }}
          <span class="mi-hint">/{{ c.aliases[0] }}</span>
        </button>
      </template>
      <div v-if="!filtered.length" class="slash-empty">No matching blocks</div>
    </div>
  </Teleport>
</template>

<style scoped>
.slash-menu { width: 292px; }
.slash-empty { padding: 12px; text-align: center; color: var(--notes-text-faint); font-size: 13px; }
</style>
