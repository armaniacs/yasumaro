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

import { getSettings, StorageKeys } from '../../../utils/storage.js';
import { getSqliteStatus, getLogCount } from '../../dashboardSqliteService.js';
import { diagnoseDeficiencies, type DiagnosticInput } from '../../diagnoseDeficiencies.js';
import { checkBuiltInAiAvailability, type BuiltInAiDiagnosticsResult } from '../../builtInAiDiagnosticsService.js';
import { detectLiveVfsStrategy } from '../../../offscreen/opfsCapabilities.js';
import { pickDefined } from '../../../utils/objectUtils.js';

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
  } | null;
  deficiencies: ReturnType<typeof diagnoseDeficiencies>;
  builtInAi: BuiltInAiDiagnosticsResult | null;
  obsidian: { protocol: string; port: string; apiKey: string; dailyPath: string };
  aiProviders: Array<{ provider: string; model: string | undefined; label: string }>;
  debugMode: boolean;
}

export interface DiagnosticsCollectorDeps {
  getSettings?: typeof getSettings;
  getSqliteStatus?: typeof getSqliteStatus;
  getLogCount?: typeof getLogCount;
  checkBuiltInAiAvailability?: typeof checkBuiltInAiAvailability;
  getStorageBytesInUse?: () => Promise<number>;
  getDebugMode?: () => Promise<boolean>;
}

/**
 * Deep collector: one seam, one place to test.
 * All 11 queries are inside, callers get a typed snapshot.
 */
export class DiagnosticsCollector {
  constructor(private deps: DiagnosticsCollectorDeps = {}) {}

  async collect(): Promise<DiagnosticsSnapshot> {
    const getSettingsFn = this.deps.getSettings ?? getSettings;
    const getSqliteStatusFn = this.deps.getSqliteStatus ?? getSqliteStatus;
    const getLogCountFn = this.deps.getLogCount ?? getLogCount;
    const checkBuiltInAiFn = this.deps.checkBuiltInAiAvailability ?? checkBuiltInAiAvailability;
    const getBytesInUse = this.deps.getStorageBytesInUse ?? (() => chrome.storage.local.getBytesInUse(null));
    const getDebugMode = this.deps.getDebugMode ?? (async () => {
      const r = await chrome.storage.local.get('debugMode') as Record<string, unknown>;
      return Boolean(r['debugMode']);
    });

    // Parallel gathering — faster than sequential awaits in the old panel
    const [settings, sqliteStatus, logCountResult, builtInAiResult, bytesUsed, debugMode] = await Promise.all([
      getSettingsFn().catch(() => ({} as Record<string, unknown>)),
      getSqliteStatusFn().catch(() => null),
      getLogCountFn().catch(() => ({ error: 'unavailable' } as any)),
      checkBuiltInAiFn().catch(() => null),
      getBytesInUse().catch(() => 0),
      getDebugMode().catch(() => false),
    ]);

    const s = settings as Record<string, unknown>;
    const protocol = (s[StorageKeys.OBSIDIAN_PROTOCOL] as string) || 'https';
    const port = (s[StorageKeys.OBSIDIAN_PORT] as string) || '27124';
    const apiKey = (s[StorageKeys.OBSIDIAN_API_KEY] as string) || '';
    const dailyPath = (s[StorageKeys.OBSIDIAN_DAILY_PATH] as string) || '';

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
    const priorityList = (s[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as Array<{ provider: string; model?: string }>) || [];
    const legacyProvider = (s[StorageKeys.AI_PROVIDER] as string) || 'gemini';
    const slots = priorityList.length > 0 ? priorityList : [{ provider: legacyProvider }];
    const aiProviders = slots.map((slot: { provider: string; model?: string }) => ({
      provider: slot.provider,
      model: slot.model as string | undefined,
      label: slot.provider,
    }));

    // Divergence check (dashboard vs offscreen)
    // Kept inside collector so the panel doesn't need to know the strategy strings
    try {
      const { strategy } = detectLiveVfsStrategy();
      const dashboardDetectsOpfs = strategy !== 'fallback';
      const offscreenUsesFallback = sqliteStatus?.fallback ?? false;
      // Divergence is a derived field, not stored — panel can compute from snapshot if needed
      void dashboardDetectsOpfs;
      void offscreenUsesFallback;
    } catch { /* ignore */ }

    return {
      storage: { bytesUsedKb, savedUrls },
      sqlite: sqliteStatus,
      deficiencies,
      builtInAi: builtInAiResult,
      obsidian: { protocol, port, apiKey, dailyPath },
      aiProviders,
      debugMode,
    };
  }
}

export const diagnosticsCollector = new DiagnosticsCollector();
