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
import { STORAGE_KEY_VALUES, restoreLatestSettingsBackup } from './settingsBackup.js';
import { ChromeStoragePort, InMemoryStoragePort, type StoragePort } from './storagePort.js';
import { StorageTransaction } from './storageTransaction.js';

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

/**
 * Deep repository: one seam (StoragePort), typed keys, defaults + validation inside.
 */
export class SettingsRepository {
  private port: StoragePort;
  private keyProvider: (() => Promise<CryptoKey>) | undefined;
  private cached: { data: SettingsType; timestamp: number; epoch: number } | null = null;
  /**
   * Monotonic invalidation counter, advanced by every completed write and by
   * every observed 'settings' change. A getAll() stamps its cache entry with
   * the epoch captured before its read, so a write landing inside the read's
   * async window invalidates the entry even when the assignment lands after
   * the write's post-drop — ordering alone cannot close that interleave,
   * because the stale assignment has no ordering handle on the write.
   */
  private writeEpoch = 0;
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

  /**
   * Spread `patch` over the blob read fresh under the write lock, so keys the
   * patch does not mention keep their stored values.
   */
  private mergeSettingsBlob(base: unknown, patch: Record<string, unknown>): SettingsType {
    const current = (base as Record<string, unknown>) || {};
    return { ...(current as object), ...patch } as SettingsType;
  }

  /**
   * The single settings write path: merge a delta under the write lock and drop
   * the repo cache around it.
   *
   * WHY: every write funnels through here so the delta-write contract (see
   * setAll) has one implementation — a full cached snapshot in the payload
   * would revert keys a concurrent writer changed.
   *
   * WHY the cache is dropped on both sides: a concurrent getAll() during the
   * merge window would otherwise re-populate it with the pre-write snapshot,
   * and the post-write drop is what keeps that snapshot from being served.
   *
   * WHY the epoch also advances: the drops alone cannot close the interleave
   * where a getAll() that started earlier assigns its pre-write snapshot after
   * both drops land. The epoch stamp invalidates such an entry on the next
   * cache hit instead.
   */
  private async persistMerged(patch: Record<string, unknown>): Promise<void> {
    this.cached = null;
    const tx = new StorageTransaction(this.port);
    await tx.withLock<SettingsType>('settings', (current) => this.mergeSettingsBlob(current, patch));
    this.writeEpoch++;
    this.cached = null;
  }

  private async persistReEncrypted(reEncrypted: Record<string, unknown>): Promise<void> {
    if (Object.keys(reEncrypted).length === 0) return;
    await this.persistMerged(reEncrypted);
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
    // Captured before the first await: any write completing below advances the
    // epoch, so the entry assigned at the tail can never be served as current.
    const readEpoch = this.writeEpoch;
    const now = Date.now();
    if (this.cached && this.cached.epoch === this.writeEpoch && (now - this.cached.timestamp) < this.CACHE_TTL) {
      return this.cached.data;
    }
    const { applyMigrationsAndDecryptWithReEncrypt, isSettingsBlobAuthoritative } = await import('./settingsMigration.js');
    const keyProvider = await this.resolveKeyProvider();

    // Unified read via Port (no direct chrome.storage)
    const result = await this.port.get(['settings', 'settings_migrated']) as Record<string, unknown>;

    let migratedResult: SettingsType;
    // A partial migration stage is truthy but not authoritative: reading the blob
    // alone there would hide raw keys the migration has not folded in yet, so
    // those states fall back to the scattered-key merge below.
    if (result['settings'] && isSettingsBlobAuthoritative(result['settings_migrated'])) {
      let settings = result['settings'] as SettingsType;
      if (Object.keys(settings as Record<string, unknown>).length === 0) {
        const recovered = await restoreLatestSettingsBackup(this.port);
        if (recovered) settings = recovered as SettingsType;
      }
      const filtered = {} as SettingsType;
      for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
        if (STORAGE_KEY_VALUES.has(k)) (filtered as Record<string, unknown>)[k] = v;
      }
      const { settings: migrated, reEncrypted } = await applyMigrationsAndDecryptWithReEncrypt(filtered, { getEncryptionKey: keyProvider });
      if (Object.keys(reEncrypted).length > 0) {
        await this.persistReEncrypted(reEncrypted);
      }
      migratedResult = migrated;
    } else {
      migratedResult = await this.__getAllScatteredFallback(result['settings'] as SettingsType | undefined, keyProvider);
    }
    this.cached = { data: migratedResult, timestamp: Date.now(), epoch: readEpoch };
    return migratedResult;
  }

  /**
   * @internal Test-only seam for the legacy scattered-key migration path.
   * Normal production code always writes a single `settings` object,
   * so this path is unreachable after first migration. Exposed only so
   * migration tests can exercise it without touching private internals.
   */
  async __getAllScatteredFallback(
    rawSettings: SettingsType | undefined,
    keyProvider: () => Promise<CryptoKey>
  ): Promise<SettingsType> {
    const { applyMigrationsAndDecryptWithReEncrypt } = await import('./settingsMigration.js');
    // Scattered fallback (legacy pre-migration path) — also via Port
    const keysToGet: string[] = [...STORAGE_KEY_VALUES];
    let scattered = await this.port.get(keysToGet) as Record<string, unknown>;
    if (rawSettings) scattered = { ...scattered, ...(rawSettings as Record<string, unknown>) };
    const { settings: migrated, reEncrypted } = await applyMigrationsAndDecryptWithReEncrypt(scattered as SettingsType, { getEncryptionKey: keyProvider });
    if (Object.keys(reEncrypted).length > 0) {
      await this.persistReEncrypted(reEncrypted);
    }
    return migrated;
  }

  clearCache(): void {
    this.cached = null;
  }

  async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    // Delta write (PBI 2026-09-17-17): only this key enters the write payload.
    // Spreading getAll() here used to carry repo-cache staleness into storage
    // and silently revert unrelated keys a concurrent writer had changed.
    await this.writeSettings({ [key]: value } as Partial<SettingsType>);
  }

  /**
   * Write the given keys as a delta: unspecified keys keep their stored
   * values, re-read fresh under the write lock at save time. Do NOT pass a
   * full cached snapshot — its unrelated keys would overwrite concurrent
   * writers' changes with stale values (settings import is the intended
   * full-payload case).
   */
  async setAll(settings: Partial<SettingsType>, opts?: SettingsWriteOptions): Promise<void> {
    await this.writeSettings(settings, opts);
  }

  private async writeSettings(delta: Partial<SettingsType>, opts?: SettingsWriteOptions): Promise<void> {
    const { API_KEY_FIELDS } = await import('./settingsMigration.js');
    const { encryptApiKey } = await import('../crypto/index.js');
    const { ensureStorageQuota } = await import('./storageMaintenance.js');
    let toSave: Record<string, unknown> = { ...(delta as Record<string, unknown>) };
    const keyProvider = await this.resolveKeyProvider();
    try {
      const key = await keyProvider();
      for (const field of API_KEY_FIELDS) {
        const val = toSave[field];
        if (typeof val === 'string' && val !== '') {
          toSave[field] = await encryptApiKey(val, key, field);
        }
      }
    } catch (e) {
      const { ErrorCode } = await import('../logger/types.js');
const { logError } = await import('../logger/api.js');
      const { errorMessage } = await import('../errorUtils.js');
      await logError('Failed to encrypt API keys', { error: errorMessage(e as Error) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
      throw e;
    }
    await ensureStorageQuota(toSave, opts?.sqliteHealthCheck);
    await this.persistMerged(toSave);
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
        // Same invalidation the write path performs: an in-flight getAll()
        // that assigns after this drop must not serve the pre-change snapshot.
        this.writeEpoch++;
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
