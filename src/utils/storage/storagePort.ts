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
  private listeners: Array<(changes: Record<string, unknown>) => void> = [];

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      const all: Record<string, unknown> = {};
      for (const [k, v] of this.store) all[k] = v;
      return all;
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) if (this.store.has(k)) result[k] = this.store.get(k);
      return result;
    }
    if (typeof keys === 'string') {
      return this.store.has(keys) ? { [keys]: this.store.get(keys) } : {};
    }
    return {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.store.set(k, v);
    for (const cb of this.listeners) cb(items);
  }

  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    this.listeners.push(callback);
  }

  async getBytesInUse(_keys?: string | string[] | null): Promise<number> {
    return 0;
  }

  // Test helper to seed data
  seed(items: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(items)) this.store.set(k, v);
  }

  // Testing helper: inspect underlying store
  dump(): Record<string, unknown> {
    const all: Record<string, unknown> = {};
    for (const [k, v] of this.store) all[k] = v;
    return all;
  }

  clear(): void {
    this.store.clear();
  }
}
