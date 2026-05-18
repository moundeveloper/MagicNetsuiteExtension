export interface CacheEntry {
  content: string;
  description?: string;
  storedAt: string;
  sizeChars: number;
}

const _cache = new Map<string, CacheEntry>();

export const agentCache = {
  set(key: string, content: string, description?: string): void {
    _cache.set(key, {
      content,
      description,
      storedAt: new Date().toISOString(),
      sizeChars: content.length
    });
  },

  get(key: string): CacheEntry | undefined {
    return _cache.get(key);
  },

  delete(key: string): boolean {
    return _cache.delete(key);
  },

  list(): { key: string; description?: string; storedAt: string; sizeChars: number }[] {
    return Array.from(_cache.entries()).map(([key, entry]) => ({
      key,
      description: entry.description,
      storedAt: entry.storedAt,
      sizeChars: entry.sizeChars
    }));
  },

  clear(): void {
    _cache.clear();
  }
};
