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
import { abortPanelAction, runPanelAction, unwrapServiceResult } from '../panelAction.js';
import {
  startBuiltInAiDownload,
  type BuiltInAiDiagnosticsResult,
} from '../../builtInAiDiagnosticsService.js';
import { runAiConnectionTest } from '../../aiTestRunner.js';

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

/**
 * Wire all action handlers. Each handler routes through runPanelAction:
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
  testObsidianBtn?.addEventListener('click', () => {
    if (!connectionResult) return;
    void runPanelAction({
      buttons: [testObsidianBtn],
      onStart: () => {
        connectionResult.textContent = getMessageOr('testing', 'Testing...');
        connectionResult.className = 'diag-result';
      },
      // PBI 11: the TEST_OBSIDIAN send lives in the connectionTests helper;
      // this handler only renders. Progress choreography is untouched (ADR 2026-08-23).
      run: async () => testObsidianConnection(''),
      onSuccess: (obsidian) => {
        connectionResult.textContent = obsidian
          ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
          : getMessageOr('testComplete', 'Test complete.');
        connectionResult.style.color = obsidian?.success ? successColor() : errorColor();
      },
      onError: () => {
        connectionResult.textContent = getMessageOr('testError', 'Connection test failed.');
        connectionResult.style.color = errorColor();
      },
    });
  });

  // AI connection test
  testAiBtn?.addEventListener('click', () => {
    if (!connectionResult) return;
    // The TEST_AI send lives in the connectionTests helper; the runner owns the
    // runId correlation, progress subscription and in-flight guard, so this
    // handler only supplies the panel's own rendering.
    void runPanelAction({
      buttons: [testAiBtn],
      run: async () => runAiConnectionTest({
        target: connectionResult,
        run: testAiConnection,
        draw: {
          multiProviderSummary: (target, ai) => {
            const header = document.createElement('div');
            header.textContent = ai.success
              ? `AI: ${getMessageOr('testSuccess', '✓ Connection successful')}`
              : `AI: ${getMessageOr('testFailed', '✗ Connection failed')}`;
            header.className = ai.success ? 'diag-success diag-bold' : 'diag-error diag-bold';
            target.appendChild(header);
          },
          singleProviderSummary: (target, ai) => {
            target.textContent = `AI: ${ai.success ? '✓' : '✗'} ${ai.message}`;
            target.className = `diag-result ${ai.success ? 'diag-success' : 'diag-error'}`;
          },
          onError: (target, err) => {
            console.error('Diagnostics: AI test failed', err);
            target.textContent = getMessageOr('testError', 'Connection test failed.');
            target.className = 'diag-result diag-error';
          },
        },
      }),
    });
  });

  // SQLite test
  testSqliteBtn?.addEventListener('click', () => {
    if (!sqliteResult) return;
    void runPanelAction({
      buttons: [testSqliteBtn],
      onStart: () => {
        sqliteResult.textContent = getMessageOr('testing', 'Testing...');
        sqliteResult.className = 'diag-result';
      },
      // PBI 11: status goes through getSqliteStatus() (gateway transport +
      // service conversion) instead of a direct inline send.
      run: async () => getSqliteStatus(),
      onSuccess: (status) => {
        if (status.initialized) {
          const fts5Text = status.fts5 ? 'FTS5 ✓' : 'LIKE fallback';
          sqliteResult.textContent = `✓ ${getMessageOr('diagSqliteTestOk', 'SQLite is working correctly.')} (${fts5Text})`;
          sqliteResult.style.color = successColor();
        } else {
          const errorMsg = status.initError || 'SQLite initialization failed.';
          sqliteResult.textContent = `✗ ${getMessageOr('diagSqliteTestInitFailed', 'SQLite initialization failed.')}\n${errorMsg}`;
          sqliteResult.style.color = errorColor();
        }
      },
      onError: () => {
        sqliteResult.textContent = getMessageOr('testError', 'Connection test failed.');
        sqliteResult.style.color = errorColor();
      },
    });
  });

  // Migrate legacy history to SQLite (destructive-ish, confirmed)
  migrateBtn?.addEventListener('click', () => {
    if (!migrateResult) return;
    // The dialog sits inside the busy scope: while it is open the button stays
    // disabled, so no second action can start underneath it.
    void runPanelAction({
      buttons: [migrateBtn],
      onStart: () => {
        migrateResult.textContent = getMessageOr('testing', 'Working...');
        migrateResult.className = 'diag-result';
      },
      run: async () => {
        const confirmed = await showConfirmDialog({
          title: getMessageOr('diagMigrateBtn', 'Convert history to SQLite'),
          message: getMessageOr('diagMigrateConfirm', 'Convert legacy browsing history into SQLite. The original chrome.storage data is preserved (you can clean it up separately from the diagnostics panel).'),
          confirmLabel: getMessageOr('diagMigrateConfirmLabel', 'Convert'),
          cancelLabel: getMessageOr('cancel', 'Cancel'),
        });
        if (!confirmed) return abortPanelAction();
        return unwrapServiceResult(await migrateLogs());
      },
      onSuccess: (data) => {
        migrateResult.textContent = `✓ ${getMessageOr('diagMigrateDone', 'Conversion complete.')} read=${data.read} inserted=${data.inserted} total=${data.count}`;
        migrateResult.style.color = successColor();
      },
      onError: (message, kind) => {
        const failed = getMessageOr('diagMigrateFailed', 'Conversion failed.');
        migrateResult.textContent = kind === 'service' ? `✗ ${failed}: ${message}` : `✗ ${failed}`;
        migrateResult.style.color = errorColor();
      },
    });
  });

  // Backfill diagnostic metadata
  backfillBtn?.addEventListener('click', () => {
    if (!backfillResult) return;
    void runPanelAction({
      buttons: [backfillBtn],
      onStart: () => {
        backfillResult.textContent = getMessageOr('testing', 'Working...');
        backfillResult.className = 'diag-result';
      },
      run: async () => unwrapServiceResult(await backfillMetadata()),
      onSuccess: (data) => {
        backfillResult.textContent = `✓ ${getMessageOr('diagBackfillDone', 'Backfill complete.')} updated=${data.updated}/${data.total}`;
        backfillResult.style.color = successColor();
      },
      onError: (message, kind) => {
        const failed = getMessageOr('diagBackfillFailed', 'Backfill failed.');
        backfillResult.textContent = kind === 'service' ? `✗ ${failed}: ${message}` : `✗ ${failed}`;
        backfillResult.style.color = errorColor();
      },
    });
  });

  // Manual SQLite → legacy resync (PBI 22, MANUAL-ONLY trigger).
  // No confirm dialog: the merge is idempotent and non-destructive
  // (unlike migrate/cleanup, which use showConfirmDialog above).
  resyncBtn?.addEventListener('click', () => {
    if (!resyncResult) return;
    void runPanelAction({
      buttons: [resyncBtn],
      onStart: () => {
        resyncResult.textContent = getMessageOr('testing', 'Working...');
        resyncResult.className = 'diag-result';
      },
      run: async () => unwrapServiceResult(await resyncLegacyStorage()),
      onSuccess: (data) => {
        resyncResult.textContent = `✓ ${getMessageOr('diagResyncDone', 'Resync complete.')} written=${data.written}/${data.examined} skipped=${data.skipped} total=${data.total}`;
        resyncResult.style.color = successColor();
      },
      onError: (message, kind) => {
        const failed = getMessageOr('diagResyncFailed', 'Resync failed.');
        resyncResult.textContent = kind === 'service' ? `✗ ${failed}: ${message}` : `✗ ${failed}`;
        resyncResult.style.color = errorColor();
      },
    });
  });

  // Cleanup legacy storage (destructive, confirmed)
  cleanupBtn?.addEventListener('click', () => {
    if (!cleanupResult) return;
    // Same busy-scope shape as migrate: the dialog keeps the button disabled.
    void runPanelAction({
      buttons: [cleanupBtn],
      onStart: () => {
        cleanupResult.textContent = getMessageOr('testing', 'Working...');
        cleanupResult.className = 'diag-result';
      },
      run: async () => {
        const confirmed = await showConfirmDialog({
          title: getMessageOr('diagCleanupBtn', 'Delete legacy storage data'),
          message: getMessageOr('diagCleanupConfirm', 'Delete the original chrome.storage browsing history? This is a destructive operation. The data is already copied to SQLite.'),
          confirmLabel: getMessageOr('diagCleanupConfirmLabel', 'Delete'),
          cancelLabel: getMessageOr('cancel', 'Cancel'),
        });
        if (!confirmed) return abortPanelAction();
        return unwrapServiceResult(await cleanupLegacyStorage());
      },
      onSuccess: (data) => {
        cleanupResult.textContent = `✓ ${getMessageOr('diagCleanupDone', 'Cleanup complete.')} removed=${data.removed.length} keys, ${data.totalBytes} bytes freed`;
        cleanupResult.style.color = successColor();
      },
      onError: (message, kind) => {
        const failed = getMessageOr('diagCleanupFailed', 'Cleanup failed.');
        cleanupResult.textContent = kind === 'service' ? `✗ ${failed}: ${message}` : `✗ ${failed}`;
        cleanupResult.style.color = errorColor();
      },
    });
  });

  // Built-in AI model download
  builtInAiDownloadBtn?.addEventListener('click', () => {
    if (!builtInAiDownloadResult) return;
    void runPanelAction({
      buttons: [builtInAiDownloadBtn],
      onStart: () => {
        builtInAiDownloadResult.textContent = getMessageOr('diagBuiltInAiDownloadStarting', 'Starting download... 0%');
        builtInAiDownloadResult.className = 'diag-result';
      },
      run: async () => {
        const result = await startBuiltInAiDownload((percent) => {
          builtInAiDownloadResult.textContent = `${getMessageOr('diagBuiltInAiDownloading', 'Downloading...')} ${percent}%`;
        });
        hooks.onBuiltInAiDownloaded(result);
        return result;
      },
      onSuccess: (result) => {
        if (result.status === 'available') {
          builtInAiDownloadResult.textContent = `✓ ${getMessageOr('diagBuiltInAiDownloadDone', 'Download complete.')}`;
          builtInAiDownloadResult.style.color = successColor();
        } else {
          builtInAiDownloadResult.textContent = `✗ ${getMessageOr('diagBuiltInAiDownloadFailed', 'Download failed.')}`;
          builtInAiDownloadResult.style.color = errorColor();
        }
      },
      onError: () => {
        builtInAiDownloadResult.textContent = `✗ ${getMessageOr('diagBuiltInAiDownloadFailed', 'Download failed.')}`;
        builtInAiDownloadResult.style.color = errorColor();
      },
    });
  });
}
