import { exportJson, exportCsv, exportMarkdown, exportDb, downloadText, downloadBlob } from '../../exportLogsService.js';
import { runPanelAction, unwrapServiceResult } from '../panelAction.js';
import { type PanelLifecycle } from '../types.js';
import { queryAuditLogs } from '../../dashboardSqliteService.js';
import { toTsvString } from '../../utils/auditLogTsv.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { getMessageOr, getMessageWithSubstitutions } from '../../../utils/i18n.js';
import { AUDIT_CAP_IDB } from '../../../utils/limits.js';
import { formatLocalDateString } from '../../../utils/localDate.js';

export function createExportLogsPanel(): PanelLifecycle {
  return {
    id: 'panel-export-logs',
    category: 'diagnostic',
    async mount(container) {
      const jsonBtn = container.querySelector('#export-json-btn') as HTMLButtonElement | null;
      const mdBtn = container.querySelector('#export-markdown-btn') as HTMLButtonElement | null;
      const csvBtn = container.querySelector('#export-csv-btn') as HTMLButtonElement | null;
      const statusEl = container.querySelector('#export-status') as HTMLElement | null;
      const dbBtn = container.querySelector('#export-db-btn') as HTMLButtonElement | null;

      const statusTarget = statusEl ?? 'export-status';

      // PBI 2026-10-21-09: the filename carries the LOCAL calendar date (SSOT
      // formatLocalDateString), not the UTC date the old
      // toISOString().split('T')[0] emitted. In JST mornings (00:00-08:59) the
      // UTC date is the previous day, so the filename said "yesterday".
      const exportToday = (ext: string): string => `yasumaro_export_${formatLocalDateString(Date.now())}.${ext}`;

      jsonBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [jsonBtn],
          onStart: () => showStatus(statusTarget, getMessageOr('exportLogsExportingJson', 'Exporting JSON…'), 'updating'),
          run: async () => downloadBlob(await exportJson(), exportToday('json')),
          onSuccess: () => showStatus(statusTarget, getMessageOr('exportLogsJsonCompleted', 'JSON export completed.'), 'success'),
          onError: (message) => showStatus(statusTarget, getMessageWithSubstitutions('exportLogsExportFailed', { message }, 'Export failed: {message}'), 'error'),
        });
      });

      mdBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [mdBtn],
          onStart: () => showStatus(statusTarget, getMessageOr('exportLogsExportingMarkdown', 'Exporting Markdown…'), 'updating'),
          run: async () => downloadText(await exportMarkdown(), exportToday('md'), 'text/markdown'),
          onSuccess: () => showStatus(statusTarget, getMessageOr('exportLogsMarkdownCompleted', 'Markdown export completed.'), 'success'),
          onError: (message) => showStatus(statusTarget, getMessageWithSubstitutions('exportLogsExportFailed', { message }, 'Export failed: {message}'), 'error'),
        });
      });

      csvBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [csvBtn],
          onStart: () => showStatus(statusTarget, getMessageOr('exportLogsExportingCsv', 'Exporting CSV…'), 'updating'),
          run: async () => downloadBlob(await exportCsv(), exportToday('csv')),
          onSuccess: () => showStatus(statusTarget, getMessageOr('exportLogsCsvCompleted', 'CSV export completed.'), 'success'),
          onError: (message) => showStatus(statusTarget, getMessageWithSubstitutions('exportLogsExportFailed', { message }, 'Export failed: {message}'), 'error'),
        });
      });

      dbBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [dbBtn],
          onStart: () => showStatus(statusTarget, getMessageOr('exportLogsExportingDatabase', 'Exporting database…'), 'updating'),
          run: async () => {
            const blob = await exportDb();
            if (blob) downloadBlob(blob, exportToday('db'));
            return blob;
          },
          onSuccess: (blob) => {
            showStatus(
              statusTarget,
              blob
                ? getMessageOr('exportLogsDatabaseCompleted', 'Database export completed.')
                : getMessageOr('exportLogsBinaryRequiresOpfs', 'Binary export requires OPFS storage. Use JSON export instead.'),
              blob ? 'success' : 'error',
            );
          },
          onError: (message) => showStatus(statusTarget, getMessageWithSubstitutions('exportLogsExportFailed', { message }, 'Export failed: {message}'), 'error'),
        });
      });

      // Audit Log TSV Export
      const auditTsvBtn = container.querySelector('#auditLogDownloadTsv') as HTMLButtonElement | null;
      const auditStatusEl = container.querySelector('#auditLogStatus') as HTMLElement | null;

      if (auditTsvBtn) {
        auditTsvBtn.addEventListener('click', () => {
          void runPanelAction({
            buttons: [auditTsvBtn],
            onStart: () => {
              if (auditStatusEl) auditStatusEl.textContent = getMessageOr('exportLogsAuditLoading', '取得中...');
            },
            run: async () => unwrapServiceResult(await queryAuditLogs({ limit: AUDIT_CAP_IDB, offset: 0 })),
            onSuccess: ({ rows, total }) => {
              if (rows.length === 0) {
                if (auditStatusEl) auditStatusEl.textContent = getMessageOr('exportLogsAuditNoData', 'データがありません');
                return;
              }
              // PBI 2026-09-12-17: a backend audit cap (e.g. OPFS 1000) can make
              // `rows` shorter than `total` — reporting success while silently
              // distributing a partial log is worse than stating the limit
              // (mirrors exportLogsService.queryAllData's guard).
              if (total > rows.length) {
                if (auditStatusEl) {
                  auditStatusEl.textContent = getMessageWithSubstitutions(
                    'exportLogsAuditPartial',
                    { shown: rows.length, total },
                    '監査ログは {shown} / {total} 件のみ取得できました（バックエンドの取得上限）。.db エクスポートをご利用ください。',
                  );
                }
                return;
              }
              const tsv = toTsvString(rows);
              // Same local-date contract as exportToday above (PBI 2026-10-21-09).
              const filename = `yasumaro-audit-log-${formatLocalDateString(Date.now())}.tsv`;
              downloadText(tsv, filename, 'text/tab-separated-values');
              if (auditStatusEl) {
                auditStatusEl.textContent = getMessageWithSubstitutions('exportLogsAuditDownloaded', { count: rows.length }, '{count} 件をダウンロードしました');
              }
            },
            // Distinguish "could not read" from "nothing stored": reporting a
            // failed database read as an empty log tells the user their audit
            // history is empty when it may not be.
            onError: (message, kind, cause) => {
              if (auditStatusEl) {
                auditStatusEl.textContent = getMessageWithSubstitutions(
                  'exportLogsAuditError',
                  { error: kind === 'thrown' ? String(cause) : message },
                  'エラー: {error}',
                );
              }
            },
          });
        });
      }
    },
  };
}