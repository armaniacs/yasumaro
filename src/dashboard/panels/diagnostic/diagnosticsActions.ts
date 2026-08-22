/**
 * diagnosticsActions — user-triggered operations for the diagnostics panel.
 *
 * Owns every button click handler: the three connection tests, the OPFS spike,
 * the destructive maintenance operations (with confirm dialogs), and the
 * built-in AI model download. Data *collection* lives in DiagnosticsCollector;
 * this module only performs actions and renders their results.
 */

import { getMessage } from '../../../utils/i18n.js';
import { CURRENT_PROTOCOL_VERSION } from '../../../background/messageTypes.js';
import { UI_COLORS } from '../../../constants/appConstants.js';
import {
  runOpfsSpike,
  migrateLogs,
  backfillMetadata,
  cleanupLegacyStorage,
} from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import {
  startBuiltInAiDownload,
  type BuiltInAiDiagnosticsResult,
} from '../../builtInAiDiagnosticsService.js';
import { formatProviderHeadline, formatProviderDetailLines } from '../../aiTestResultView.js';

export interface DiagnosticActionElements {
  testObsidianBtn: HTMLButtonElement | null;
  testAiBtn: HTMLButtonElement | null;
  testSqliteBtn: HTMLButtonElement | null;
  opfsSpikeBtn: HTMLButtonElement | null;
  migrateBtn: HTMLButtonElement | null;
  backfillBtn: HTMLButtonElement | null;
  cleanupBtn: HTMLButtonElement | null;
  builtInAiDownloadBtn: HTMLButtonElement | null;
  connectionResult: HTMLElement | null;
  sqliteResult: HTMLElement | null;
  opfsSpikeResult: HTMLElement | null;
  migrateResult: HTMLElement | null;
  backfillResult: HTMLElement | null;
  cleanupResult: HTMLElement | null;
  builtInAiStats: HTMLElement | null;
  builtInAiDownloadResult: HTMLElement | null;
}

function successColor(): string {
  return `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`;
}

function errorColor(): string {
  return `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
}

/**
 * Wire all action handlers. Each handler keeps the current behavior:
 * disable button → "Working..." → try/catch → result text → re-enable in finally.
 */
export function createDiagnosticActions(
  els: DiagnosticActionElements,
  hooks: { onBuiltInAiDownloaded: (result: BuiltInAiDiagnosticsResult) => void },
): void {
  const {
    testObsidianBtn, testAiBtn, testSqliteBtn, opfsSpikeBtn,
    migrateBtn, backfillBtn, cleanupBtn, builtInAiDownloadBtn,
    connectionResult, sqliteResult, opfsSpikeResult,
    migrateResult, backfillResult, cleanupResult,
    builtInAiDownloadResult,
  } = els;

  // Obsidian connection test
  testObsidianBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    testObsidianBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_OBSIDIAN',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        payload: {}
      }) as { obsidian?: { success: boolean; message: string } };

      const obsidian = testResult?.obsidian;
      connectionResult.textContent = obsidian
        ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = obsidian?.success ? successColor() : errorColor();
    } catch {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = errorColor();
    } finally {
      testObsidianBtn.disabled = false;
    }
  });

  // AI connection test
  testAiBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    testAiBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_AI',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        payload: {}
      }) as { ai?: { success: boolean; message: string; providers?: Array<{ provider: string; model?: string; success: boolean; message: string; elapsedMs: number; debug?: { prompt?: string; response?: string; error?: string; availability?: string; hasContent?: boolean; statusCode?: number } }> } };

      const ai = testResult?.ai;
      if (ai) {
        connectionResult.innerHTML = '';

        if (ai.providers && ai.providers.length > 1) {
          const header = document.createElement('div');
          header.textContent = ai.success
            ? `AI: ${getMessage('testSuccess') || '✓ Connection successful'}`
            : `AI: ${getMessage('testFailed') || '✗ Connection failed'}`;
          header.className = ai.success ? 'diag-success diag-bold' : 'diag-error diag-bold';
          connectionResult.appendChild(header);

          for (const provider of ai.providers) {
            const row = document.createElement('div');
            row.className = 'diag-indent';
            row.textContent = formatProviderHeadline(provider);
            row.classList.add(provider.success ? 'diag-success' : 'diag-error');
            connectionResult.appendChild(row);

            for (const line of formatProviderDetailLines(provider)) {
              const detailRow = document.createElement('div');
              detailRow.className = 'diag-indent ai-debug-details';
              detailRow.textContent = line;
              connectionResult.appendChild(detailRow);
            }
          }
        } else {
          connectionResult.textContent = `AI: ${ai.success ? '✓' : '✗'} ${ai.message}`;
          connectionResult.className = `diag-result ${ai.success ? 'diag-success' : 'diag-error'}`;
        }
      } else {
        connectionResult.textContent = getMessage('testComplete') || 'Test complete.';
      }
    } catch (err) {
      console.error('Diagnostics: AI test failed', err);
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.className = 'diag-result diag-error';
    } finally {
      testAiBtn.disabled = false;
    }
  });

  // SQLite test
  testSqliteBtn?.addEventListener('click', async () => {
    if (!sqliteResult) return;
    testSqliteBtn.disabled = true;
    sqliteResult.textContent = getMessage('testing') || 'Testing...';
    sqliteResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'DASHBOARD_SQLITE',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        payload: { subtype: 'status' }
      }) as { success: boolean; initialized?: boolean; fallback?: boolean; error?: string; initError?: string; fts5?: boolean };

      if (testResult.success) {
        if (testResult.initialized) {
          const fts5Text = testResult.fts5 ? 'FTS5 ✓' : 'LIKE fallback';
          sqliteResult.textContent = `✓ ${getMessage('diagSqliteTestOk') || 'SQLite is working correctly.'} (${fts5Text})`;
          sqliteResult.style.color = successColor();
        } else {
          const errorMsg = testResult.initError || testResult.error || 'SQLite initialization failed.';
          sqliteResult.textContent = `✗ ${getMessage('diagSqliteTestInitFailed') || 'SQLite initialization failed.'}\n${errorMsg}`;
          sqliteResult.style.color = errorColor();
        }
      } else {
        sqliteResult.textContent = `✗ ${testResult.error || 'SQLite test failed.'}`;
        sqliteResult.style.color = errorColor();
      }
    } catch {
      sqliteResult.textContent = getMessage('testError') || 'Connection test failed.';
      sqliteResult.style.color = errorColor();
    } finally {
      testSqliteBtn.disabled = false;
    }
  });

  // OPFS feasibility spike
  opfsSpikeBtn?.addEventListener('click', async () => {
    if (!opfsSpikeResult) return;
    opfsSpikeBtn.disabled = true;
    opfsSpikeResult.textContent = getMessage('testing') || 'Testing...';
    opfsSpikeResult.className = 'diag-result';

    try {
      const result = await runOpfsSpike();
      if ('data' in result) {
        const report = result.data;
        const header = `${report.passed ? '✓' : '✗'} strategy=${report.strategy} (${report.durationMs}ms)`;
        const lines = report.steps.map(s => `  ${s.ok ? '✓' : '✗'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
        opfsSpikeResult.textContent = [header, ...lines].join('\n');
        opfsSpikeResult.style.color = report.passed ? successColor() : errorColor();
      } else {
        opfsSpikeResult.textContent = `✗ OPFS spike failed: ${result.error}`;
        opfsSpikeResult.style.color = errorColor();
      }
    } catch {
      opfsSpikeResult.textContent = getMessage('testError') || 'Spike failed.';
      opfsSpikeResult.style.color = errorColor();
    } finally {
      opfsSpikeBtn.disabled = false;
    }
  });

  // Migrate legacy history to SQLite (destructive-ish, confirmed)
  migrateBtn?.addEventListener('click', async () => {
    if (!migrateResult) return;
    const confirmed = await showConfirmDialog({
      title: getMessage('diagMigrateBtn') || 'Convert history to SQLite',
      message: getMessage('diagMigrateConfirm') || 'Convert legacy browsing history into SQLite. The original chrome.storage data is preserved (you can clean it up separately from the diagnostics panel).',
      confirmLabel: getMessage('diagMigrateConfirmLabel') || 'Convert',
      cancelLabel: getMessage('cancel') || 'Cancel',
    });
    if (!confirmed) return;

    migrateBtn.disabled = true;
    migrateResult.textContent = getMessage('testing') || 'Working...';
    migrateResult.className = 'diag-result';

    try {
      const result = await migrateLogs();
      if ('data' in result) {
        migrateResult.textContent = `✓ ${getMessage('diagMigrateDone') || 'Conversion complete.'} read=${result.data.read} inserted=${result.data.inserted} total=${result.data.count}`;
        migrateResult.style.color = successColor();
      } else {
        migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}: ${result.error}`;
        migrateResult.style.color = errorColor();
      }
    } catch {
      migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}`;
      migrateResult.style.color = errorColor();
    } finally {
      migrateBtn.disabled = false;
    }
  });

  // Backfill diagnostic metadata
  backfillBtn?.addEventListener('click', async () => {
    if (!backfillResult) return;
    backfillBtn.disabled = true;
    backfillResult.textContent = getMessage('testing') || 'Working...';
    backfillResult.className = 'diag-result';

    try {
      const result = await backfillMetadata();
      if ('data' in result) {
        backfillResult.textContent = `✓ ${getMessage('diagBackfillDone') || 'Backfill complete.'} updated=${result.data.updated}/${result.data.total}`;
        backfillResult.style.color = successColor();
      } else {
        backfillResult.textContent = `✗ ${getMessage('diagBackfillFailed') || 'Backfill failed.'}: ${result.error}`;
        backfillResult.style.color = errorColor();
      }
    } catch {
      backfillResult.textContent = `✗ ${getMessage('diagBackfillFailed') || 'Backfill failed.'}`;
      backfillResult.style.color = errorColor();
    } finally {
      backfillBtn.disabled = false;
    }
  });

  // Cleanup legacy storage (destructive, confirmed)
  cleanupBtn?.addEventListener('click', async () => {
    if (!cleanupResult) return;
    const confirmed = await showConfirmDialog({
      title: getMessage('diagCleanupBtn') || 'Delete legacy storage data',
      message: getMessage('diagCleanupConfirm') || 'Delete the original chrome.storage browsing history? This is a destructive operation. The data is already copied to SQLite.',
      confirmLabel: getMessage('diagCleanupConfirmLabel') || 'Delete',
      cancelLabel: getMessage('cancel') || 'Cancel',
    });
    if (!confirmed) return;

    cleanupBtn.disabled = true;
    cleanupResult.textContent = getMessage('testing') || 'Working...';
    cleanupResult.className = 'diag-result';

    try {
      const result = await cleanupLegacyStorage();
      if ('data' in result) {
        cleanupResult.textContent = `✓ ${getMessage('diagCleanupDone') || 'Cleanup complete.'} removed=${result.data.removed.length} keys, ${result.data.totalBytes} bytes freed`;
        cleanupResult.style.color = successColor();
      } else {
        cleanupResult.textContent = `✗ ${getMessage('diagCleanupFailed') || 'Cleanup failed.'}: ${result.error}`;
        cleanupResult.style.color = errorColor();
      }
    } catch {
      cleanupResult.textContent = `✗ ${getMessage('diagCleanupFailed') || 'Cleanup failed.'}`;
      cleanupResult.style.color = errorColor();
    } finally {
      cleanupBtn.disabled = false;
    }
  });

  // Built-in AI model download
  builtInAiDownloadBtn?.addEventListener('click', async () => {
    if (!builtInAiDownloadResult) return;
    builtInAiDownloadBtn.disabled = true;
    builtInAiDownloadResult.textContent = getMessage('diagBuiltInAiDownloadStarting') || 'Starting download... 0%';
    builtInAiDownloadResult.className = 'diag-result';

    try {
      const result = await startBuiltInAiDownload((percent) => {
        builtInAiDownloadResult.textContent = `${getMessage('diagBuiltInAiDownloading') || 'Downloading...'} ${percent}%`;
      });

      hooks.onBuiltInAiDownloaded(result);

      if (result.status === 'available') {
        builtInAiDownloadResult.textContent = `✓ ${getMessage('diagBuiltInAiDownloadDone') || 'Download complete.'}`;
        builtInAiDownloadResult.style.color = successColor();
      } else {
        builtInAiDownloadResult.textContent = `✗ ${getMessage('diagBuiltInAiDownloadFailed') || 'Download failed.'}`;
        builtInAiDownloadResult.style.color = errorColor();
      }
    } catch {
      builtInAiDownloadResult.textContent = `✗ ${getMessage('diagBuiltInAiDownloadFailed') || 'Download failed.'}`;
      builtInAiDownloadResult.style.color = errorColor();
    } finally {
      builtInAiDownloadBtn.disabled = false;
    }
  });
}
