/**
 * diagnosticsPanel — render-only panel over DiagnosticsSnapshot.
 *
 * Data collection happens exclusively inside DiagnosticsCollector.collect().
 * This file renders each section from the snapshot and wires the interactive
 * handlers owned by diagnosticsActions. It must not import getSettings or
 * chrome.storage directly.
 */

import { getMessage } from '../../../utils/i18n.js';
import { makeStatRow, getSeverityLabel } from '../../diagnosticUtils.js';
import type { BuiltInAIAvailability } from '../../../background/builtInAIClient.js';
import type { BuiltInAiDiagnosticsResult } from '../../builtInAiDiagnosticsService.js';
import { type PanelLifecycle } from '../types.js';
import { diagnosticsCollector } from './DiagnosticsCollector.js';
import type { DiagnosticsSnapshot } from './DiagnosticsCollector.js';
import { getDebugMode, setDebugMode } from './debugModeStore.js';
import { createDiagnosticActions, type DiagnosticActionElements } from './diagnosticsActions.js';
import { PROVIDER_CATALOG } from '../../../background/ai/providerCatalog.js';
import { registerReportBugButton } from './issueReportEntry.js';

/**
 * Renders the built-in AI availability row and toggles the download button.
 * Shared by initial load and the post-download refresh so both paths stay in sync.
 */
export function renderBuiltInAiStatus(
  statsEl: HTMLElement,
  downloadBtn: HTMLButtonElement | null,
  result: BuiltInAiDiagnosticsResult
): void {
  statsEl.innerHTML = '';

  const statusLabels: Record<BuiltInAIAvailability, string> = {
    available: getMessage('diagBuiltInAiAvailable') || 'Available',
    downloadable: getMessage('diagBuiltInAiDownloadable') || 'Model download required',
    downloading: getMessage('diagBuiltInAiDownloading') || 'Downloading...',
    unavailable: getMessage('diagBuiltInAiUnavailable') || 'Unavailable',
  };

  statsEl.appendChild(makeStatRow(
    getMessage('diagBuiltInAiStatus') || 'Status',
    statusLabels[result.status],
    result.status === 'unavailable'
  ));

  if (result.status === 'unavailable' && result.guidance) {
    const guidanceText = getMessage('diagBuiltInAiFlagGuidance', { flagName: result.guidance.flagName, flagUrl: result.guidance.url })
      || `Enable "${result.guidance.flagName}" at ${result.guidance.url}`;
    statsEl.appendChild(makeStatRow(getMessage('diagBuiltInAiGuidanceLabel') || 'Guidance', guidanceText));
  } else if (result.status === 'unavailable') {
    statsEl.appendChild(makeStatRow(
      getMessage('diagBuiltInAiGuidanceLabel') || 'Guidance',
      getMessage('diagBuiltInAiUnsupportedBrowser') || 'This browser does not support built-in AI.'
    ));
  }

  if (downloadBtn) {
    downloadBtn.classList.toggle('hidden', result.status !== 'downloadable');
  }
}

/**
 * Section table (PBI 2026-09-15-06): adding a diagnostic item is one row here
 * plus its render function — query/clear/render lifecycles all run from this
 * table, replacing the hand-written querySections/clearSections switches and
 * the inline render calls in loadAndPopulate.
 */
interface DiagSection {
  selector: string;
  clear(el: HTMLElement | null): void;
  render(el: HTMLElement | null, snap: DiagnosticsSnapshot): void;
}

const clearChildren = (el: HTMLElement | null): void => {
  el?.replaceChildren();
};

const SECTIONS: DiagSection[] = [
  {
    selector: '#diagStorageStats',
    clear: clearChildren,
    render(el, snap) {
      if (!el) return;
      el.appendChild(makeStatRow(getMessage('diagStorageUsed') || 'Storage Used', `${snap.storage.bytesUsedKb} KB`));
      el.appendChild(makeStatRow(getMessage('diagSavedUrls') || 'Saved URLs', snap.storage.savedUrls));
    },
  },
  {
    selector: '#diagExtInfo',
    clear: clearChildren,
    render(el, snap) {
      if (!el) return;
      el.appendChild(makeStatRow(getMessage('diagVersion') || 'Version', snap.extInfo.version));
      el.appendChild(makeStatRow(getMessage('diagExtName') || 'Extension', snap.extInfo.name));
    },
  },
  {
    selector: '#diagObsidianSettings',
    clear: clearChildren,
    render: (el, snap) => renderObsidianSection(el, snap),
  },
  {
    selector: '#diagAiSettings',
    clear: clearChildren,
    render: (el, snap) => renderAiSection(el, snap),
  },
  {
    selector: '#diagConnectionResult',
    clear: () => undefined,
    render(el) {
      if (el) el.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
    },
  },
  {
    selector: '#diagSqliteStats',
    // Clear first so the sqlite "Checking..." placeholder is visible during
    // collect()'s retrying status fetch (legacy UX), not just after it.
    clear(el) {
      clearChildren(el);
      if (el) el.textContent = getMessage('diagSqliteChecking') || 'Checking SQLite status...';
    },
    render: (el, snap) => renderSqliteSection(el, snap),
  },
  {
    selector: '#diagDeficiencyStats',
    clear: clearChildren,
    render(el, snap) {
      if (!el || !snap.sqlite) return;
      const deficiencies = snap.deficiencies;
      if (deficiencies.length === 0) {
        el.appendChild(makeStatRow(getMessage('diagDeficiencyNone') || 'No deficiencies — all features are enabled.', '✓'));
        return;
      }
      for (const item of deficiencies) {
        const severityLabel = getSeverityLabel(item.severity);
        const summaryText = getMessage(item.summaryKey) || item.id;
        el.appendChild(makeStatRow(`${summaryText} [${severityLabel}]`, getMessage(item.recommendedActionKey) || ''));
      }
    },
  },
  {
    selector: '#diagBuiltInAiStats',
    clear(el) {
      clearChildren(el);
      document.getElementById('diagBuiltInAiDownloadBtn')?.classList.add('hidden');
    },
    render(el, snap) {
      const stats = el as HTMLElement | null;
      const downloadBtn = document.getElementById('diagBuiltInAiDownloadBtn') as HTMLButtonElement | null;
      if (stats && snap.builtInAi) {
        renderBuiltInAiStatus(stats, downloadBtn, snap.builtInAi);
      }
    },
  },
  {
    selector: '#diagCompileOptionsStats',
    clear: clearChildren,
    render(el, snap) {
      el?.classList.toggle('hidden', !snap.debugMode);
      renderCompileOptions(el, snap);
    },
  },
  {
    selector: '#diagDivergenceWarning',
    // Divergence warning: offscreen fell back while the dashboard still sees OPFS
    clear(el) {
      el?.classList.add('hidden');
    },
    render(el, snap) {
      if (el && snap.divergence.offscreenUsesFallback && snap.divergence.dashboardDetectsOpfs) {
        el.classList.remove('hidden');
      }
    },
  },
  {
    selector: '#diagMigrationStats',
    clear: clearChildren,
     render: (el, snap) => renderMigrationSection(el, snap),
   },
];

function renderObsidianSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;

  if (snap.settingsLoadFailed) {
    el.textContent = getMessage('diagLoadError') || '設定の読み込みに失敗しました。';
    return;
  }

  const configuredLabel = getMessage('configured') || '(configured)';
  const notSetLabel = getMessage('notSet') || '(not set)';
  const o = snap.obsidian;

  el.appendChild(makeStatRow(getMessage('diagProtocol') || 'Protocol', o.protocol));
  el.appendChild(makeStatRow(getMessage('diagPort') || 'Port', o.port));
  el.appendChild(makeStatRow(getMessage('diagRestUrl') || 'REST API URL', `${o.protocol}://127.0.0.1:${o.port}`));
  el.appendChild(makeStatRow(getMessage('diagDailyPath') || 'Daily Note Path', o.dailyPath || (getMessage('defaultValue') || '(default)')));
  el.appendChild(makeStatRow(getMessage('diagApiKey') || 'API Key', o.apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !o.apiKey));
}

/**
 * Providers that render per-provider setting rows in the AI section — those
 * with at least one configurable field. built-in-ai (modelKey '', no baseUrl/
 * apiKey) renders the header row only, matching the legacy if-chain.
 */
const KNOWN_DETAIL_PROVIDERS = new Set<string>(
  [...PROVIDER_CATALOG.entries()]
    .filter(([, e]) => Boolean(e.modelKey || e.baseUrlKey || e.apiKeyKey))
    .map(([id]) => id),
);

function renderAiSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el || snap.settingsLoadFailed) return;

  const configuredLabel = getMessage('configured') || '(configured)';
  const notSetLabel = getMessage('notSet') || '(not set)';
  const details = snap.aiProviderDetails;

  if (details.length > 1) {
    el.appendChild(makeStatRow(
      getMessage('diagProvider') || 'Provider',
      `${details.length} providers (priority order)`
    ));
  }

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    if (!d) continue;
    const label = d.label || d.provider;
    const priorityLabel = details.length > 1 ? `#${i + 1} ` : '';
    const modelOverride = d.model ? ` [${d.model}]` : '';

    const providerGroup = document.createElement('div');
    providerGroup.className = details.length > 1 ? 'diag-provider-group' : '';

    providerGroup.appendChild(makeStatRow(`${priorityLabel}Provider`, `${label}${modelOverride}`));

    // Unknown providers render the header row only (legacy if-chain behavior).
    if (!KNOWN_DETAIL_PROVIDERS.has(d.provider)) {
      el.appendChild(providerGroup);
      continue;
    }

    const hasApiKey = d.apiKey !== undefined;
    if (hasApiKey && d.baseUrl !== undefined) {
      providerGroup.appendChild(makeStatRow('  Base URL', d.baseUrl || notSetLabel));
      providerGroup.appendChild(makeStatRow('  Model', d.model || notSetLabel));
      providerGroup.appendChild(makeStatRow('  API Key', d.apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !d.apiKey));
    } else if (d.baseUrl !== undefined) {
      providerGroup.appendChild(makeStatRow('  Base URL', d.baseUrl || notSetLabel));
      providerGroup.appendChild(makeStatRow('  Model', d.model || notSetLabel));
    } else {
      // gemini: model + API key only
      providerGroup.appendChild(makeStatRow('  Model', d.model || notSetLabel));
      providerGroup.appendChild(makeStatRow('  API Key', d.apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !d.apiKey));
    }

    el.appendChild(providerGroup);
  }
}

function renderSqliteSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;

  el.replaceChildren();

  const st = snap.sqlite;
  if (!st) {
    el.textContent = getMessage('diagSqliteCheckFailed') || 'Failed to check SQLite status.';
    return;
  }

  const initializedText = st.initialized
    ? (getMessage('diagSqliteAvailable') || 'Available')
    : (getMessage('diagSqliteUnavailable') || 'Unavailable');
  el.appendChild(makeStatRow(getMessage('diagSqliteStatus') || 'Status', initializedText));
  el.appendChild(makeStatRow(getMessage('diagSqlitePath') || 'Path', st.path || '(none)'));
  const fallbackText = st.fallback
    ? (getMessage('diagSqliteFallbackYes') || 'Yes (using fallback storage)')
    : (getMessage('diagSqliteFallbackNo') || 'No (native SQLite)');
  el.appendChild(makeStatRow(getMessage('diagSqliteFallback') || 'Fallback Mode', fallbackText));
  el.appendChild(makeStatRow(getMessage('diagSqliteFts5') || 'FTS5 Search', st.fts5 ? '✓ Available' : '✗ Not available (LIKE fallback)'));

  if (st.compileOptionsSource) {
    el.appendChild(makeStatRow(getMessage('diagCompileOptionsSource') || 'Source', st.compileOptionsSource));
  }
  if (st.initError) {
    el.appendChild(makeStatRow('Init Error', st.initError));
  }
}

// Legacy-path names come from the shared STATUS contract (PBI 2026-09-11-06) —
// labels only, but sourced from the SSOT instead of inlined literals.
import { LEGACY_OPFS_POOL_DIR, LEGACY_OPFS_DB_FILENAME, LEGACY_IDB_NAME } from '../../../messaging/sqliteMessages.js';

const OPFS_DB_FILE = `${LEGACY_OPFS_DB_FILENAME} (OPFS)`;
const IDB_DB_NAME = `${LEGACY_OPFS_DB_FILENAME} (IndexedDB)`;
const FALLBACK_STORAGE_NAME = 'chrome.storage.local';

function getCurrentEngineLabel(snap: DiagnosticsSnapshot): string {
  const st = snap.sqlite;
  if (!st) return getMessage('diagMigrationEngineUnknown') || 'Unknown';
  if (st.fallback) return `${getMessage('diagMigrationEngineFallback') || 'Fallback (chrome.storage)'} — ${FALLBACK_STORAGE_NAME}`;
  const isOpfs = st.compileOptionsSource === 'opfs-worker' || st.path.startsWith('OPFS:');
  if (isOpfs) return `${getMessage('diagMigrationEngineOpfs') || 'OPFS'} (${getMessage('diagMigrationRecommended') || 'recommended'}) — ${OPFS_DB_FILE}`;
  if (st.compileOptionsSource === 'idb') return `${getMessage('diagMigrationEngineIdb') || 'IndexedDB'} — ${IDB_DB_NAME}`;
  return getMessage('diagMigrationEngineUnknown') || 'Unknown';
}

/** Hints are keyed so the renderer can map each to its own DOM element without re-deriving conditions. */
export type MigrationHintKind = 'noAbsolutePath' | 'idbExplanation' | 'opfsCheckingStale' | 'legacyStillPresent';

/**
 * Display bucket for the migration status — the precedence
 * (done > notApplicable > checking > pending) is resolved exactly once here
 * in deriveMigrationStatus; the renderer only maps this to a label and never
 * re-derives the precedence.
 *
 * IDB never takes 'checking': OPFS can detect "the migration routine has not
 * run yet" via LAST_ATTEMPTED_AT / RECORD_COUNT, but the IDB side has no
 * corresponding measured fields (see sqliteStatus.ts extras).
 */
export type MigrationDisplayState = 'done' | 'notApplicable' | 'checking' | 'pending';

export interface MigrationOpfsStatus {
  done: boolean;
  notApplicable: boolean;
  checking: boolean;
  warn: boolean;
  displayState: MigrationDisplayState;
  /**
   * Migration routine finished but the live probe still detects the legacy file.
   * Possible failed/skipped legacy cleanup causing double disk usage. Independent of done.
   */
  legacyStillPresent: boolean;
  legacyPath: string | null | undefined;
  lastAttemptedAt: string | null | undefined;
  completedAt: string | null | undefined;
  recordCount: number | null | undefined;
}

export interface MigrationIdbStatus {
  done: boolean;
  notApplicable: boolean;
  warn: boolean;
  /** IDB never takes 'checking' (see MigrationDisplayState). */
  displayState: Exclude<MigrationDisplayState, 'checking'>;
  /**
   * Migration routine finished but the live probe still detects the legacy DB.
   * Possible failed/skipped legacy cleanup causing double disk usage. Independent of done.
   */
  legacyStillPresent: boolean;
  legacyName: string | null | undefined;
}

export interface MigrationStatus {
  overall: {
    allDone: boolean;
    checking: boolean;
    warn: boolean;
  };
  opfs: MigrationOpfsStatus;
  idb: MigrationIdbStatus;
  hints: MigrationHintKind[];
}

/**
 * Pure domain judgment for the legacy-DB migration status — no DOM, no i18n.
 * Kept separate from renderMigrationSection so the branching below (done vs.
 * not-applicable vs. checking vs. pending/warn) is unit-testable without jsdom.
 */
export function deriveMigrationStatus(sqlite: DiagnosticsSnapshot['sqlite']): MigrationStatus {
  const opfsDone = sqlite?.opfsMigrationV2Done ?? false;
  const idbDone = sqlite?.idbMigrationV2Done ?? false;

  // The live existence check (opfsLegacyDbPath / idbLegacyDbName) is the
  // ground truth for "is there anything to migrate at all" — it is queried
  // fresh on every diagnostics load, unlike the Done flags below which only
  // update once the migration routine actually runs. When the legacy source
  // is confirmed absent, "not done" cannot mean "failed"; it can only mean
  // "the flag hasn't caught up yet" or "nothing was ever there to migrate" —
  // either way, not a warning-worthy state.
  const opfsLegacyPath = sqlite?.opfsLegacyDbPath;
  const idbLegacyName = sqlite?.idbLegacyDbName;
  const opfsNotApplicable = !opfsDone && opfsLegacyPath === null;
  const idbNotApplicable = !idbDone && idbLegacyName === null;
  const opfsLegacyStillPresent = opfsDone && opfsLegacyPath != null;
  const idbLegacyStillPresent = idbDone && idbLegacyName != null;
  const allDone = (opfsDone || opfsNotApplicable) && (idbDone || idbNotApplicable);

  // OPFS side additionally sets LAST_ATTEMPTED_AT before the migration runs
  // and RECORD_COUNT after it finishes; their absence — with a legacy DB that
  // DOES exist — means the migration routine hasn't executed yet (offscreen
  // not initialized), distinct from "ran but not done" (a real failure state).
  const opfsAttempted = sqlite?.opfsMigrationV2LastAttemptedAt != null
    || sqlite?.opfsMigrationV2CompletedAt != null
    || sqlite?.opfsMigrationV2RecordCount != null;
  const opfsChecking = !opfsDone && !opfsNotApplicable && !opfsAttempted;
  const opfsWarn = !opfsDone && !opfsNotApplicable && !opfsChecking;
  const idbWarn = !idbDone && !idbNotApplicable;

  const hints: MigrationHintKind[] = ['noAbsolutePath', 'idbExplanation'];
  if (opfsChecking) {
    hints.push('opfsCheckingStale');
  }
  if (opfsLegacyStillPresent || idbLegacyStillPresent) {
    hints.push('legacyStillPresent');
  }

  // Same precedence the renderer used to re-derive from the individual bools
  // (done > notApplicable > checking > pending) — kept identical so the panel
  // renders byte-for-byte the same output.
  const opfsDisplayState: MigrationDisplayState = opfsDone
    ? 'done'
    : opfsNotApplicable
      ? 'notApplicable'
      : opfsChecking
        ? 'checking'
        : 'pending';
  const idbDisplayState: Exclude<MigrationDisplayState, 'checking'> = idbDone
    ? 'done'
    : idbNotApplicable
      ? 'notApplicable'
      : 'pending';

  return {
    overall: {
      allDone,
      checking: opfsChecking,
      warn: !allDone && !opfsChecking,
    },
    opfs: {
      done: opfsDone,
      notApplicable: opfsNotApplicable,
      checking: opfsChecking,
      warn: opfsWarn,
      displayState: opfsDisplayState,
      legacyStillPresent: opfsLegacyStillPresent,
      legacyPath: opfsLegacyPath,
      lastAttemptedAt: sqlite?.opfsMigrationV2LastAttemptedAt,
      completedAt: sqlite?.opfsMigrationV2CompletedAt,
      recordCount: sqlite?.opfsMigrationV2RecordCount,
    },
    idb: {
      done: idbDone,
      notApplicable: idbNotApplicable,
      warn: idbWarn,
      displayState: idbDisplayState,
      legacyStillPresent: idbLegacyStillPresent,
      legacyName: idbLegacyName,
    },
    hints,
  };
}

function renderMigrationSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;

  if (!snap.sqlite) {
    el.textContent = getMessage('diagSqliteCheckFailed') || 'Failed to check migration status.';
    return;
  }

  el.appendChild(makeStatRow(getMessage('diagMigrationCurrentEngine') || 'Current engine', getCurrentEngineLabel(snap)));
  el.appendChild(makeStatRow(getMessage('diagMigrationRecordCount') || 'Saved record count', snap.storage.savedUrls));
  el.appendChild(makeStatRow(getMessage('diagMigrationStorageUsed') || 'Storage used (whole extension)', `${snap.storage.bytesUsedKb} KB`));

  const status = deriveMigrationStatus(snap.sqlite);
  const { overall, opfs, idb } = status;

  const doneSuffix = getMessage('diagMigrationDoneSuffix') || 'Done';
  const pendingSuffix = getMessage('diagMigrationPendingSuffix') || 'Pending';
  const checkingSuffix = getMessage('diagMigrationCheckingSuffix') || 'Checking...';
  const notApplicableSuffix = getMessage('diagMigrationNotApplicableSuffix') || 'Not applicable (no legacy data)';

  const overallLabel = getMessage('diagMigrationOverall') || 'Legacy DB Migration';
  const overallValue = overall.allDone
    ? (getMessage('diagMigrationCompleted') || 'Completed')
    : overall.checking
      ? checkingSuffix
      : (getMessage('diagMigrationNotCompleted') || 'Not completed (includes fresh installs)');
  el.appendChild(makeStatRow(overallLabel, overallValue, overall.warn));

  const opfsLabel = `${getMessage('diagMigrationOpfsPath') || 'OPFS path'} (${LEGACY_OPFS_POOL_DIR}/${LEGACY_OPFS_DB_FILENAME})`;
  const idbLabel = `${getMessage('diagMigrationIdbPath') || 'IDB path'} (${LEGACY_IDB_NAME})`;
  const suffixByState: Record<MigrationDisplayState, string> = {
    done: doneSuffix,
    notApplicable: notApplicableSuffix,
    checking: checkingSuffix,
    pending: pendingSuffix,
  };
  const opfsValue = suffixByState[opfs.displayState];
  const idbValue = suffixByState[idb.displayState];
  el.appendChild(makeStatRow(opfsLabel, opfsValue, opfs.warn));
  el.appendChild(makeStatRow(idbLabel, idbValue, idb.warn));

  // Live existence check of the pre-migration source, not just the done flags —
  // this is what actually answers "where is the old database and is it still there?"
  el.appendChild(makeStatRow(
    getMessage('diagMigrationOpfsLegacyFound') || 'OPFS legacy DB detected',
    opfs.legacyPath
      ? `${getMessage('diagMigrationYes') || 'Yes'} — origin-private:/${opfs.legacyPath}`
      : (getMessage('diagMigrationNo') || 'No (nothing to migrate)')
  ));
  el.appendChild(makeStatRow(
    getMessage('diagMigrationIdbLegacyFound') || 'IDB legacy DB detected',
    idb.legacyName
      ? `${getMessage('diagMigrationYes') || 'Yes'} — indexeddb://${location.origin}/${idb.legacyName}`
      : (getMessage('diagMigrationNo') || 'No (nothing to migrate)')
  ));

  if (status.hints.includes('noAbsolutePath')) {
    const noAbsolutePathNote = document.createElement('p');
    noAbsolutePathNote.className = 'help-text';
    noAbsolutePathNote.textContent = getMessage('diagMigrationNoAbsolutePath')
      || 'Neither OPFS nor IndexedDB exposes an OS-level absolute file path via any Web API — this is a browser sandbox restriction, not a limitation of this extension.';
    el.appendChild(noAbsolutePathNote);
  }

  if (status.hints.includes('idbExplanation')) {
    const idbExplanation = document.createElement('p');
    idbExplanation.className = 'help-text';
    idbExplanation.textContent = getMessage('diagMigrationIdbExplanation')
      || 'The IndexedDB path is a fallback used when OPFS is unavailable.';
    el.appendChild(idbExplanation);
  }

  // Surface the raw fields already collected but previously unused, so a
  // "pending" status is never a dead end — the reader can see when the last
  // attempt ran and how many records it actually migrated.
  if (opfs.lastAttemptedAt) {
    el.appendChild(makeStatRow(
      getMessage('diagMigrationOpfsLastAttempted') || 'OPFS last attempted',
      opfs.lastAttemptedAt
    ));
  }
  if (opfs.completedAt) {
    el.appendChild(makeStatRow(
      getMessage('diagMigrationOpfsCompletedAt') || 'OPFS completed at',
      opfs.completedAt
    ));
  }
  if (opfs.recordCount != null) {
    el.appendChild(makeStatRow(
      getMessage('diagMigrationOpfsRecordCount') || 'OPFS records migrated',
      String(opfs.recordCount)
    ));
  }

  // Data is clearly present (records/storage above are non-zero) yet the
  // migration routine has never recorded an attempt — most likely explanation
  // given the architecture: the OPFS Worker's chrome.storage.local write
  // silently no-ops if the Worker context lacks extension API access.
  if (status.hints.includes('opfsCheckingStale') && Number(snap.storage.savedUrls) > 0) {
    const staleChecking = document.createElement('p');
    staleChecking.className = 'help-text';
    staleChecking.textContent = getMessage('diagMigrationCheckingStaleHint')
      || 'If this stays "Checking..." even though data is already saved, the migration routine inside the OPFS Worker may not be able to write its status flag (chrome.storage.local can be inaccessible from a dedicated Worker context). This does not affect your saved data — reloading the extension may help; otherwise it can be treated as informational.';
    el.appendChild(staleChecking);
  }

  if (status.hints.includes('legacyStillPresent')) {
    const note = document.createElement('p');
    note.className = 'help-text';
    note.textContent = getMessage('diagMigrationLegacyStillPresent')
      || 'Migration is marked complete, but the legacy database file is still present. It is safe to keep, but it consumes storage — reloading the extension may trigger cleanup.';
    el.appendChild(note);
  }
}

function renderCompileOptions(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;
  const options = snap.sqlite?.compileOptions;
  if (!options || !snap.debugMode) return;

  const source = snap.sqlite?.compileOptionsSource || 'unknown';
  el.appendChild(makeStatRow(getMessage('diagCompileOptionsSource') || 'Source', source));
  el.appendChild(makeStatRow('Total', String(options.length)));

  const ftsVfsOptions = options.filter(o => o.includes('FTS') || o.includes('VFS'));
  if (ftsVfsOptions.length > 0) {
    el.appendChild(makeStatRow(getMessage('diagCompileOptionsHighlight') || 'FTS/VFS related', ftsVfsOptions.join(', ')));
  }

  const allOptionsDetails = document.createElement('details');
  allOptionsDetails.className = 'advanced-details';
  allOptionsDetails.innerHTML = `
    <summary class="advanced-details-summary">All ${options.length} options</summary>
    <div class="advanced-details-content">
      <pre class="diag-compile-options-list">${options.join('\n')}</pre>
    </div>
  `;
  el.appendChild(allOptionsDetails);
}

export function createDiagnosticsPanel(): PanelLifecycle {
  let _container: HTMLElement | null = null;

  async function loadAndPopulate(): Promise<void> {
    const container = _container;
    if (!container) return;

    // Clear first so the sqlite "Checking..." placeholder is visible during
    // collect()'s retrying status fetch (legacy UX), not just after it.
    for (const section of SECTIONS) {
      section.clear(container.querySelector(section.selector) as HTMLElement | null);
    }
    const snapshot = await diagnosticsCollector.collect();

    for (const section of SECTIONS) {
      section.render(container.querySelector(section.selector) as HTMLElement | null, snapshot);
    }
  }

  return {
    id: 'panel-diagnostics',
    category: 'diagnostic',
    async mount(container) {
      _container = container;

      const diagDebugModeToggle = container.querySelector('#diagDebugModeToggle') as HTMLInputElement | null;
      const compileOptionsSection = container.querySelector('#diagCompileOptionsSection') as HTMLElement | null;

      const debugMode = await getDebugMode();
      if (diagDebugModeToggle) {
        diagDebugModeToggle.checked = debugMode;
        diagDebugModeToggle.setAttribute('aria-checked', String(debugMode));
      }
      if (compileOptionsSection) {
        compileOptionsSection.style.display = debugMode ? '' : 'none';
      }

      diagDebugModeToggle?.addEventListener('change', async () => {
        const isOn = diagDebugModeToggle.checked;
        diagDebugModeToggle.setAttribute('aria-checked', String(isOn));
        await setDebugMode(isOn);
        if (compileOptionsSection) {
          compileOptionsSection.style.display = isOn ? '' : 'none';
        }
      });

      const actionEls: DiagnosticActionElements = {
        testObsidianBtn: container.querySelector('#diagTestObsidianBtn'),
        testAiBtn: container.querySelector('#diagTestAiBtn'),
        testSqliteBtn: container.querySelector('#diagTestSqliteBtn'),
        migrateBtn: container.querySelector('#diagMigrateBtn'),
        backfillBtn: container.querySelector('#diagBackfillBtn'),
        resyncBtn: container.querySelector('#diagResyncBtn'),
        cleanupBtn: container.querySelector('#diagCleanupBtn'),
        builtInAiDownloadBtn: container.querySelector('#diagBuiltInAiDownloadBtn'),
        connectionResult: container.querySelector('#diagConnectionResult'),
        sqliteResult: container.querySelector('#diagSqliteResult'),
        migrateResult: container.querySelector('#diagMigrateResult'),
        backfillResult: container.querySelector('#diagBackfillResult'),
        resyncResult: container.querySelector('#diagResyncResult'),
        cleanupResult: container.querySelector('#diagCleanupResult'),
        builtInAiStats: container.querySelector('#diagBuiltInAiStats'),
        builtInAiDownloadResult: container.querySelector('#diagBuiltInAiDownloadResult'),
      };
      createDiagnosticActions(actionEls, {
        onBuiltInAiDownloaded: (result) => {
          const stats = container.querySelector('#diagBuiltInAiStats') as HTMLElement | null;
          const downloadBtn = container.querySelector('#diagBuiltInAiDownloadBtn') as HTMLButtonElement | null;
          if (stats) {
            renderBuiltInAiStatus(stats, downloadBtn, result);
          }
        },
      });

      registerReportBugButton(
        container.querySelector('#diagReportBugBtn'),
      );
    },
    async load() {
      await loadAndPopulate();
    },
    destroy() {
      _container = null;
    },
  };
}
