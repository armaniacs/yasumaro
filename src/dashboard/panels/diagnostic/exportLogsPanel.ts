import { exportJson, exportCsv, exportMarkdown, exportDb, downloadText, downloadBlob } from '../../exportLogsService.js';
import { runPanelAction, unwrapServiceResult } from '../panelAction.js';
import { type PanelLifecycle } from '../types.js';
import { queryAuditLogs } from '../../dashboardSqliteService.js';
import { toTsvString } from '../../utils/auditLogTsv.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';

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

      const exportToday = (ext: string): string => `yasumaro_export_${new Date().toISOString().split('T')[0]}.${ext}`;

      jsonBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [jsonBtn],
          onStart: () => showStatus(statusTarget, 'Exporting JSON…', 'success'),
          run: async () => downloadBlob(await exportJson(), exportToday('json')),
          onSuccess: () => showStatus(statusTarget, 'JSON export completed.', 'success'),
          onError: (message) => showStatus(statusTarget, `Export failed: ${message}`, 'error'),
        });
      });

      mdBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [mdBtn],
          onStart: () => showStatus(statusTarget, 'Exporting Markdown…', 'success'),
          run: async () => downloadText(await exportMarkdown(), exportToday('md'), 'text/markdown'),
          onSuccess: () => showStatus(statusTarget, 'Markdown export completed.', 'success'),
          onError: (message) => showStatus(statusTarget, `Export failed: ${message}`, 'error'),
        });
      });

      csvBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [csvBtn],
          onStart: () => showStatus(statusTarget, 'Exporting CSV…', 'success'),
          run: async () => downloadBlob(await exportCsv(), exportToday('csv')),
          onSuccess: () => showStatus(statusTarget, 'CSV export completed.', 'success'),
          onError: (message) => showStatus(statusTarget, `Export failed: ${message}`, 'error'),
        });
      });

      dbBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: [dbBtn],
          onStart: () => showStatus(statusTarget, 'Exporting database…', 'success'),
          run: async () => {
            const blob = await exportDb();
            if (blob) downloadBlob(blob, exportToday('db'));
            return blob;
          },
          onSuccess: (blob) => {
            showStatus(
              statusTarget,
              blob ? 'Database export completed.' : 'Binary export requires OPFS storage. Use JSON export instead.',
              blob ? 'success' : 'error',
            );
          },
          onError: (message) => showStatus(statusTarget, `Export failed: ${message}`, 'error'),
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
              if (auditStatusEl) auditStatusEl.textContent = '取得中...';
            },
            run: async () => unwrapServiceResult(await queryAuditLogs({ limit: 100000, offset: 0 })),
            onSuccess: ({ rows, total }) => {
              if (rows.length === 0) {
                if (auditStatusEl) auditStatusEl.textContent = 'データがありません';
                return;
              }
              // PBI 2026-09-12-17: a backend audit cap (e.g. OPFS 1000) can make
              // `rows` shorter than `total` — reporting success while silently
              // distributing a partial log is worse than stating the limit
              // (mirrors exportLogsService.queryAllData's guard).
              if (total > rows.length) {
                if (auditStatusEl) {
                  auditStatusEl.textContent = `監査ログは ${rows.length} / ${total} 件のみ取得できました（バックエンドの取得上限）。.db エクスポートをご利用ください。`;
                }
                return;
              }
              const tsv = toTsvString(rows);
              const filename = `yasumaro-audit-log-${new Date().toISOString().split('T')[0]}.tsv`;
              downloadText(tsv, filename, 'text/tab-separated-values');
              if (auditStatusEl) auditStatusEl.textContent = `${rows.length} 件をダウンロードしました`;
            },
            // Distinguish "could not read" from "nothing stored": reporting a
            // failed database read as an empty log tells the user their audit
            // history is empty when it may not be.
            onError: (message, kind, cause) => {
              if (auditStatusEl) {
                auditStatusEl.textContent = `エラー: ${kind === 'thrown' ? String(cause) : message}`;
              }
            },
          });
        });
      }
    },
  };
}