/**
 * DiagnosticsCollector — deep module hiding the 11 diagnostic queries
 *
 * 681-line diagnosticsPanel.ts previously did 11 separate
 * querySelector → makeStatRow → error handling blocks inline.
 * Adding a diagnostic meant copy-pasting the 6-line pattern.
 *
 * This module collapses the gathering behind one seam: collect() → Snapshot.
 * The panel becomes a thin renderer over the snapshot. Chrome dependencies
 * are injected as adapters (local-substitutable), so tests use InMemory fakes.
 *
 * Seam is local-substitutable: chrome.storage / getSqliteStatus have
 * in-memory stand-ins for tests. Two adapters justify the seam.
 */

import { StorageKeys, type Settings, type StorageKey } from '../../../utils/storage/types.js';
import { settingsRepository, type SettingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { getSqliteStatus, getLogCount } from '../../dashboardSqliteService.js';
import { diagnoseDeficiencies, type DiagnosticInput } from '../../diagnoseDeficiencies.js';
import { checkBuiltInAiAvailability, type BuiltInAiDiagnosticsResult } from '../../builtInAiDiagnosticsService.js';
import { detectLiveVfsStrategy } from '../../../offscreen/opfsCapabilities.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getDebugMode } from './debugModeStore.js';
import type { EncryptedData } from '../../../utils/crypto/types.js';
import { ProviderCatalog } from '../../../background/ai/providerCatalog.js';

function stringOrEmpty(value: string | EncryptedData | undefined): string {
  return typeof value === 'string' ? value : '';
}

export interface ProviderDetail {
  provider: string;
  model: string | undefined;
  label: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface DiagnosticsSnapshot {
  storage: { bytesUsedKb: string; savedUrls: string };
  sqlite: {
    initialized: boolean;
    path: string;
    fallback: boolean;
    fts5: boolean;
    compileOptions?: string[];
    compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
    initError?: string;
    opfsMigrationV2Done?: boolean;
    opfsMigrationV2LastAttemptedAt?: string | null;
    opfsMigrationV2CompletedAt?: string | null;
    opfsMigrationV2RecordCount?: number | null;
    idbMigrationV2Done?: boolean;
    opfsLegacyDbPath?: string | null;
    idbLegacyDbName?: string | null;
  } | null;
  deficiencies: ReturnType<typeof diagnoseDeficiencies>;
  builtInAi: BuiltInAiDiagnosticsResult | null;
  obsidian: { protocol: string; port: string; apiKey: string; dailyPath: string };
  aiProviders: Array<{ provider: string; model: string | undefined; label: string }>;
  aiProviderDetails: ProviderDetail[];
  extInfo: { version: string; name: string };
  divergence: { dashboardDetectsOpfs: boolean; offscreenUsesFallback: boolean };
  settingsLoadFailed: boolean;
  debugMode: boolean;
}

export interface DiagnosticsCollectorDeps {
  getMany?: SettingsRepository['getMany'];
  getSqliteStatus?: typeof getSqliteStatus;
  getLogCount?: typeof getLogCount;
  checkBuiltInAiAvailability?: typeof checkBuiltInAiAvailability;
  getStorageBytesInUse?: () => Promise<number>;
  getDebugMode?: () => Promise<boolean>;
  getManifest?: () => { version: string; name: string };
  detectVfsStrategy?: () => { strategy: string };
}

/**
 * Deep collector: one seam, one place to test.
 * All 11 queries are inside, callers get a typed snapshot.
 */
export class DiagnosticsCollector {
  constructor(private deps: DiagnosticsCollectorDeps = {}) {}

  async collect(): Promise<DiagnosticsSnapshot> {
    const getManyFn = this.deps.getMany ?? settingsRepository.getMany.bind(settingsRepository);
    const getSqliteStatusFn = this.deps.getSqliteStatus
      ?? (async () =>
        retryWithExponentialBackoff(() => getSqliteStatus(), { label: 'diagSqliteStatus', maxAttempts: 4 })
      );
    const getLogCountFn = this.deps.getLogCount ?? getLogCount;
    const checkBuiltInAiFn = this.deps.checkBuiltInAiAvailability ?? checkBuiltInAiAvailability;
    const getBytesInUse = this.deps.getStorageBytesInUse ?? (() => chrome.storage.local.getBytesInUse(null));
    const getDebugModeFn = this.deps.getDebugMode ?? getDebugMode;
    // Fallback keeps collect() from rejecting in non-extension test environments
    // where chrome.runtime is undefined; production always has a manifest.
    const getManifestFn = this.deps.getManifest ?? (() => {
      try { return chrome.runtime.getManifest(); } catch { return { version: 'unknown', name: 'unknown' }; }
    });
    const detectVfsStrategyFn = this.deps.detectVfsStrategy ?? detectLiveVfsStrategy;

    let settingsLoadFailed = false;

    // All settings keys needed by this collector — single getMany call.
    // Per-provider keys are derived from the catalog so a new provider needs
    // no edit here.
    const providerKeys = [...ProviderCatalog.all.values()]
      .flatMap((e) => [e.baseUrlKey, e.apiKeyKey, e.modelKey].filter((k): k is string => !!k)) as StorageKey[];
    const settingsKeys: readonly StorageKey[] = [
      StorageKeys.OBSIDIAN_PROTOCOL, StorageKeys.OBSIDIAN_PORT,
      StorageKeys.OBSIDIAN_API_KEY, StorageKeys.OBSIDIAN_DAILY_PATH,
      StorageKeys.AI_PROVIDER_PRIORITY_LIST, StorageKeys.AI_PROVIDER,
      ...new Set(providerKeys),
    ];

    // Parallel gathering — faster than sequential awaits in the old panel
    const [settings, sqliteStatus, logCountResult, builtInAiResult, bytesUsed, debugMode] = await Promise.all([
      getManyFn(settingsKeys).catch(async () => {
        settingsLoadFailed = true;
        const { DEFAULT_SETTINGS } = await import('../../../utils/storage/defaults.js');
        return DEFAULT_SETTINGS as unknown as Pick<Settings, StorageKey>;
      }),
      getSqliteStatusFn().catch(() => null),
      getLogCountFn().catch(() => ({ error: 'unavailable' } as unknown as Awaited<ReturnType<typeof getLogCount>>)),
      checkBuiltInAiFn().catch(() => null),
      getBytesInUse().catch(() => 0),
      getDebugModeFn().catch(() => false),
    ]);

    const protocol = settings[StorageKeys.OBSIDIAN_PROTOCOL] ?? 'https';
    const port = settings[StorageKeys.OBSIDIAN_PORT] ?? '27124';
    const apiKey = stringOrEmpty(settings[StorageKeys.OBSIDIAN_API_KEY]);
    const dailyPath = settings[StorageKeys.OBSIDIAN_DAILY_PATH] ?? '';

    const bytesUsedKb = (bytesUsed / 1024).toFixed(1);
    const savedUrls = (logCountResult && typeof logCountResult === 'object' && 'data' in logCountResult)
      ? String((logCountResult as { data: number }).data)
      : 'Unavailable';

    // Deficiency diagnosis needs sqliteStatus
    let deficiencies: DiagnosticsSnapshot['deficiencies'] = [];
    if (sqliteStatus) {
      const isOpfsWorker = (sqliteStatus.compileOptionsSource === 'opfs-worker') || sqliteStatus.path.startsWith('OPFS:');
      const offscreenStrategy: DiagnosticInput['vfsStrategy'] = sqliteStatus.fallback
        ? 'fallback'
        : isOpfsWorker ? 'opfs-sync-worker' : 'idb';
      const diagInput: DiagnosticInput = {
        opfsDirectory: isOpfsWorker,
        syncAccessHandle: isOpfsWorker,
        worker: isOpfsWorker,
        initialized: sqliteStatus.initialized,
        fallback: sqliteStatus.fallback,
        fts5: sqliteStatus.fts5,
        vfsStrategy: offscreenStrategy,
        ...pickDefined({ initError: sqliteStatus.initError }),
      };
      deficiencies = diagnoseDeficiencies(diagInput);
    }

    // AI providers — Catalog-driven (no per-provider switch)
    const priorityList = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] ?? [];
    const legacyProvider = settings[StorageKeys.AI_PROVIDER] ?? 'gemini';
    const slots = priorityList.length > 0 ? priorityList : [{ provider: legacyProvider }];
    const aiProviders = slots.map((slot: { provider: string; model?: string }) => {
      const entry = ProviderCatalog.tryResolve(slot.provider);
      return {
        provider: slot.provider,
        model: slot.model,
        label: entry?.label ?? slot.provider,
      };
    });

    // Per-provider detailed settings (baseUrl, apiKey) for panel rendering — Catalog-driven
    const aiProviderDetails: ProviderDetail[] = slots.map((slot: { provider: string; model?: string }) => {
      const entry = ProviderCatalog.tryResolve(slot.provider);
      const base: ProviderDetail = {
        provider: slot.provider,
        model: slot.model,
        label: entry?.label ?? slot.provider,
      };
      if (!entry) return base;
      const settingsBag = settings as Partial<Record<string, unknown>>;
      if (entry.modelKey) {
        const v = settingsBag[entry.modelKey] as string | undefined;
        base.model = v ?? slot.model ?? entry.defaultModel;
      }
      if (entry.baseUrlKey) {
        const v = settingsBag[entry.baseUrlKey] as string | undefined;
        base.baseUrl = v ?? '';
      }
      if (entry.apiKeyKey) {
        const v = settingsBag[entry.apiKeyKey] as string | EncryptedData | undefined;
        base.apiKey = stringOrEmpty(v);
      }
      return base;
    });

    // Divergence check (dashboard vs offscreen)
    let dashboardDetectsOpfs = false;
    try {
      const { strategy } = detectVfsStrategyFn();
      dashboardDetectsOpfs = strategy !== 'fallback';
    } catch { /* detectLiveVfsStrategy may fail */ }
    const offscreenUsesFallback = sqliteStatus?.fallback ?? false;

    return {
      storage: { bytesUsedKb, savedUrls },
      sqlite: sqliteStatus,
      deficiencies,
      builtInAi: builtInAiResult,
      obsidian: { protocol, port, apiKey, dailyPath },
      aiProviders,
      aiProviderDetails,
      extInfo: getManifestFn(),
      divergence: { dashboardDetectsOpfs, offscreenUsesFallback },
      settingsLoadFailed,
      debugMode,
    };
  }
}

export const diagnosticsCollector = new DiagnosticsCollector();
