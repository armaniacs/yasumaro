import { exportJson, exportCsv, exportMarkdown, exportDb, downloadText, downloadBlob } from '../../exportLogsService.js';
import { type DiagnosticPanel } from '../types.js';

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

      const showStatus = (msg: string, isError = false) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.display = '';
        statusEl.style.color = isError ? 'var(--color-error)' : 'var(--color-success-text)';
        setTimeout(() => { statusEl!.style.display = 'none'; }, 3000);
      };

      jsonBtn?.addEventListener('click', async () => {
        try {
          showStatus('Exporting JSON…');
          const blob = await exportJson();
          downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.json`);
          showStatus('JSON export completed.');
        } catch (err) {
          showStatus(`Export failed: ${err}`, true);
        }
      });

      mdBtn?.addEventListener('click', async () => {
        try {
          showStatus('Exporting Markdown…');
          const md = await exportMarkdown();
          downloadText(md, `yasumaro_export_${new Date().toISOString().split('T')[0]}.md`, 'text/markdown');
          showStatus('Markdown export completed.');
        } catch (err) {
          showStatus(`Export failed: ${err}`, true);
        }
      });

      csvBtn?.addEventListener('click', async () => {
        try {
          showStatus('Exporting CSV…');
          const blob = await exportCsv();
          downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.csv`);
          showStatus('CSV export completed.');
        } catch (err) {
          showStatus(`Export failed: ${err}`, true);
        }
      });

      dbBtn?.addEventListener('click', async () => {
        try {
          showStatus('Exporting database…');
          const blob = await exportDb();
          if (blob) {
            downloadBlob(blob, `yasumaro_export_${new Date().toISOString().split('T')[0]}.db`);
            showStatus('Database export completed.');
          } else {
            showStatus('Binary export requires OPFS storage. Use JSON export instead.', true);
          }
        } catch (err) {
          showStatus(`Export failed: ${err}`, true);
        }
      });
    },
    async refresh() {
      // no dynamic data to refresh
    },
  };
}
