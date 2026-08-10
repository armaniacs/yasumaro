import { exportJson, exportCsv, exportMarkdown, exportDb, downloadText, downloadBlob } from '../../exportLogsService.js';
import { type DiagnosticPanel } from '../types.js';
import { queryAuditLogs } from '../../dashboardSqliteService.js';
import { toTsvString } from '../../utils/auditLogTsv.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { errorMessage } from '../../../utils/errorUtils.js';

export function createExportLogsPanel(): DiagnosticPanel {
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

      jsonBtn?.addEventListener('click', async () => {
        try {
          showStatus(statusTarget, 'Exporting JSON…', 'success');
          const blob = await exportJson();
          downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.json`);
          showStatus(statusTarget, 'JSON export completed.', 'success');
        } catch (err) {
          showStatus(statusTarget, `Export failed: ${errorMessage(err)}`, 'error');
        }
      });

      mdBtn?.addEventListener('click', async () => {
        try {
          showStatus(statusTarget, 'Exporting Markdown…', 'success');
          const md = await exportMarkdown();
          downloadText(md, `yasumaro_export_${new Date().toISOString().split('T')[0]}.md`, 'text/markdown');
          showStatus(statusTarget, 'Markdown export completed.', 'success');
        } catch (err) {
          showStatus(statusTarget, `Export failed: ${errorMessage(err)}`, 'error');
        }
      });

      csvBtn?.addEventListener('click', async () => {
        try {
          showStatus(statusTarget, 'Exporting CSV…', 'success');
          const blob = await exportCsv();
          downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.csv`);
          showStatus(statusTarget, 'CSV export completed.', 'success');
        } catch (err) {
          showStatus(statusTarget, `Export failed: ${errorMessage(err)}`, 'error');
        }
      });

      dbBtn?.addEventListener('click', async () => {
        try {
          showStatus(statusTarget, 'Exporting database…', 'success');
          const blob = await exportDb();
          if (blob) {
            downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.db`);
            showStatus(statusTarget, 'Database export completed.', 'success');
          } else {
            showStatus(statusTarget, 'Binary export requires OPFS storage. Use JSON export instead.', 'error');
          }
        } catch (err) {
          showStatus(statusTarget, `Export failed: ${errorMessage(err)}`, 'error');
        }
      });

      // Audit Log TSV Export
      const auditTsvBtn = container.querySelector('#auditLogDownloadTsv') as HTMLButtonElement | null;
      const auditStatusEl = container.querySelector('#auditLogStatus') as HTMLElement | null;

      if (auditTsvBtn) {
        auditTsvBtn.addEventListener('click', async () => {
          auditTsvBtn.disabled = true;
          if (auditStatusEl) auditStatusEl.textContent = '取得中...';
          try {
            const result = await queryAuditLogs({ limit: 100000, offset: 0 });
            // Distinguish "could not read" from "nothing stored": reporting a
            // failed database read as an empty log tells the user their audit
            // history is empty when it may not be.
            if ('error' in result) {
              if (auditStatusEl) auditStatusEl.textContent = `エラー: ${result.error}`;
              return;
            }
            const rows = result.data.rows;
            if (rows.length === 0) {
              if (auditStatusEl) auditStatusEl.textContent = 'データがありません';
              return;
            }
            const tsv = toTsvString(rows);
            const filename = `yasumaro-audit-log-${new Date().toISOString().split('T')[0]}.tsv`;
            downloadText(tsv, filename, 'text/tab-separated-values');
            if (auditStatusEl) auditStatusEl.textContent = `${rows.length} 件をダウンロードしました`;
          } catch (err) {
            if (auditStatusEl) auditStatusEl.textContent = `エラー: ${String(err)}`;
          } finally {
            auditTsvBtn.disabled = false;
          }
        });
      }
    },
  };
}
