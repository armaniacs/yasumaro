// ============================================================================
// Diagnostics Panel
// ============================================================================

import { getMessage } from '../popup/i18n.js';
import { getSettings, StorageKeys } from '../utils/storage.js';
import { getSavedUrlCount } from '../utils/storageUrls.js';
import { UI_COLORS } from '../constants/appConstants.js';
import { getSqliteStatus, runOpfsSpike, migrateLogs } from './dashboardSqliteService.js';
import { showConfirmDialog } from './utils/confirmDialog.js';
import { diagnoseDeficiencies, type DiagnosticInput, type DeficiencyItem } from './diagnoseDeficiencies.js';
import { detectLiveVfsStrategy } from '../offscreen/opfsCapabilities.js';

/**
 * Creates a stat row element for the diagnostics panel
 * @param label - The label text for the stat
 * @param value - The value text for the stat
 * @param masked - Whether the value should be displayed as masked (for sensitive info)
 * @returns HTMLElement - The created stat row div
 */
function makeStatRow(label: string, value: string, masked = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'diag-stat-row';
  const valueHtml = masked
    ? `<span class="diag-stat-value diag-stat-masked">${value}</span>`
    : `<span class="diag-stat-value">${value}</span>`;
  row.innerHTML = `<span class="diag-stat-label">${label}</span>${valueHtml}`;
  return row;
}

/**
 * Returns the localized severity label for a deficiency severity level.
 */
function getSeverityLabel(severity: DeficiencyItem['severity']): string {
  switch (severity) {
    case 'high': return getMessage('diagSeverityHigh') || 'High';
    case 'medium': return getMessage('diagSeverityMedium') || 'Medium';
    case 'low': return getMessage('diagSeverityLow') || 'Low';
    default: return severity;
  }
}

/**
 * Initializes the diagnostics panel with storage stats, extension info,
 * Obsidian/AI settings display, and connection test functionality.
 */
async function initDiagnosticsPanel(): Promise<void> {
  const storageStats = document.getElementById('diagStorageStats') as HTMLElement | null;
  const extInfo = document.getElementById('diagExtInfo') as HTMLElement | null;
  const diagTestObsidianBtn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement | null;
  const diagTestAiBtn = document.getElementById('diagTestAiBtn') as HTMLButtonElement | null;
  const connectionResult = document.getElementById('diagConnectionResult') as HTMLElement | null;
  const obsidianSettingsEl = document.getElementById('diagObsidianSettings') as HTMLElement | null;
  const aiSettingsEl = document.getElementById('diagAiSettings') as HTMLElement | null;

  // Obsidian / AI 設定情報
  try {
    const settings = await getSettings();

    if (obsidianSettingsEl) {
      const protocol = (settings[StorageKeys.OBSIDIAN_PROTOCOL] as string) || 'https';
      const port = (settings[StorageKeys.OBSIDIAN_PORT] as string) || '27124';
      const apiKey = (settings[StorageKeys.OBSIDIAN_API_KEY] as string) || '';
      const dailyPath = (settings[StorageKeys.OBSIDIAN_DAILY_PATH] as string) || '';

      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagProtocol') || 'Protocol',
        protocol
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagPort') || 'Port',
        port
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagRestUrl') || 'REST API URL',
        `${protocol}://127.0.0.1:${port}`
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagDailyPath') || 'Daily Note Path',
        dailyPath || (getMessage('defaultValue') || '(default)')
      ));
      const configuredLabel = getMessage('configured') || '(configured)';
      const notSetLabel = getMessage('notSet') || '(not set)';
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagApiKey') || 'API Key',
        apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
        !apiKey
      ));
    }

    if (aiSettingsEl) {
      const provider = (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini';
      const providerLabels: Record<string, string> = {
        gemini: 'Google Gemini',
        openai: 'OpenAI Compatible',
        openai2: 'OpenAI Compatible 2',
      };
      aiSettingsEl.appendChild(makeStatRow(
        getMessage('diagProvider') || 'Provider',
        providerLabels[provider] || provider
      ));

      const configuredLabel = getMessage('configured') || '(configured)';
      const notSetLabel = getMessage('notSet') || '(not set)';

      if (provider === 'gemini') {
        const model = (settings[StorageKeys.GEMINI_MODEL] as string) || '';
        const key = (settings[StorageKeys.GEMINI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      } else if (provider === 'openai') {
        const baseUrl = (settings[StorageKeys.OPENAI_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagBaseUrl') || 'Base URL',
          baseUrl || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      } else if (provider === 'openai2') {
        const baseUrl = (settings[StorageKeys.OPENAI_2_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_2_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_2_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagBaseUrl') || 'Base URL',
          baseUrl || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      }
    }
  } catch {
    if (obsidianSettingsEl) {
      obsidianSettingsEl.textContent = getMessage('diagLoadError') || '設定の読み込みに失敗しました。';
    }
  }

  // Storage stats
  if (storageStats) {
    try {
      const bytesUsed = await chrome.storage.local.getBytesInUse(null);
      const kb = (bytesUsed / 1024).toFixed(1);
      const urlCount = await getSavedUrlCount();

      storageStats.appendChild(makeStatRow(
        getMessage('diagStorageUsed') || 'Storage Used',
        `${kb} KB`
      ));
      storageStats.appendChild(makeStatRow(
        getMessage('diagSavedUrls') || 'Saved URLs',
        String(urlCount)
      ));
    } catch {
      storageStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
    }
  }

  // SQLite status
  const sqliteStats = document.getElementById('diagSqliteStats') as HTMLElement | null;
  const diagTestSqliteBtn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement | null;
  const sqliteResult = document.getElementById('diagSqliteResult') as HTMLElement | null;

  // Debug mode toggle
  const diagDebugModeToggle = document.getElementById('diagDebugModeToggle') as HTMLInputElement | null;
  const compileOptionsSection = document.getElementById('diagCompileOptionsSection') as HTMLElement | null;
  const diagCompileOptionsStats = document.getElementById('diagCompileOptionsStats') as HTMLElement | null;
  const diagDeficiencyStats = document.getElementById('diagDeficiencyStats') as HTMLElement | null;
  const diagDivergenceWarning = document.getElementById('diagDivergenceWarning') as HTMLElement | null;

  // Load debug mode state
  const debugModeResult = await chrome.storage.local.get('debugMode');
  const debugMode = Boolean(debugModeResult.debugMode);
  if (diagDebugModeToggle) {
    diagDebugModeToggle.checked = debugMode;
    diagDebugModeToggle.setAttribute('aria-checked', String(debugMode));
  }
  // Show/hide debug sections based on debugMode
  if (compileOptionsSection) {
    compileOptionsSection.style.display = debugMode ? '' : 'none';
  }

  // Debug mode toggle handler
  diagDebugModeToggle?.addEventListener('change', async () => {
    const isOn = diagDebugModeToggle.checked;
    diagDebugModeToggle.setAttribute('aria-checked', String(isOn));
    await chrome.storage.local.set({ debugMode: isOn });
    if (compileOptionsSection) {
      compileOptionsSection.style.display = isOn ? '' : 'none';
    }
  });

  // Environment divergence detection
  let dashboardVfsStrategy: string | null = null;
  try {
    const { strategy } = detectLiveVfsStrategy();
    dashboardVfsStrategy = strategy;
  } catch {
    // detectLiveVfsStrategy may fail in some environments
  }

  let sqliteStatus: Awaited<ReturnType<typeof getSqliteStatus>> = null;

  if (sqliteStats) {
    try {
      sqliteStatus = await getSqliteStatus();
      if (sqliteStatus) {
        const initializedText = sqliteStatus.initialized
          ? (getMessage('diagSqliteAvailable') || 'Available')
          : (getMessage('diagSqliteUnavailable') || 'Unavailable');
        sqliteStats.appendChild(makeStatRow(
          getMessage('diagSqliteStatus') || 'Status',
          initializedText
        ));
        sqliteStats.appendChild(makeStatRow(
          getMessage('diagSqlitePath') || 'Path',
          sqliteStatus.path || '(none)'
        ));
        const fallbackText = sqliteStatus.fallback
          ? (getMessage('diagSqliteFallbackYes') || 'Yes (using fallback storage)')
          : (getMessage('diagSqliteFallbackNo') || 'No (native SQLite)');
        sqliteStats.appendChild(makeStatRow(
          getMessage('diagSqliteFallback') || 'Fallback Mode',
          fallbackText
        ));
        sqliteStats.appendChild(makeStatRow(
          getMessage('diagSqliteFts5') || 'FTS5 Search',
          sqliteStatus.fts5 ? '✓ Available' : '✗ Not available (LIKE fallback)'
        ));

        // Compile options source
        if (sqliteStatus.compileOptionsSource) {
          sqliteStats.appendChild(makeStatRow(
            getMessage('diagCompileOptionsSource') || 'Source',
            sqliteStatus.compileOptionsSource
          ));
        }

        // Init error (when DB failed to initialize)
        if (sqliteStatus.initError) {
          sqliteStats.appendChild(makeStatRow(
            'Init Error',
            sqliteStatus.initError
          ));
        }
      } else {
        sqliteStats.textContent = getMessage('diagSqliteCheckFailed') || 'Failed to check SQLite status.';
      }
    } catch {
      sqliteStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
    }
  }

  // Deficiency diagnosis — use offscreen status (the actual runtime) as the source of truth,
  // not the dashboard-side detection which runs in a different context (window vs Worker).
  if (diagDeficiencyStats && sqliteStatus) {
    // Derive VFS strategy from offscreen status, not dashboard detection.
    // Only 'opfs-sync-worker' and 'fallback' are production-ready paths.
    // IDB path (compileOptionsSource === 'idb') is the standard async path — not OPFS.
    const isOpfsWorker = sqliteStatus.compileOptionsSource === 'opfs-worker'
      || sqliteStatus.path.startsWith('OPFS:');
    const offscreenStrategy: DiagnosticInput['vfsStrategy'] = sqliteStatus.fallback
      ? 'fallback'
      : isOpfsWorker
        ? 'opfs-sync-worker'
        : 'opfs-async-main';

    // For OPFS-related capabilities, only assert them when we know for sure.
    // OPFS Worker path: all capabilities present.
    // Fallback: no OPFS at all.
    // IDB path: OPFS capabilities unknown — don't report them as deficiencies.
    const isOpfsKnown = isOpfsWorker || sqliteStatus.fallback;

    const diagInput: DiagnosticInput = {
      opfsDirectory: isOpfsWorker,
      syncAccessHandle: isOpfsWorker,
      worker: isOpfsWorker,
      initialized: sqliteStatus.initialized,
      fallback: sqliteStatus.fallback,
      fts5: sqliteStatus.fts5,
      initError: sqliteStatus.initError,
      vfsStrategy: offscreenStrategy,
    };
    const deficiencies = diagnoseDeficiencies(diagInput);

    if (deficiencies.length === 0) {
      diagDeficiencyStats.appendChild(makeStatRow(
        getMessage('diagDeficiencyNone') || 'No deficiencies — all features are enabled.',
        '✓'
      ));
    } else {
      for (const item of deficiencies) {
        const severityLabel = getSeverityLabel(item.severity);
        const summaryText = getMessage(item.summaryKey) || item.id;
        diagDeficiencyStats.appendChild(makeStatRow(
          `${summaryText} [${severityLabel}]`,
          getMessage(item.recommendedActionKey) || ''
        ));
      }
    }
  }

  // Compile options display (debug mode only)
  if (diagCompileOptionsStats && sqliteStatus?.compileOptions && debugMode) {
    const options = sqliteStatus.compileOptions;
    const source = sqliteStatus.compileOptionsSource || 'unknown';
    diagCompileOptionsStats.appendChild(makeStatRow(
      getMessage('diagCompileOptionsSource') || 'Source',
      source
    ));
    diagCompileOptionsStats.appendChild(makeStatRow(
      'Total',
      String(options.length)
    ));

    // Highlight FTS/VFS related options
    const ftsVfsOptions = options.filter(o => o.includes('FTS') || o.includes('VFS'));
    if (ftsVfsOptions.length > 0) {
      diagCompileOptionsStats.appendChild(makeStatRow(
        getMessage('diagCompileOptionsHighlight') || 'FTS/VFS related',
        ftsVfsOptions.join(', ')
      ));
    }

    // Show all options in a collapsible details
    const allOptionsDetails = document.createElement('details');
    allOptionsDetails.className = 'advanced-details';
    allOptionsDetails.innerHTML = `
      <summary class="advanced-details-summary">All ${options.length} options</summary>
      <div class="advanced-details-content">
        <pre class="diag-compile-options-list">${options.join('\n')}</pre>
      </div>
    `;
    diagCompileOptionsStats.appendChild(allOptionsDetails);
  }

  // Divergence detection — only warn when there's a real functional mismatch.
  // Dashboard window cannot detect Worker-only APIs (SyncAccessHandle), so
  // dashboardVfsStrategy will often differ from offscreenStrategy in the
  // normal OPFS Worker case. This is expected, not a problem.
  // Only warn when offscreen is using fallback but dashboard detects OPFS
  // (meaning OPFS is available but not being used).
  if (diagDivergenceWarning && dashboardVfsStrategy && sqliteStatus) {
    const offscreenUsesFallback = sqliteStatus.fallback;
    const dashboardDetectsOpfs = dashboardVfsStrategy !== 'fallback';

    if (offscreenUsesFallback && dashboardDetectsOpfs) {
      diagDivergenceWarning.style.display = '';
    }
  }

  // Extension info
  if (extInfo) {
    const manifest = chrome.runtime.getManifest();
    extInfo.appendChild(makeStatRow(
      getMessage('diagVersion') || 'Version',
      manifest.version
    ));
    extInfo.appendChild(makeStatRow(
      getMessage('diagExtName') || 'Extension',
      manifest.name
    ));
  }

  // プレースホルダーテキストをdata属性にセット（CSS ::before で表示）
  if (connectionResult) {
    connectionResult.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
  }

  // Obsidian 接続テスト
  diagTestObsidianBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    diagTestObsidianBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_OBSIDIAN',
        payload: {}
      }) as { obsidian?: { success: boolean; message: string } };

      const obsidian = testResult?.obsidian;
      connectionResult.textContent = obsidian
        ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = obsidian?.success ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})` : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestObsidianBtn.disabled = false;
    }
  });

  // AI 接続テスト
  diagTestAiBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    diagTestAiBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_AI',
        payload: {}
      }) as { ai?: { success: boolean; message: string } };

      const ai = testResult?.ai;
      connectionResult.textContent = ai
        ? `AI: ${ai.success ? '✓' : '✗'} ${ai.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = ai?.success ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})` : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestAiBtn.disabled = false;
    }
  });

  // SQLite テスト
  diagTestSqliteBtn?.addEventListener('click', async () => {
    if (!sqliteResult) return;
    diagTestSqliteBtn.disabled = true;
    sqliteResult.textContent = getMessage('testing') || 'Testing...';
    sqliteResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'DASHBOARD_SQLITE',
        payload: { subtype: 'status' }
      }) as { success: boolean; initialized?: boolean; fallback?: boolean; error?: string; initError?: string; fts5?: boolean };

      if (testResult.success) {
        if (testResult.initialized) {
          const fts5Text = testResult.fts5 ? 'FTS5 ✓' : 'LIKE fallback';
          sqliteResult.textContent = `✓ ${getMessage('diagSqliteTestOk') || 'SQLite is working correctly.'} (${fts5Text})`;
          sqliteResult.style.color = `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`;
        } else {
          const errorMsg = testResult.initError || testResult.error || 'SQLite initialization failed.';
          sqliteResult.textContent = `✗ ${getMessage('diagSqliteTestInitFailed') || 'SQLite initialization failed.'}\n${errorMsg}`;
          sqliteResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        }
      } else {
        sqliteResult.textContent = `✗ ${testResult.error || 'SQLite test failed.'}`;
        sqliteResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
      }
    } catch (e) {
      sqliteResult.textContent = getMessage('testError') || 'Connection test failed.';
      sqliteResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestSqliteBtn.disabled = false;
    }
  });

  // OPFS feasibility spike (PBI-10, debug)
  const diagOpfsSpikeBtn = document.getElementById('diagOpfsSpikeBtn') as HTMLButtonElement | null;
  const opfsSpikeResult = document.getElementById('diagOpfsSpikeResult') as HTMLElement | null;
  diagOpfsSpikeBtn?.addEventListener('click', async () => {
    if (!opfsSpikeResult) return;
    diagOpfsSpikeBtn.disabled = true;
    opfsSpikeResult.textContent = getMessage('testing') || 'Testing...';
    opfsSpikeResult.className = 'diag-result';

    try {
      const report = await runOpfsSpike();
      if (report) {
        const header = `${report.passed ? '✓' : '✗'} strategy=${report.strategy} (${report.durationMs}ms)`;
        const lines = report.steps.map(
          s => `  ${s.ok ? '✓' : '✗'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`
        );
        opfsSpikeResult.textContent = [header, ...lines].join('\n');
        opfsSpikeResult.style.color = report.passed
          ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`
          : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
      } else {
        opfsSpikeResult.textContent = '✗ OPFS spike returned no report.';
        opfsSpikeResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
      }
    } catch (e) {
      opfsSpikeResult.textContent = getMessage('testError') || 'Spike failed.';
      opfsSpikeResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagOpfsSpikeBtn.disabled = false;
    }
  });

  // Legacy history → SQLite conversion (PBI-11)
  const diagMigrateBtn = document.getElementById('diagMigrateBtn') as HTMLButtonElement | null;
  const migrateResult = document.getElementById('diagMigrateResult') as HTMLElement | null;
  diagMigrateBtn?.addEventListener('click', async () => {
    if (!migrateResult) return;
    const confirmed = await showConfirmDialog({
      title: getMessage('diagMigrateBtn') || 'Convert history to SQLite',
      message: getMessage('diagMigrateConfirm') || 'Convert legacy browsing history into SQLite? The original data is kept.',
      confirmLabel: getMessage('diagMigrateConfirmLabel') || 'Convert',
      cancelLabel: getMessage('cancel') || 'Cancel',
    });
    if (!confirmed) return;

    diagMigrateBtn.disabled = true;
    migrateResult.textContent = getMessage('testing') || 'Working...';
    migrateResult.className = 'diag-result';

    try {
      const result = await migrateLogs();
      if (result) {
        migrateResult.textContent =
          `✓ ${getMessage('diagMigrateDone') || 'Conversion complete.'} ` +
          `read=${result.read} inserted=${result.inserted} total=${result.count}`;
        migrateResult.style.color = `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`;
      } else {
        migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}`;
        migrateResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
      }
    } catch (e) {
      migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}`;
      migrateResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagMigrateBtn.disabled = false;
    }
  });
}

export { initDiagnosticsPanel };
