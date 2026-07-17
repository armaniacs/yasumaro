import { queryAuditLogs } from '../../../dashboard/dashboardSqliteService.js';
import { type AsyncDataPanel } from '../types.js';

interface AuditLogEntry {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString();
}

function escapeTsvField(value: string): string {
  // TSV fields: quote if the value contains tab, newline, or double-quote
  if (value.includes('\t') || value.includes('\n') || value.includes('"')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function toTsvString(rows: AuditLogEntry[]): string {
  const header = 'id\tprovider\turl\tcreated_at';
  const lines = rows.map((r) =>
    `${r.id}\t${escapeTsvField(r.provider)}\t${escapeTsvField(r.url)}\t${toIsoDate(r.created_at)}`
  );
  return header + '\n' + lines.join('\n') + '\n';
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function todayYyyyMmDd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function createAuditLogPanel(): AsyncDataPanel {
  return {
    id: 'panel-audit-log',
    category: 'async-data',
    mount(container) {
      const downloadBtn = container.querySelector('#auditLogDownloadTsv') as HTMLButtonElement | null;
      const emptyState = container.querySelector('#auditLogEmptyState') as HTMLElement | null;
      const statusEl = container.querySelector('#auditLogStatus') as HTMLElement | null;

      if (!downloadBtn) return;

      downloadBtn.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        if (statusEl) statusEl.textContent = '取得中...';

        try {
          const result = await queryAuditLogs({ limit: 100000, offset: 0 });
          const rows = result?.rows ?? [];

          if (rows.length === 0) {
            if (statusEl) statusEl.textContent = 'データがありません';
            downloadBtn.disabled = false;
            return;
          }

          const tsv = toTsvString(rows);
          const filename = `yasumaro-audit-log-${todayYyyyMmDd()}.tsv`;
          downloadBlob(tsv, filename, 'text/tab-separated-values');

          if (statusEl) statusEl.textContent = `${rows.length} 件をダウンロードしました`;
        } catch (err) {
          if (statusEl) statusEl.textContent = `エラー: ${String(err)}`;
        } finally {
          downloadBtn.disabled = false;
        }
      });
    },
    async loadData() {
      const result = await queryAuditLogs({ limit: 1, offset: 0 });
      const total = result?.total ?? 0;
      const emptyState = document.getElementById('auditLogEmptyState');
      const downloadBtn = document.getElementById('auditLogDownloadTsv') as HTMLButtonElement | null;

      if (total === 0) {
        if (emptyState) emptyState.hidden = false;
        if (downloadBtn) downloadBtn.disabled = true;
      } else {
        if (emptyState) emptyState.hidden = true;
        if (downloadBtn) downloadBtn.disabled = false;
      }
    },
  };
}
