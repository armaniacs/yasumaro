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

import { StorageKeys, type Settings } from '../../../utils/storage/types.js';
import { settingsRepository, type SettingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { getSqliteStatus, getLogCount } from '../../dashboardSqliteService.js';
import { diagnoseDeficiencies, type DiagnosticInput } from '../../diagnoseDeficiencies.js';
import { checkBuiltInAiAvailability, type BuiltInAiDiagnosticsResult } from '../../builtInAiDiagnosticsService.js';
import { detectLiveVfsStrategy } from '../../../offscreen/opfsCapabilities.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getDebugMode } from './debugModeStore.js';
import type { EncryptedData } from '../../../utils/crypto/types.js';

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
    opfsMigrationV2RecordCount?: number;
    idbMigrationV2Done?: boolean;
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

    // All settings keys needed by this collector — single getMany call
    const settingsKeys = [
      StorageKeys.OBSIDIAN_PROTOCOL, StorageKeys.OBSIDIAN_PORT,
      StorageKeys.OBSIDIAN_API_KEY, StorageKeys.OBSIDIAN_DAILY_PATH,
      StorageKeys.AI_PROVIDER_PRIORITY_LIST, StorageKeys.AI_PROVIDER,
      StorageKeys.GEMINI_MODEL, StorageKeys.GEMINI_API_KEY,
      StorageKeys.OPENAI_BASE_URL, StorageKeys.OPENAI_MODEL, StorageKeys.OPENAI_API_KEY,
      StorageKeys.OPENAI_2_BASE_URL, StorageKeys.OPENAI_2_MODEL, StorageKeys.OPENAI_2_API_KEY,
      StorageKeys.LM_STUDIO_BASE_URL, StorageKeys.LM_STUDIO_MODEL,
      StorageKeys.OLLAMA_BASE_URL, StorageKeys.OLLAMA_MODEL,
      StorageKeys.PROVIDER_BASE_URL, StorageKeys.PROVIDER_MODEL, StorageKeys.PROVIDER_API_KEY,
    ] as const;

    // Parallel gathering — faster than sequential awaits in the old panel
    const [settings, sqliteStatus, logCountResult, builtInAiResult, bytesUsed, debugMode] = await Promise.all([
      getManyFn(settingsKeys).catch(async () => {
        settingsLoadFailed = true;
        const { DEFAULT_SETTINGS } = await import('../../../utils/storage/defaults.js');
        return DEFAULT_SETTINGS as unknown as Pick<Settings, typeof settingsKeys[number]>;
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
        : isOpfsWorker ? 'opfs-sync-worker' : 'opfs-async-main';
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

    // AI providers
    const priorityList = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] ?? [];
    const legacyProvider = settings[StorageKeys.AI_PROVIDER] ?? 'gemini';
    const slots = priorityList.length > 0 ? priorityList : [{ provider: legacyProvider }];
    const aiProviders = slots.map((slot: { provider: string; model?: string }) => ({
      provider: slot.provider,
      model: slot.model,
      label: slot.provider,
    }));

    // Per-provider detailed settings (baseUrl, apiKey) for panel rendering
    const aiProviderDetails: ProviderDetail[] = slots.map((slot: { provider: string; model?: string }) => {
      const base: ProviderDetail = {
        provider: slot.provider,
        model: slot.model,
        label: slot.provider,
      };
      switch (slot.provider) {
        case 'gemini':
          base.model = settings[StorageKeys.GEMINI_MODEL] ?? slot.model;
          base.apiKey = stringOrEmpty(settings[StorageKeys.GEMINI_API_KEY]);
          break;
        case 'openai':
          base.baseUrl = settings[StorageKeys.OPENAI_BASE_URL] ?? '';
          base.model = settings[StorageKeys.OPENAI_MODEL] ?? slot.model;
          base.apiKey = stringOrEmpty(settings[StorageKeys.OPENAI_API_KEY]);
          break;
        case 'openai2':
          base.baseUrl = settings[StorageKeys.OPENAI_2_BASE_URL] ?? '';
          base.model = settings[StorageKeys.OPENAI_2_MODEL] ?? slot.model;
          base.apiKey = stringOrEmpty(settings[StorageKeys.OPENAI_2_API_KEY]);
          break;
        case 'lm-studio':
          base.baseUrl = settings[StorageKeys.LM_STUDIO_BASE_URL] ?? '';
          base.model = settings[StorageKeys.LM_STUDIO_MODEL] ?? slot.model;
          break;
        case 'ollama':
          base.baseUrl = settings[StorageKeys.OLLAMA_BASE_URL] ?? '';
          base.model = settings[StorageKeys.OLLAMA_MODEL] ?? slot.model;
          break;
        case 'openai-compatible':
          base.baseUrl = settings[StorageKeys.PROVIDER_BASE_URL] ?? '';
          base.model = settings[StorageKeys.PROVIDER_MODEL] ?? slot.model;
          base.apiKey = stringOrEmpty(settings[StorageKeys.PROVIDER_API_KEY]);
          break;
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
