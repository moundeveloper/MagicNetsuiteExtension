import Dexie, { type Table } from 'dexie'
import type { Block, Page, Settings } from './types'

export class SlateDB extends Dexie {
  pages!: Table<Page, string>
  blocks!: Table<Block, string>
  settings!: Table<Settings, string>

  constructor() {
    super('slate-workspace')
    this.version(1).stores({
      pages: 'id, parentId, trashedAt, isFavorite, updatedAt',
      blocks: 'id, pageId, [pageId+position]',
      settings: 'key',
    })
  }
}

export const db = new SlateDB()

export function uid(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}


