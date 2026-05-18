import { ref } from "vue";
import { getChatCache, setChatCache, deleteChatCache, type CacheEntry } from "./aiAssistantDb";

export type { CacheEntry };

// ── Reactive version counter ──────────────────
// Bumped on every mutation so Vue computed/watchers that read cacheVersion.value
// will re-evaluate automatically when the cache changes.
export const cacheVersion = ref(0);

let _currentChatId: string | null = null;
const _cache = new Map<string, CacheEntry>();

/** Fire-and-forget persist to IndexedDB. Safe to call from sync code. */
const _persist = (): void => {
  if (!_currentChatId) return;
  const entries: Record<string, CacheEntry> = {};
  for (const [k, v] of _cache.entries()) {
    entries[k] = v;
  }
  setChatCache(_currentChatId, entries).catch((err) =>
    console.error("[agentCache] persist failed:", err)
  );
};

export const agentCache = {
  /**
   * Load the cache for a given chat from IndexedDB.
   * Call this when switching to or loading a conversation.
   */
  async init(chatId: string): Promise<void> {
    _currentChatId = chatId;
    _cache.clear();
    if (chatId) {
      const stored = await getChatCache(chatId);
      for (const [k, v] of Object.entries(stored)) {
        _cache.set(k, v);
      }
    }
    cacheVersion.value++;
  },

  set(key: string, content: string, description?: string): void {
    _cache.set(key, {
      content,
      description,
      storedAt: new Date().toISOString(),
      sizeChars: content.length
    });
    cacheVersion.value++;
    _persist();
  },

  get(key: string): CacheEntry | undefined {
    return _cache.get(key);
  },

  delete(key: string): boolean {
    const existed = _cache.delete(key);
    if (existed) {
      cacheVersion.value++;
      _persist();
    }
    return existed;
  },

  list(): { key: string; description?: string; storedAt: string; sizeChars: number }[] {
    return Array.from(_cache.entries()).map(([key, entry]) => ({
      key,
      description: entry.description,
      storedAt: entry.storedAt,
      sizeChars: entry.sizeChars
    }));
  },

  /** Clear all entries for the current conversation (in memory + persisted). */
  clear(): void {
    _cache.clear();
    cacheVersion.value++;
    _persist();
  },

  /** Delete the persisted cache record for a specific chat (e.g. on chat deletion). */
  async deleteForChat(chatId: string): Promise<void> {
    await deleteChatCache(chatId);
    if (_currentChatId === chatId) {
      _cache.clear();
      cacheVersion.value++;
    }
  },

  /**
   * Migrate in-memory cache to a new chatId (called when a new chat first gets an ID).
   * Unlike init(), this preserves existing in-memory entries and re-persists them under the new key.
   */
  async migrate(newChatId: string): Promise<void> {
    if (_currentChatId === newChatId) return;
    _currentChatId = newChatId;
    _persist(); // persist current in-memory entries under the new chatId
  },

  get currentChatId(): string | null {
    return _currentChatId;
  }
};
