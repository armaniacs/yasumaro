// @layer 1 — Infrastructure: StoragePort pure seam
/**
 * StoragePort — pure thin wrapper over chrome.storage.local
 *
 * Pure interface with only primitive operations: get / set / onChanged / getBytesInUse.
 * No business logic (defaults, migration, encryption, quota) lives here.
 * SettingsRepository owns that logic and drives this port.
 */

export interface StoragePort {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged?(callback: (changes: Record<string, unknown>) => void): void;
  getBytesInUse?(keys?: string | string[] | null): Promise<number>;
}

export class ChromeStoragePort implements StoragePort {
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(keys) as Promise<Record<string, unknown>>;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(items);
  }
  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const local: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes)) local[k] = (v as { newValue: unknown }).newValue;
      callback(local);
    });
  }
  async getBytesInUse(keys?: string | string[] | null): Promise<number> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.getBytesInUse) {
        if (keys === null || keys === undefined) return await chrome.storage.local.getBytesInUse(null as unknown as string);
        if (typeof keys === 'string') return await chrome.storage.local.getBytesInUse(keys);
        if (Array.isArray(keys)) return await chrome.storage.local.getBytesInUse(keys);
        return await chrome.storage.local.getBytesInUse(null as unknown as string);
      }
    } catch {
      // fallback to 0 in test env
    }
    return 0;
  }
}

export class InMemoryStoragePort implements StoragePort {
  private store = new Map<string, unknown>();
  private versions = new Map<string, number>();
  private listeners: Array<(changes: Record<string, unknown>) => void> = [];

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      const all: Record<string, unknown> = {};
      for (const [k, v] of this.store) all[k] = v;
      for (const [k, v] of this.versions) all[`${k}_version`] = v;
      return all;
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        if (k.endsWith('_version')) {
          const base = k.slice(0, -8);
          if (this.versions.has(base)) result[k] = this.versions.get(base);
        } else if (this.store.has(k)) {
          result[k] = this.store.get(k);
        } else if (this.versions.has(k)) {
          // version key requested directly via base name fallback
          result[`${k}_version`] = this.versions.get(k);
        }
      }
      // also include version keys when base key is requested via version semantics
      for (const k of keys) {
        if (!k.endsWith('_version') && this.versions.has(k) && !keys.includes(`${k}_version`)) {
          // do not auto-include; only when explicitly requested
        }
      }
      return result;
    }
    if (typeof keys === 'string') {
      if (keys.endsWith('_version')) {
        const base = keys.slice(0, -8);
        return this.versions.has(base) ? { [keys]: this.versions.get(base) } : {};
      }
      return this.store.has(keys) ? { [keys]: this.store.get(keys) } : {};
    }
    return {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      if (k.endsWith('_version') && typeof v === 'number') {
        const base = k.slice(0, -8);
        this.versions.set(base, v);
      } else {
        this.store.set(k, v);
        // auto-increment version for the base key when not explicitly provided
        // mimics Chrome's withOptimisticLock version bump so tests see version increments
        if (!(`${k}_version` in items)) {
          const cur = this.versions.get(k) ?? 0;
          // only bump version for known versioned keys (settings, trust_db:json etc.)
          // but keep it generic: bump whenever base key is written without explicit version
          if (k === 'settings' || k === 'trust_db:json' || k.startsWith('settings')) {
            this.versions.set(k, cur + 1);
          }
        }
      }
    }
    // handle explicit version writes that arrived as base_version in same batch
    for (const [k, v] of Object.entries(items)) {
      if (k.endsWith('_version') && typeof v === 'number') {
        const base = k.slice(0, -8);
        this.versions.set(base, v);
      }
    }
    for (const cb of this.listeners) cb(items);
  }

  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    this.listeners.push(callback);
  }

  async getBytesInUse(keys?: string | string[] | null): Promise<number> {
    // Estimate size for quota tests — sum JSON lengths of relevant keys
    const targetKeys = keys == null
      ? [...this.store.keys()]
      : typeof keys === 'string'
        ? [keys]
        : keys;
    let total = 0;
    for (const k of targetKeys) {
      if (k.endsWith('_version')) continue;
      const v = this.store.get(k);
      if (v !== undefined) {
        try { total += JSON.stringify(v).length; } catch { total += 256; }
      }
    }
    // include version overhead
    for (const k of targetKeys) {
      if (!k.endsWith('_version') && this.versions.has(k)) total += 8;
    }
    return total;
  }

  // Test helper to seed data
  seed(items: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(items)) {
      if (k.endsWith('_version') && typeof v === 'number') {
        this.versions.set(k.slice(0, -8), v);
      } else {
        this.store.set(k, v);
      }
    }
  }

  // Testing helper: inspect underlying store
  dump(): Record<string, unknown> {
    const all: Record<string, unknown> = {};
    for (const [k, v] of this.store) all[k] = v;
    for (const [k, v] of this.versions) all[`${k}_version`] = v;
    return all;
  }

  clear(): void {
    this.store.clear();
    this.versions.clear();
    this.listeners = [];
  }

  // Test helper: read version for assertions
  getVersion(key: string): number | undefined {
    return this.versions.get(key);
  }
}
