/**
 * diagnosticsActions — user-triggered operations for the diagnostics panel.
 *
 * Owns every button click handler: the three connection tests,
 * the destructive maintenance operations (with confirm dialogs), and the
 * built-in AI model download. Data *collection* lives in DiagnosticsCollector;
 * this module only performs actions and renders their results.
 */

import { getMessageOr } from '../../../utils/i18n.js';
import { UI_COLORS } from '../../../constants/appConstants.js';
import {
  migrateLogs,
  backfillMetadata,
  resyncLegacyStorage,
  cleanupLegacyStorage,
  getSqliteStatus,
} from '../../dashboardSqliteService.js';
import { testObsidianConnection, testAiConnection } from '../../generalSettings/connectionTests.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import {
  startBuiltInAiDownload,
  type BuiltInAiDiagnosticsResult,
} from '../../builtInAiDiagnosticsService.js';
import { formatProviderHeadline, formatProviderDetailLines } from '../../aiTestResultView.js';
import { subscribeAiTestProgress, generateAiTestRunId } from '../../aiTestProgressClient.js';
import {
  buildAiTestProgressView,
  renderAiTestProgressLabel,
  renderAiTestProgressElapsed,
} from '../../aiTestProgressView.js';
import { type AiTestProgress } from '../../../background/ai/AIService.js';

export interface DiagnosticActionElements {
  testObsidianBtn: HTMLButtonElement | null;
  testAiBtn: HTMLButtonElement | null;
  testSqliteBtn: HTMLButtonElement | null;
  migrateBtn: HTMLButtonElement | null;
  backfillBtn: HTMLButtonElement | null;
  resyncBtn: HTMLButtonElement | null;
  cleanupBtn: HTMLButtonElement | null;
  builtInAiDownloadBtn: HTMLButtonElement | null;
  connectionResult: HTMLElement | null;
  sqliteResult: HTMLElement | null;
  migrateResult: HTMLElement | null;
  backfillResult: HTMLElement | null;
  resyncResult: HTMLElement | null;
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

let aiTestInFlight = false;

/**
 * Wire all action handlers. Each handler keeps the current behavior:
 * disable button → "Working..." → try/catch → result text → re-enable in finally.
 */
export function createDiagnosticActions(
  els: DiagnosticActionElements,
  hooks: { onBuiltInAiDownloaded: (result: BuiltInAiDiagnosticsResult) => void },
): void {
  const {
    testObsidianBtn, testAiBtn, testSqliteBtn,
    migrateBtn, backfillBtn, resyncBtn, cleanupBtn, builtInAiDownloadBtn,
    connectionResult, sqliteResult,
    migrateResult, backfillResult, resyncResult, cleanupResult,
    builtInAiDownloadResult,
  } = els;

  // Obsidian connection test
  testObsidianBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    testObsidianBtn.disabled = true;
    connectionResult.textContent = getMessageOr('testing', 'Testing...');
    connectionResult.className = 'diag-result';

    try {
      // PBI 11: the TEST_OBSIDIAN send lives in the connectionTests helper;
      // this handler only renders. Progress choreography is untouched (ADR 2026-08-23).
      const obsidian = await testObsidianConnection('');

      connectionResult.textContent = obsidian
        ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
        : getMessageOr('testComplete', 'Test complete.');
      connectionResult.style.color = obsidian?.success ? successColor() : errorColor();
    } catch {
      connectionResult.textContent = getMessageOr('testError', 'Connection test failed.');
      connectionResult.style.color = errorColor();
    } finally {
      testObsidianBtn.disabled = false;
    }
  });

  // AI connection test
  testAiBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    if (aiTestInFlight) return;
    let elapsedTimer: ReturnType<typeof setInterval> | undefined;
    let unsubscribeProgress: (() => void) | undefined;
    try {
      aiTestInFlight = true;
      testAiBtn.disabled = true;

      const startTime = performance.now();
      // Correlation id so that a concurrent Dashboard tab's progress broadcasts
      // don't leak into this run's UI.
      const runId = generateAiTestRunId();
      let latestProgress: AiTestProgress | undefined;
      let lastProviderKey = '';

      const view = buildAiTestProgressView(connectionResult);

      const updateView = (announceProvider: boolean): void => {
        if (announceProvider) {
          renderAiTestProgressLabel(view, latestProgress);
        }
        renderAiTestProgressElapsed(view, startTime);
      };

      unsubscribeProgress = subscribeAiTestProgress(runId, (progress) => {
        latestProgress = progress;
        const key = `${progress.provider}:${progress.index}`;
        const changed = key !== lastProviderKey;
        lastProviderKey = key;
        updateView(changed);
      });

      renderAiTestProgressLabel(view, undefined);
      renderAiTestProgressElapsed(view, startTime);
      elapsedTimer = setInterval(() => updateView(false), 200);

      // PBI 11: the TEST_AI send lives in the connectionTests helper (runId
      // correlation preserved); this handler only renders progress + results.
      const ai = await testAiConnection(runId);

      if (ai) {
        connectionResult.innerHTML = '';

        if (ai.providers && ai.providers.length > 1) {
          const header = document.createElement('div');
          header.textContent = ai.success
            ? `AI: ${getMessageOr('testSuccess', '✓ Connection successful')}`
            : `AI: ${getMessageOr('testFailed', '✗ Connection failed')}`;
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
        connectionResult.textContent = getMessageOr('testComplete', 'Test complete.');
      }
    } catch (err) {
      console.error('Diagnostics: AI test failed', err);
      connectionResult.textContent = getMessageOr('testError', 'Connection test failed.');
      connectionResult.className = 'diag-result diag-error';
    } finally {
      if (elapsedTimer) clearInterval(elapsedTimer);
      if (unsubscribeProgress) unsubscribeProgress();
      testAiBtn.disabled = false;
      aiTestInFlight = false;
    }
  });

  // SQLite test
  testSqliteBtn?.addEventListener('click', async () => {
    if (!sqliteResult) return;
    testSqliteBtn.disabled = true;
    sqliteResult.textContent = getMessageOr('testing', 'Testing...');
    sqliteResult.className = 'diag-result';

    try {
      // PBI 11: status goes through getSqliteStatus() (gateway transport +
      // service conversion) instead of a direct inline send.
      const status = await getSqliteStatus();

      if (status.initialized) {
        const fts5Text = status.fts5 ? 'FTS5 ✓' : 'LIKE fallback';
        sqliteResult.textContent = `✓ ${getMessageOr('diagSqliteTestOk', 'SQLite is working correctly.')} (${fts5Text})`;
        sqliteResult.style.color = successColor();
      } else {
        const errorMsg = status.initError || 'SQLite initialization failed.';
        sqliteResult.textContent = `✗ ${getMessageOr('diagSqliteTestInitFailed', 'SQLite initialization failed.')}\n${errorMsg}`;
        sqliteResult.style.color = errorColor();
      }
    } catch {
      sqliteResult.textContent = getMessageOr('testError', 'Connection test failed.');
      sqliteResult.style.color = errorColor();
    } finally {
      testSqliteBtn.disabled = false;
    }
  });

  // Migrate legacy history to SQLite (destructive-ish, confirmed)
  migrateBtn?.addEventListener('click', async () => {
    if (!migrateResult) return;
    const confirmed = await showConfirmDialog({
      title: getMessageOr('diagMigrateBtn', 'Convert history to SQLite'),
      message: getMessageOr('diagMigrateConfirm', 'Convert legacy browsing history into SQLite. The original chrome.storage data is preserved (you can clean it up separately from the diagnostics panel).'),
      confirmLabel: getMessageOr('diagMigrateConfirmLabel', 'Convert'),
      cancelLabel: getMessageOr('cancel', 'Cancel'),
    });
    if (!confirmed) return;

    migrateBtn.disabled = true;
    migrateResult.textContent = getMessageOr('testing', 'Working...');
    migrateResult.className = 'diag-result';

    try {
      const result = await migrateLogs();
      if ('data' in result) {
        migrateResult.textContent = `✓ ${getMessageOr('diagMigrateDone', 'Conversion complete.')} read=${result.data.read} inserted=${result.data.inserted} total=${result.data.count}`;
        migrateResult.style.color = successColor();
      } else {
        migrateResult.textContent = `✗ ${getMessageOr('diagMigrateFailed', 'Conversion failed.')}: ${result.error}`;
        migrateResult.style.color = errorColor();
      }
    } catch {
      migrateResult.textContent = `✗ ${getMessageOr('diagMigrateFailed', 'Conversion failed.')}`;
      migrateResult.style.color = errorColor();
    } finally {
      migrateBtn.disabled = false;
    }
  });

  // Backfill diagnostic metadata
  backfillBtn?.addEventListener('click', async () => {
    if (!backfillResult) return;
    backfillBtn.disabled = true;
    backfillResult.textContent = getMessageOr('testing', 'Working...');
    backfillResult.className = 'diag-result';

    try {
      const result = await backfillMetadata();
      if ('data' in result) {
        backfillResult.textContent = `✓ ${getMessageOr('diagBackfillDone', 'Backfill complete.')} updated=${result.data.updated}/${result.data.total}`;
        backfillResult.style.color = successColor();
      } else {
        backfillResult.textContent = `✗ ${getMessageOr('diagBackfillFailed', 'Backfill failed.')}: ${result.error}`;
        backfillResult.style.color = errorColor();
      }
    } catch {
      backfillResult.textContent = `✗ ${getMessageOr('diagBackfillFailed', 'Backfill failed.')}`;
      backfillResult.style.color = errorColor();
    } finally {
      backfillBtn.disabled = false;
    }
  });

  // Manual SQLite → legacy resync (PBI 22, MANUAL-ONLY trigger).
  // No confirm dialog: the merge is idempotent and non-destructive
  // (unlike migrate/cleanup, which use showConfirmDialog above).
  resyncBtn?.addEventListener('click', async () => {
    if (!resyncResult) return;
    resyncBtn.disabled = true;
    resyncResult.textContent = getMessageOr('testing', 'Working...');
    resyncResult.className = 'diag-result';

    try {
      const result = await resyncLegacyStorage();
      if ('data' in result) {
        resyncResult.textContent = `✓ ${getMessageOr('diagResyncDone', 'Resync complete.')} written=${result.data.written}/${result.data.examined} skipped=${result.data.skipped} total=${result.data.total}`;
        resyncResult.style.color = successColor();
      } else {
        resyncResult.textContent = `✗ ${getMessageOr('diagResyncFailed', 'Resync failed.')}: ${result.error}`;
        resyncResult.style.color = errorColor();
      }
    } catch {
      resyncResult.textContent = `✗ ${getMessageOr('diagResyncFailed', 'Resync failed.')}`;
      resyncResult.style.color = errorColor();
    } finally {
      resyncBtn.disabled = false;
    }
  });

  // Cleanup legacy storage (destructive, confirmed)
  cleanupBtn?.addEventListener('click', async () => {
    if (!cleanupResult) return;
    const confirmed = await showConfirmDialog({
      title: getMessageOr('diagCleanupBtn', 'Delete legacy storage data'),
      message: getMessageOr('diagCleanupConfirm', 'Delete the original chrome.storage browsing history? This is a destructive operation. The data is already copied to SQLite.'),
      confirmLabel: getMessageOr('diagCleanupConfirmLabel', 'Delete'),
      cancelLabel: getMessageOr('cancel', 'Cancel'),
    });
    if (!confirmed) return;

    cleanupBtn.disabled = true;
    cleanupResult.textContent = getMessageOr('testing', 'Working...');
    cleanupResult.className = 'diag-result';

    try {
      const result = await cleanupLegacyStorage();
      if ('data' in result) {
        cleanupResult.textContent = `✓ ${getMessageOr('diagCleanupDone', 'Cleanup complete.')} removed=${result.data.removed.length} keys, ${result.data.totalBytes} bytes freed`;
        cleanupResult.style.color = successColor();
      } else {
        cleanupResult.textContent = `✗ ${getMessageOr('diagCleanupFailed', 'Cleanup failed.')}: ${result.error}`;
        cleanupResult.style.color = errorColor();
      }
    } catch {
      cleanupResult.textContent = `✗ ${getMessageOr('diagCleanupFailed', 'Cleanup failed.')}`;
      cleanupResult.style.color = errorColor();
    } finally {
      cleanupBtn.disabled = false;
    }
  });

  // Built-in AI model download
  builtInAiDownloadBtn?.addEventListener('click', async () => {
    if (!builtInAiDownloadResult) return;
    builtInAiDownloadBtn.disabled = true;
    builtInAiDownloadResult.textContent = getMessageOr('diagBuiltInAiDownloadStarting', 'Starting download... 0%');
    builtInAiDownloadResult.className = 'diag-result';

    try {
      const result = await startBuiltInAiDownload((percent) => {
        builtInAiDownloadResult.textContent = `${getMessageOr('diagBuiltInAiDownloading', 'Downloading...')} ${percent}%`;
      });

      hooks.onBuiltInAiDownloaded(result);

      if (result.status === 'available') {
        builtInAiDownloadResult.textContent = `✓ ${getMessageOr('diagBuiltInAiDownloadDone', 'Download complete.')}`;
        builtInAiDownloadResult.style.color = successColor();
      } else {
        builtInAiDownloadResult.textContent = `✗ ${getMessageOr('diagBuiltInAiDownloadFailed', 'Download failed.')}`;
        builtInAiDownloadResult.style.color = errorColor();
      }
    } catch {
      builtInAiDownloadResult.textContent = `✗ ${getMessageOr('diagBuiltInAiDownloadFailed', 'Download failed.')}`;
      builtInAiDownloadResult.style.color = errorColor();
    } finally {
      builtInAiDownloadBtn.disabled = false;
    }
  });
}
