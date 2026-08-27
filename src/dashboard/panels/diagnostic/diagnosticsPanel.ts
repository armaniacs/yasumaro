/**
 * diagnosticsPanel — render-only panel over DiagnosticsSnapshot.
 *
 * Data collection happens exclusively inside DiagnosticsCollector.collect().
 * This file renders each section from the snapshot and wires the interactive
 * handlers owned by diagnosticsActions. It must not import getSettings or
 * chrome.storage directly.
 */

import { getMessage } from '../../../utils/i18n.js';
import { PROVIDER_LABELS } from '../../../utils/aiProviderLabels.js';
import { makeStatRow, getSeverityLabel } from '../../diagnosticUtils.js';
import type { BuiltInAIAvailability } from '../../../background/builtInAIClient.js';
import type { BuiltInAiDiagnosticsResult } from '../../builtInAiDiagnosticsService.js';
import { type PanelLifecycle } from '../types.js';
import { diagnosticsCollector } from './DiagnosticsCollector.js';
import type { DiagnosticsSnapshot } from './DiagnosticsCollector.js';
import { getDebugMode, setDebugMode } from './debugModeStore.js';
import { createDiagnosticActions, type DiagnosticActionElements } from './diagnosticsActions.js';

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

interface SectionElements {
  storageStats: HTMLElement | null;
  extInfo: HTMLElement | null;
  obsidianSettingsEl: HTMLElement | null;
  aiSettingsEl: HTMLElement | null;
  connectionResult: HTMLElement | null;
  sqliteStats: HTMLElement | null;
  diagDeficiencyStats: HTMLElement | null;
  diagBuiltInAiStats: HTMLElement | null;
  diagBuiltInAiDownloadBtn: HTMLButtonElement | null;
  diagCompileOptionsStats: HTMLElement | null;
  diagDivergenceWarning: HTMLElement | null;
  diagMigrationStats: HTMLElement | null;
  compileOptionsSection: HTMLElement | null;
}

function querySections(container: HTMLElement): SectionElements {
  return {
    storageStats: container.querySelector('#diagStorageStats') as HTMLElement | null,
    extInfo: container.querySelector('#diagExtInfo') as HTMLElement | null,
    obsidianSettingsEl: container.querySelector('#diagObsidianSettings') as HTMLElement | null,
    aiSettingsEl: container.querySelector('#diagAiSettings') as HTMLElement | null,
    connectionResult: container.querySelector('#diagConnectionResult') as HTMLElement | null,
    sqliteStats: container.querySelector('#diagSqliteStats') as HTMLElement | null,
    diagDeficiencyStats: container.querySelector('#diagDeficiencyStats') as HTMLElement | null,
    diagBuiltInAiStats: container.querySelector('#diagBuiltInAiStats') as HTMLElement | null,
    diagBuiltInAiDownloadBtn: container.querySelector('#diagBuiltInAiDownloadBtn') as HTMLButtonElement | null,
    diagCompileOptionsStats: container.querySelector('#diagCompileOptionsStats') as HTMLElement | null,
    diagDivergenceWarning: container.querySelector('#diagDivergenceWarning') as HTMLElement | null,
    diagMigrationStats: container.querySelector('#diagMigrationStats') as HTMLElement | null,
    compileOptionsSection: container.querySelector('#diagCompileOptionsSection') as HTMLElement | null,
  };
}

function clearSections(s: SectionElements): void {
  s.storageStats?.replaceChildren();
  s.extInfo?.replaceChildren();
  s.obsidianSettingsEl?.replaceChildren();
  s.aiSettingsEl?.replaceChildren();
  if (s.sqliteStats) {
    s.sqliteStats.replaceChildren();
    s.sqliteStats.textContent = getMessage('diagSqliteChecking') || 'Checking SQLite status...';
  }
  s.diagDeficiencyStats?.replaceChildren();
  s.diagBuiltInAiStats?.replaceChildren();
  s.diagBuiltInAiDownloadBtn?.classList.add('hidden');
  s.diagCompileOptionsStats?.replaceChildren();
  s.diagDivergenceWarning?.classList.add('hidden');
  s.diagMigrationStats?.replaceChildren();
}

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

/** Providers that render per-provider setting rows in the AI section (matches the legacy if-chain). */
const KNOWN_DETAIL_PROVIDERS = new Set(['gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible']);

function renderAiSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el || snap.settingsLoadFailed) return;

  const providerLabels: Record<string, string> = PROVIDER_LABELS;
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
    const label = providerLabels[d.provider] || d.provider;
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

function renderMigrationSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;

  if (!snap.sqlite) {
    el.textContent = getMessage('diagSqliteCheckFailed') || 'Failed to check migration status.';
    return;
  }

  const opfsDone = snap.sqlite.opfsMigrationV2Done ?? false;
  const idbDone = snap.sqlite.idbMigrationV2Done ?? false;
  const allDone = opfsDone && idbDone;

  const overallLabel = getMessage('diagMigrationOverall') || 'Legacy DB Migration';
  const overallValue = allDone
    ? (getMessage('diagMigrationCompleted') || 'Completed')
    : (getMessage('diagMigrationNotCompleted') || 'Not completed (includes fresh installs)');
  el.appendChild(makeStatRow(overallLabel, overallValue, !allDone));

  const opfsLabel = getMessage('diagMigrationOpfsPath') || 'OPFS path';
  const idbLabel = getMessage('diagMigrationIdbPath') || 'IDB path';
  const doneSuffix = getMessage('diagMigrationDoneSuffix') || 'Done';
  const pendingSuffix = getMessage('diagMigrationPendingSuffix') || 'Pending';
  el.appendChild(makeStatRow(opfsLabel, opfsDone ? doneSuffix : pendingSuffix, !opfsDone));
  el.appendChild(makeStatRow(idbLabel, idbDone ? doneSuffix : pendingSuffix, !idbDone));
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

    const sections = querySections(container);
    // Clear first so the sqlite "Checking..." placeholder is visible during
    // collect()'s retrying status fetch (legacy UX), not just after it.
    clearSections(sections);
    const snapshot = await diagnosticsCollector.collect();

    sections.compileOptionsSection?.classList.toggle('hidden', !snapshot.debugMode);

    renderObsidianSection(sections.obsidianSettingsEl, snapshot);
    renderAiSection(sections.aiSettingsEl, snapshot);

    if (sections.storageStats) {
      sections.storageStats.appendChild(makeStatRow(getMessage('diagStorageUsed') || 'Storage Used', `${snapshot.storage.bytesUsedKb} KB`));
      sections.storageStats.appendChild(makeStatRow(getMessage('diagSavedUrls') || 'Saved URLs', snapshot.storage.savedUrls));
    }

    renderSqliteSection(sections.sqliteStats, snapshot);
    renderMigrationSection(sections.diagMigrationStats, snapshot);

    if (sections.diagDeficiencyStats && snapshot.sqlite) {
      const deficiencies = snapshot.deficiencies;
      if (deficiencies.length === 0) {
        sections.diagDeficiencyStats.appendChild(makeStatRow(getMessage('diagDeficiencyNone') || 'No deficiencies — all features are enabled.', '✓'));
      } else {
        for (const item of deficiencies) {
          const severityLabel = getSeverityLabel(item.severity);
          const summaryText = getMessage(item.summaryKey) || item.id;
          sections.diagDeficiencyStats.appendChild(makeStatRow(`${summaryText} [${severityLabel}]`, getMessage(item.recommendedActionKey) || ''));
        }
      }
    }

    if (sections.diagBuiltInAiStats && snapshot.builtInAi) {
      renderBuiltInAiStatus(sections.diagBuiltInAiStats, sections.diagBuiltInAiDownloadBtn, snapshot.builtInAi);
    }

    renderCompileOptions(sections.diagCompileOptionsStats, snapshot);

    // Divergence warning: offscreen fell back while the dashboard still sees OPFS
    if (sections.diagDivergenceWarning
        && snapshot.divergence.offscreenUsesFallback
        && snapshot.divergence.dashboardDetectsOpfs) {
      sections.diagDivergenceWarning.classList.remove('hidden');
    }

    if (sections.extInfo) {
      sections.extInfo.appendChild(makeStatRow(getMessage('diagVersion') || 'Version', snapshot.extInfo.version));
      sections.extInfo.appendChild(makeStatRow(getMessage('diagExtName') || 'Extension', snapshot.extInfo.name));
    }

    if (sections.connectionResult) {
      sections.connectionResult.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
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

      const sections = querySections(container);

      const actionEls: DiagnosticActionElements = {
        testObsidianBtn: container.querySelector('#diagTestObsidianBtn'),
        testAiBtn: container.querySelector('#diagTestAiBtn'),
        testSqliteBtn: container.querySelector('#diagTestSqliteBtn'),
        opfsSpikeBtn: container.querySelector('#diagOpfsSpikeBtn'),
        migrateBtn: container.querySelector('#diagMigrateBtn'),
        backfillBtn: container.querySelector('#diagBackfillBtn'),
        cleanupBtn: container.querySelector('#diagCleanupBtn'),
        builtInAiDownloadBtn: sections.diagBuiltInAiDownloadBtn,
        connectionResult: sections.connectionResult,
        sqliteResult: container.querySelector('#diagSqliteResult'),
        opfsSpikeResult: container.querySelector('#diagOpfsSpikeResult'),
        migrateResult: container.querySelector('#diagMigrateResult'),
        backfillResult: container.querySelector('#diagBackfillResult'),
        cleanupResult: container.querySelector('#diagCleanupResult'),
        builtInAiStats: sections.diagBuiltInAiStats,
        builtInAiDownloadResult: container.querySelector('#diagBuiltInAiDownloadResult'),
      };
      createDiagnosticActions(actionEls, {
        onBuiltInAiDownloaded: (result) => {
          if (sections.diagBuiltInAiStats) {
            renderBuiltInAiStatus(sections.diagBuiltInAiStats, sections.diagBuiltInAiDownloadBtn, result);
          }
        },
      });
    },
    async load() {
      await loadAndPopulate();
    },
    destroy() {
      _container = null;
    },
  };
}
