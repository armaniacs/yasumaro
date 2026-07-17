import { getMessage } from '../../../popup/i18n.js';
import { getSettings, StorageKeys } from '../../../utils/storage.js';
import { getSavedUrlCount } from '../../../utils/storageUrls.js';
import { UI_COLORS } from '../../../constants/appConstants.js';
import { getSqliteStatus, runOpfsSpike, migrateLogs, backfillMetadata, cleanupLegacyStorage } from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { diagnoseDeficiencies, type DiagnosticInput, type DeficiencyItem } from '../../diagnoseDeficiencies.js';
import { detectLiveVfsStrategy } from '../../../offscreen/opfsCapabilities.js';
import { type DiagnosticPanel } from '../types.js';

function makeStatRow(label: string, value: string, masked = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'diag-stat-row';
  const valueHtml = masked
    ? `<span class="diag-stat-value diag-stat-masked">${value}</span>`
    : `<span class="diag-stat-value">${value}</span>`;
  row.innerHTML = `<span class="diag-stat-label">${label}</span>${valueHtml}`;
  return row;
}

function getSeverityLabel(severity: DeficiencyItem['severity']): string {
  switch (severity) {
    case 'high': return getMessage('diagSeverityHigh') || 'High';
    case 'medium': return getMessage('diagSeverityMedium') || 'Medium';
    case 'low': return getMessage('diagSeverityLow') || 'Low';
    default: return severity;
  }
}

export function createDiagnosticsPanel(): DiagnosticPanel {
  let _container: HTMLElement | null = null;

  async function loadAndPopulate(): Promise<void> {
    const container = _container;
    if (!container) return;

    const storageStats = container.querySelector('#diagStorageStats') as HTMLElement | null;
    const extInfo = container.querySelector('#diagExtInfo') as HTMLElement | null;
    const obsidianSettingsEl = container.querySelector('#diagObsidianSettings') as HTMLElement | null;
    const aiSettingsEl = container.querySelector('#diagAiSettings') as HTMLElement | null;
    const connectionResult = container.querySelector('#diagConnectionResult') as HTMLElement | null;
    const sqliteStats = container.querySelector('#diagSqliteStats') as HTMLElement | null;
    const diagDeficiencyStats = container.querySelector('#diagDeficiencyStats') as HTMLElement | null;
    const diagCompileOptionsStats = container.querySelector('#diagCompileOptionsStats') as HTMLElement | null;
    const diagDivergenceWarning = container.querySelector('#diagDivergenceWarning') as HTMLElement | null;
    const compileOptionsSection = container.querySelector('#diagCompileOptionsSection') as HTMLElement | null;
    const debugModeResult = await chrome.storage.local.get('debugMode');
    const debugMode = Boolean(debugModeResult.debugMode);

    if (storageStats) storageStats.innerHTML = '';
    if (extInfo) extInfo.innerHTML = '';
    if (obsidianSettingsEl) obsidianSettingsEl.innerHTML = '';
    if (aiSettingsEl) aiSettingsEl.innerHTML = '';
    if (sqliteStats) { sqliteStats.innerHTML = ''; sqliteStats.textContent = getMessage('diagSqliteChecking') || 'Checking SQLite status...'; }
    if (diagDeficiencyStats) diagDeficiencyStats.innerHTML = '';
    if (diagCompileOptionsStats) diagCompileOptionsStats.innerHTML = '';
    if (compileOptionsSection) compileOptionsSection.style.display = debugMode ? '' : 'none';
    if (diagDivergenceWarning) diagDivergenceWarning.style.display = 'none';

    // Obsidian / AI settings
    try {
      const settings = await getSettings();

      if (obsidianSettingsEl) {
        const protocol = (settings[StorageKeys.OBSIDIAN_PROTOCOL] as string) || 'https';
        const port = (settings[StorageKeys.OBSIDIAN_PORT] as string) || '27124';
        const apiKey = (settings[StorageKeys.OBSIDIAN_API_KEY] as string) || '';
        const dailyPath = (settings[StorageKeys.OBSIDIAN_DAILY_PATH] as string) || '';

        obsidianSettingsEl.appendChild(makeStatRow(getMessage('diagProtocol') || 'Protocol', protocol));
        obsidianSettingsEl.appendChild(makeStatRow(getMessage('diagPort') || 'Port', port));
        obsidianSettingsEl.appendChild(makeStatRow(getMessage('diagRestUrl') || 'REST API URL', `${protocol}://127.0.0.1:${port}`));
        obsidianSettingsEl.appendChild(makeStatRow(getMessage('diagDailyPath') || 'Daily Note Path', dailyPath || (getMessage('defaultValue') || '(default)')));
        const configuredLabel = getMessage('configured') || '(configured)';
        const notSetLabel = getMessage('notSet') || '(not set)';
        obsidianSettingsEl.appendChild(makeStatRow(getMessage('diagApiKey') || 'API Key', apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !apiKey));
      }

      if (aiSettingsEl) {
        const provider = (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini';
        const providerLabels: Record<string, string> = {
          gemini: 'Google Gemini',
          openai: 'OpenAI Compatible',
          openai2: 'OpenAI Compatible 2',
        };
        aiSettingsEl.appendChild(makeStatRow(getMessage('diagProvider') || 'Provider', providerLabels[provider] || provider));

        const configuredLabel = getMessage('configured') || '(configured)';
        const notSetLabel = getMessage('notSet') || '(not set)';

        if (provider === 'gemini') {
          const model = (settings[StorageKeys.GEMINI_MODEL] as string) || '';
          const key = (settings[StorageKeys.GEMINI_API_KEY] as string) || '';
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagModel') || 'Model', model || notSetLabel));
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagApiKey') || 'API Key', key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !key));
        } else if (provider === 'openai') {
          const baseUrl = (settings[StorageKeys.OPENAI_BASE_URL] as string) || '';
          const model = (settings[StorageKeys.OPENAI_MODEL] as string) || '';
          const key = (settings[StorageKeys.OPENAI_API_KEY] as string) || '';
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagBaseUrl') || 'Base URL', baseUrl || notSetLabel));
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagModel') || 'Model', model || notSetLabel));
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagApiKey') || 'API Key', key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !key));
        } else if (provider === 'openai2') {
          const baseUrl = (settings[StorageKeys.OPENAI_2_BASE_URL] as string) || '';
          const model = (settings[StorageKeys.OPENAI_2_MODEL] as string) || '';
          const key = (settings[StorageKeys.OPENAI_2_API_KEY] as string) || '';
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagBaseUrl') || 'Base URL', baseUrl || notSetLabel));
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagModel') || 'Model', model || notSetLabel));
          aiSettingsEl.appendChild(makeStatRow(getMessage('diagApiKey') || 'API Key', key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !key));
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
        storageStats.appendChild(makeStatRow(getMessage('diagStorageUsed') || 'Storage Used', `${kb} KB`));
        storageStats.appendChild(makeStatRow(getMessage('diagSavedUrls') || 'Saved URLs', String(urlCount)));
      } catch {
        storageStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
      }
    }

    // SQLite status
    let sqliteStatus: { initialized: boolean; path: string; fallback: boolean; fts5: boolean; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback'; initError?: string; opfsMigrationV2Done?: boolean; opfsMigrationV2LastAttemptedAt?: string | null; opfsMigrationV2CompletedAt?: string | null; opfsMigrationV2RecordCount?: number } | null = null;
    if (sqliteStats) {
      try {
        sqliteStatus = await retryWithExponentialBackoff(
          () => getSqliteStatus(),
          { label: 'diagSqliteStatus', maxAttempts: 4 }
        );
        sqliteStats.innerHTML = '';
        if (sqliteStatus) {
          const initializedText = sqliteStatus.initialized
            ? (getMessage('diagSqliteAvailable') || 'Available')
            : (getMessage('diagSqliteUnavailable') || 'Unavailable');
          sqliteStats.appendChild(makeStatRow(getMessage('diagSqliteStatus') || 'Status', initializedText));
          sqliteStats.appendChild(makeStatRow(getMessage('diagSqlitePath') || 'Path', sqliteStatus.path || '(none)'));
          const fallbackText = sqliteStatus.fallback
            ? (getMessage('diagSqliteFallbackYes') || 'Yes (using fallback storage)')
            : (getMessage('diagSqliteFallbackNo') || 'No (native SQLite)');
          sqliteStats.appendChild(makeStatRow(getMessage('diagSqliteFallback') || 'Fallback Mode', fallbackText));
          sqliteStats.appendChild(makeStatRow(getMessage('diagSqliteFts5') || 'FTS5 Search', sqliteStatus.fts5 ? '✓ Available' : '✗ Not available (LIKE fallback)'));

          // OPFS migration status (PBI: 2026-07-17-08)
          if (sqliteStatus.opfsMigrationV2Done !== undefined) {
            const migrationLabel = getMessage('diagOpfsMigrationV2') || 'OPFS Data Migration';
            if (sqliteStatus.opfsMigrationV2Done) {
              const completed = sqliteStatus.opfsMigrationV2CompletedAt
                ? ` (${new Date(sqliteStatus.opfsMigrationV2CompletedAt).toLocaleString()})`
                : '';
              const count = sqliteStatus.opfsMigrationV2RecordCount
                ? ` — ${sqliteStatus.opfsMigrationV2RecordCount} records`
                : '';
              sqliteStats.appendChild(makeStatRow(migrationLabel, `✓ Completed${completed}${count}`));
            } else if (sqliteStatus.opfsMigrationV2LastAttemptedAt) {
              const attempted = new Date(sqliteStatus.opfsMigrationV2LastAttemptedAt).toLocaleString();
              sqliteStats.appendChild(makeStatRow(migrationLabel, `⏳ Pending (last attempt: ${attempted})`));
            } else {
              sqliteStats.appendChild(makeStatRow(migrationLabel, '⏳ Pending'));
            }
          }

          if (sqliteStatus.compileOptionsSource) {
            sqliteStats.appendChild(makeStatRow(getMessage('diagCompileOptionsSource') || 'Source', sqliteStatus.compileOptionsSource));
          }
          if (sqliteStatus.initError) {
            sqliteStats.appendChild(makeStatRow('Init Error', sqliteStatus.initError));
          }
        } else {
          sqliteStats.textContent = getMessage('diagSqliteCheckFailed') || 'Failed to check SQLite status.';
        }
      } catch {
        sqliteStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
      }
    }

    // Deficiency diagnosis
    if (diagDeficiencyStats && sqliteStatus) {
      const isOpfsWorker = (sqliteStatus.compileOptionsSource === 'opfs-worker')
        || sqliteStatus.path.startsWith('OPFS:');
      const offscreenStrategy: DiagnosticInput['vfsStrategy'] = sqliteStatus.fallback
        ? 'fallback'
        : isOpfsWorker
          ? 'opfs-sync-worker'
          : 'opfs-async-main';

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
        diagDeficiencyStats.appendChild(makeStatRow(getMessage('diagDeficiencyNone') || 'No deficiencies — all features are enabled.', '✓'));
      } else {
        for (const item of deficiencies) {
          const severityLabel = getSeverityLabel(item.severity);
          const summaryText = getMessage(item.summaryKey) || item.id;
          diagDeficiencyStats.appendChild(makeStatRow(`${summaryText} [${severityLabel}]`, getMessage(item.recommendedActionKey) || ''));
        }
      }
    }

    // Compile options (debug mode only)
    if (diagCompileOptionsStats && sqliteStatus?.compileOptions && debugMode) {
      const options = sqliteStatus.compileOptions;
      const source = sqliteStatus.compileOptionsSource || 'unknown';
      diagCompileOptionsStats.appendChild(makeStatRow(getMessage('diagCompileOptionsSource') || 'Source', source));
      diagCompileOptionsStats.appendChild(makeStatRow('Total', String(options.length)));

      const ftsVfsOptions = options.filter(o => o.includes('FTS') || o.includes('VFS'));
      if (ftsVfsOptions.length > 0) {
        diagCompileOptionsStats.appendChild(makeStatRow(getMessage('diagCompileOptionsHighlight') || 'FTS/VFS related', ftsVfsOptions.join(', ')));
      }

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

    // Divergence warning
    if (diagDivergenceWarning && sqliteStatus) {
      let dashboardVfsStrategy: string | null = null;
      try {
        const { strategy } = detectLiveVfsStrategy();
        dashboardVfsStrategy = strategy;
      } catch { /* detectLiveVfsStrategy may fail */ }

      const offscreenUsesFallback = sqliteStatus.fallback;
      const dashboardDetectsOpfs = dashboardVfsStrategy !== 'fallback';
      if (offscreenUsesFallback && dashboardDetectsOpfs) {
        diagDivergenceWarning.style.display = '';
      }
    }

    // Extension info
    if (extInfo) {
      const manifest = chrome.runtime.getManifest();
      extInfo.appendChild(makeStatRow(getMessage('diagVersion') || 'Version', manifest.version));
      extInfo.appendChild(makeStatRow(getMessage('diagExtName') || 'Extension', manifest.name));
    }

    // Placeholder text for connection result
    if (connectionResult) {
      connectionResult.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
    }
  }

  return {
    id: 'panel-diagnostics',
    category: 'diagnostic',
    async mount(container) {
      _container = container;

      const diagDebugModeToggle = container.querySelector('#diagDebugModeToggle') as HTMLInputElement | null;
      const compileOptionsSection = container.querySelector('#diagCompileOptionsSection') as HTMLElement | null;
      const diagTestObsidianBtn = container.querySelector('#diagTestObsidianBtn') as HTMLButtonElement | null;
      const diagTestAiBtn = container.querySelector('#diagTestAiBtn') as HTMLButtonElement | null;
      const diagTestSqliteBtn = container.querySelector('#diagTestSqliteBtn') as HTMLButtonElement | null;
      const connectionResult = container.querySelector('#diagConnectionResult') as HTMLElement | null;
      const sqliteResult = container.querySelector('#diagSqliteResult') as HTMLElement | null;
      const diagOpfsSpikeBtn = container.querySelector('#diagOpfsSpikeBtn') as HTMLButtonElement | null;
      const opfsSpikeResult = container.querySelector('#diagOpfsSpikeResult') as HTMLElement | null;
      const diagMigrateBtn = container.querySelector('#diagMigrateBtn') as HTMLButtonElement | null;
      const migrateResult = container.querySelector('#diagMigrateResult') as HTMLElement | null;
      const diagBackfillBtn = container.querySelector('#diagBackfillBtn') as HTMLButtonElement | null;
      const backfillResult = container.querySelector('#diagBackfillResult') as HTMLElement | null;
      const diagCleanupBtn = container.querySelector('#diagCleanupBtn') as HTMLButtonElement | null;
      const cleanupResult = container.querySelector('#diagCleanupResult') as HTMLElement | null;

      // Debug mode state + toggle
      const debugModeResult = await chrome.storage.local.get('debugMode');
      const debugMode = Boolean(debugModeResult.debugMode);
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
        await chrome.storage.local.set({ debugMode: isOn });
        if (compileOptionsSection) {
          compileOptionsSection.style.display = isOn ? '' : 'none';
        }
      });

      // Obsidian connection test
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
        } catch {
          connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
          connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        } finally {
          diagTestObsidianBtn.disabled = false;
        }
      });

      // AI connection test
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
        } catch {
          connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
          connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        } finally {
          diagTestAiBtn.disabled = false;
        }
      });

      // SQLite test
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
        } catch {
          sqliteResult.textContent = getMessage('testError') || 'Connection test failed.';
          sqliteResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        } finally {
          diagTestSqliteBtn.disabled = false;
        }
      });

      // OPFS feasibility spike
      diagOpfsSpikeBtn?.addEventListener('click', async () => {
        if (!opfsSpikeResult) return;
        diagOpfsSpikeBtn.disabled = true;
        opfsSpikeResult.textContent = getMessage('testing') || 'Testing...';
        opfsSpikeResult.className = 'diag-result';

        try {
          const report = await runOpfsSpike();
          if (report) {
            const header = `${report.passed ? '✓' : '✗'} strategy=${report.strategy} (${report.durationMs}ms)`;
            const lines = report.steps.map(s => `  ${s.ok ? '✓' : '✗'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
            opfsSpikeResult.textContent = [header, ...lines].join('\n');
            opfsSpikeResult.style.color = report.passed
              ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`
              : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
          } else {
            opfsSpikeResult.textContent = '✗ OPFS spike returned no report.';
            opfsSpikeResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
          }
        } catch {
          opfsSpikeResult.textContent = getMessage('testError') || 'Spike failed.';
          opfsSpikeResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        } finally {
          diagOpfsSpikeBtn.disabled = false;
        }
      });

      // Migrate legacy history to SQLite
      diagMigrateBtn?.addEventListener('click', async () => {
        if (!migrateResult) return;
        const confirmed = await showConfirmDialog({
          title: getMessage('diagMigrateBtn') || 'Convert history to SQLite',
          message: getMessage('diagMigrateConfirm') || 'Convert legacy browsing history into SQLite. The original chrome.storage data is preserved (you can clean it up separately from the diagnostics panel).',
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
            migrateResult.textContent = `✓ ${getMessage('diagMigrateDone') || 'Conversion complete.'} read=${result.read} inserted=${result.inserted} total=${result.count}`;
            migrateResult.style.color = `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`;
          } else {
            migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}`;
            migrateResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
          }
        } catch {
          migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}`;
          migrateResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        } finally {
          diagMigrateBtn.disabled = false;
        }
      });

      // Backfill diagnostic metadata
      diagBackfillBtn?.addEventListener('click', async () => {
        if (!backfillResult) return;
        diagBackfillBtn.disabled = true;
        backfillResult.textContent = getMessage('testing') || 'Working...';
        backfillResult.className = 'diag-result';

        try {
          const result = await backfillMetadata();
          if (result) {
            backfillResult.textContent = `✓ ${getMessage('diagBackfillDone') || 'Backfill complete.'} updated=${result.updated}/${result.total}`;
            backfillResult.style.color = `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`;
          } else {
            backfillResult.textContent = `✗ ${getMessage('diagBackfillFailed') || 'Backfill failed.'}`;
            backfillResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
          }
        } catch {
          backfillResult.textContent = `✗ ${getMessage('diagBackfillFailed') || 'Backfill failed.'}`;
          backfillResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        } finally {
          diagBackfillBtn.disabled = false;
        }
      });

      // Cleanup legacy storage
      diagCleanupBtn?.addEventListener('click', async () => {
        if (!cleanupResult) return;
        const confirmed = await showConfirmDialog({
          title: getMessage('diagCleanupBtn') || 'Delete legacy storage data',
          message: getMessage('diagCleanupConfirm') || 'Delete the original chrome.storage browsing history? This is a destructive operation. The data is already copied to SQLite.',
          confirmLabel: getMessage('diagCleanupConfirmLabel') || 'Delete',
          cancelLabel: getMessage('cancel') || 'Cancel',
        });
        if (!confirmed) return;

        diagCleanupBtn.disabled = true;
        cleanupResult.textContent = getMessage('testing') || 'Working...';
        cleanupResult.className = 'diag-result';

        try {
          const result = await cleanupLegacyStorage();
          if (result) {
            cleanupResult.textContent = `✓ ${getMessage('diagCleanupDone') || 'Cleanup complete.'} removed=${result.removed.length} keys, ${result.totalBytes} bytes freed`;
            cleanupResult.style.color = `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`;
          } else {
            cleanupResult.textContent = `✗ ${getMessage('diagCleanupFailed') || 'Cleanup failed.'}`;
            cleanupResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
          }
        } catch {
          cleanupResult.textContent = `✗ ${getMessage('diagCleanupFailed') || 'Cleanup failed.'}`;
          cleanupResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
        } finally {
          diagCleanupBtn.disabled = false;
        }
      });

      await loadAndPopulate();
    },
    async refresh() {
      await loadAndPopulate();
    },
  };
}
