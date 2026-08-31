// @layer 1 — Infrastructure: settings repository seam (deep module, hides 30+ scattered StorageKeys accesses)
/**
 * SettingsRepository — deep module hiding the 30 scattered StorageKeys accesses
 *
 * Phase15 deepening:
 * - StoragePort { get/set/onChanged/getBytesInUse } is the single pure seam (thin wrapper)
 * - SettingsRepository { get/set/observe } owns defaults + migration + encryption + quota
 * - getSettings/setSettings double impl and rawEncrypted flag are removed
 * - re-encrypt side effect is via Port inside getAll, not direct chrome.storage
 * - optimisticLock is chrome-specific inside Settings layer; InMemory does not mimic version
 */

import type { StorageKey, Settings as SettingsType, SqliteHealthCheck } from './types.js';
import { StorageKeys } from './types.js';
import { ChromeStoragePort, InMemoryStoragePort, type StoragePort } from './storagePort.js';
import { withOptimisticLock } from '../optimisticLock.js';

/** Options forwarded to the storage write path. */
export interface SettingsWriteOptions {
  sqliteHealthCheck?: SqliteHealthCheck;
}

/** @deprecated Use StoragePort — kept for migration compat */
export type StorageAdapter = StoragePort;

/** Re-export Port impls under legacy Adapter names for backward compat */
export class ChromeStorageAdapter extends ChromeStoragePort implements StoragePort {}
export class InMemoryStorageAdapter extends InMemoryStoragePort implements StoragePort {}

/** Options for SettingsRepository construction */
export interface SettingsRepositoryOptions {
  /** Injected KeyProvider for decrypt/re-encrypt; defaults to getOrCreateEncryptionKey */
  keyProvider?: () => Promise<CryptoKey>;
}

function isChromePort(port: StoragePort): boolean {
  return port instanceof ChromeStoragePort;
}

async function tryRestoreFromBackupViaPort(port: StoragePort): Promise<SettingsType | null> {
  const all = await port.get(null);
  const backupKeys = Object.keys(all).filter((k) => k.startsWith('legacy_settings_backup'));
  if (backupKeys.length === 0) return null;
  backupKeys.sort().reverse();
  const firstKey = backupKeys[0];
  if (!firstKey) return null;
  const latest = all[firstKey] as { data: Record<string, unknown>; createdAt: number } | undefined;
  if (!latest?.data) return null;
  const restored: SettingsType = {};
  for (const [key, value] of Object.entries(latest.data)) {
    if ((Object.values(StorageKeys) as string[]).includes(key)) {
      (restored as Record<string, unknown>)[key] = value;
    }
  }
  // Persist restored via optimisticLock when chrome, otherwise via port
  if (restored && Object.keys(restored).length > 0) {
    if (isChromePort(port)) {
      await withOptimisticLock<SettingsType>('settings', (current) => ({ ...(current as Record<string, unknown> || {}), ...restored } as SettingsType));
    } else {
      const existing = await port.get(['settings']);
      const current = (existing['settings'] as Record<string, unknown>) || {};
      await port.set({ settings: { ...current, ...restored } });
    }
  }
  return restored;
}

/**
 * Deep repository: one seam (StoragePort), typed keys, defaults + validation inside.
 */
export class SettingsRepository {
  private port: StoragePort;
  private keyProvider: (() => Promise<CryptoKey>) | undefined;
  private cached: { data: SettingsType; timestamp: number } | null = null;
  private readonly CACHE_TTL = 1000;

  constructor(port: StoragePort = new ChromeStoragePort(), opts?: SettingsRepositoryOptions) {
    this.port = port;
    this.keyProvider = opts?.keyProvider;
  }

  /**
   * Resolve KeyProvider lazily to avoid circular import at top-level.
   */
  private async resolveKeyProvider(): Promise<() => Promise<CryptoKey>> {
    if (this.keyProvider) return this.keyProvider;
    const { getOrCreateEncryptionKey } = await import('./encryptionSession.js');
    return getOrCreateEncryptionKey;
  }

  private async persistReEncrypted(reEncrypted: Record<string, unknown>): Promise<void> {
    if (Object.keys(reEncrypted).length === 0) return;
    this.cached = null;
    if (isChromePort(this.port)) {
      await withOptimisticLock<SettingsType>('settings', (current) => {
        const base = (current as Record<string, unknown>) || {};
        return { ...(base as object), ...reEncrypted } as SettingsType;
      });
    } else {
      const existing = await this.port.get(['settings']);
      const current = (existing['settings'] as Record<string, unknown>) || {};
      await this.port.set({ settings: { ...current, ...reEncrypted } });
    }
    this.cached = null;
  }

  /**
   * Typed get — typo in key is a compile error.
   * Default is returned when the key is not stored, so callers never
   * re-derive the default themselves (locality).
   */
  async get<K extends StorageKey>(key: K): Promise<SettingsType[K]> {
    const settings = await this.getAll();
    return settings[key];
  }

  /**
   * Bulk typed get — fetches multiple keys in a single storage call.
   * Missing keys are filled from DEFAULT_SETTINGS.
   */
  async getMany<K extends StorageKey>(keys: readonly K[]): Promise<Pick<SettingsType, K>> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return {} as Pick<SettingsType, K>;

    const settings = await this.getAll();
    const { DEFAULT_SETTINGS } = await import('./defaults.js');
    const out = {} as Record<string, unknown>;
    for (const k of unique) {
      out[k] = k in settings ? settings[k] : (DEFAULT_SETTINGS as unknown as SettingsType)[k];
    }
    return out as Pick<SettingsType, K>;
  }

  async getAll(): Promise<SettingsType> {
    const now = Date.now();
    if (this.cached && (now - this.cached.timestamp) < this.CACHE_TTL) {
      return this.cached.data;
    }
    const { applyMigrationsAndDecryptWithReEncrypt } = await import('./settingsMigration.js');
    const keyProvider = await this.resolveKeyProvider();

    // Unified read via Port (no direct chrome.storage)
    const result = await this.port.get(['settings', 'settings_migrated']) as Record<string, unknown>;
    const rawSettings = result['settings'] as SettingsType | undefined;

    let migratedResult: SettingsType;
    if (result['settings'] && result['settings_migrated']) {
      let settings = result['settings'] as SettingsType;
      if (Object.keys(settings as Record<string, unknown>).length === 0) {
        const recovered = await tryRestoreFromBackupViaPort(this.port);
        if (recovered) settings = recovered as SettingsType;
      }
      const validKeys: string[] = Object.values(StorageKeys) as string[];
      const filtered = {} as SettingsType;
      for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
        if (validKeys.includes(k)) (filtered as Record<string, unknown>)[k] = v;
      }
      const { settings: migrated, reEncrypted } = await applyMigrationsAndDecryptWithReEncrypt(filtered, { getEncryptionKey: keyProvider });
      if (Object.keys(reEncrypted).length > 0) {
        await this.persistReEncrypted(reEncrypted);
      }
      migratedResult = migrated;
    } else {
      // Scattered fallback (legacy pre-migration path) — also via Port
      const keysToGet: string[] = Object.values(StorageKeys) as string[];
      let scattered = await this.port.get(keysToGet) as Record<string, unknown>;
      if (rawSettings) scattered = { ...scattered, ...(rawSettings as Record<string, unknown>) };
      const { settings: migrated, reEncrypted } = await applyMigrationsAndDecryptWithReEncrypt(scattered as SettingsType, { getEncryptionKey: keyProvider });
      if (Object.keys(reEncrypted).length > 0) {
        await this.persistReEncrypted(reEncrypted);
      }
      migratedResult = migrated;
    }
    this.cached = { data: migratedResult, timestamp: Date.now() };
    return migratedResult;
  }

  clearCache(): void {
    this.cached = null;
  }

  async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    const current = await this.getAll();
    const next = { ...current, [key]: value } as SettingsType;
    await this.writeSettings(next);
  }

  async setAll(settings: Partial<SettingsType>, opts?: SettingsWriteOptions): Promise<void> {
    const current = await this.getAll();
    const next = { ...current, ...settings } as SettingsType;
    await this.writeSettings(next, opts);
  }

  private async writeSettings(settings: SettingsType, opts?: SettingsWriteOptions): Promise<void> {
    const { API_KEY_FIELDS } = await import('./settingsMigration.js');
    const { encryptApiKey } = await import('../crypto/index.js');
    const { ensureStorageQuota } = await import('./storageMaintenance.js');
    let toSave: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
    const keyProvider = await this.resolveKeyProvider();
    try {
      const key = await keyProvider();
      for (const field of API_KEY_FIELDS) {
        const val = toSave[field];
        if (typeof val === 'string' && val !== '') {
          toSave[field] = await encryptApiKey(val, key);
        }
      }
    } catch (e) {
      const { logError, ErrorCode } = await import('../logger.js');
      const { errorMessage } = await import('../errorUtils.js');
      await logError('Failed to encrypt API keys', { error: errorMessage(e as Error) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
      throw e;
    }
    await ensureStorageQuota(toSave, opts?.sqliteHealthCheck);
    this.cached = null;
    if (isChromePort(this.port)) {
      await withOptimisticLock<SettingsType>('settings', (current) => {
        const base = (current as Record<string, unknown>) || {};
        return { ...(base as object), ...toSave } as SettingsType;
      });
    } else {
      const existing = await this.port.get(['settings']);
      const base = (existing['settings'] as Record<string, unknown>) || {};
      await this.port.set({ settings: { ...(base as object), ...toSave } });
    }
    this.cached = null;
  }

  /**
   * Subscribe to settings changes. The panel lifecycle can use this
   * instead of chrome.storage.onChanged directly, keeping the storage seam
   * in one module.
   */
  onChange(callback: (changes: Partial<SettingsType>) => void): void {
    this.observe(callback);
  }

  /**
   * Primary observe API — typed key only, via StoragePort.
   */
  observe(callback: (changes: Partial<SettingsType>) => void): void {
    this.port.onChanged?.((changes) => {
      if ('settings' in changes) {
        this.cached = null;
        callback(changes['settings'] as Partial<SettingsType>);
      }
    });
  }

  /** Compat for legacy clearSettingsCache — clears repo cache */
  clearSettingsCache(): void {
    this.clearCache();
  }

  /** Expose underlying port for advanced uses / testing */
  getPort(): StoragePort {
    return this.port;
  }
}

export type SettingsReader = Pick<SettingsRepository, 'getMany' | 'getAll'>;

export const settingsRepository = new SettingsRepository();

/** Re-export StoragePort types for external import paths */
export type { StoragePort } from './storagePort.js';
export { ChromeStoragePort, InMemoryStoragePort } from './storagePort.js';
