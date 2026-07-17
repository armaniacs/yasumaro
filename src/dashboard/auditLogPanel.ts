/**
 * auditLogPanel.ts
 * Legacy audit log panel — simplified to TSV download only.
 */

import { queryAuditLogs } from './dashboardSqliteService.js';

function todayYyyyMmDd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function initAuditLogPanel(): Promise<void> {
  const downloadBtn = document.getElementById('auditLogDownloadTsv') as HTMLButtonElement | null;
  const emptyState = document.getElementById('auditLogEmptyState') as HTMLElement | null;
  const statusEl = document.getElementById('auditLogStatus') as HTMLElement | null;

  if (!downloadBtn) return;

  const result = await queryAuditLogs({ limit: 1, offset: 0 });
  const total = result?.total ?? 0;

  if (total === 0) {
    if (emptyState) emptyState.hidden = false;
    downloadBtn.disabled = true;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    if (statusEl) statusEl.textContent = '取得中...';

    try {
      const data = await queryAuditLogs({ limit: 100000, offset: 0 });
      const rows = data?.rows ?? [];

      if (rows.length === 0) {
        if (statusEl) statusEl.textContent = 'データがありません';
        downloadBtn.disabled = false;
        return;
      }

      // Build TSV
      const header = 'id\tprovider\turl\tcreated_at';
      const lines = rows.map((r) =>
        `${r.id}\t${r.provider}\t${r.url}\t${new Date(r.created_at).toISOString()}`
      );
      const tsv = header + '\n' + lines.join('\n') + '\n';

      const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yasumaro-audit-log-${todayYyyyMmDd()}.tsv`;
      a.click();
      URL.revokeObjectURL(url);

      if (statusEl) statusEl.textContent = `${rows.length} 件をダウンロードしました`;
    } catch (err) {
      if (statusEl) statusEl.textContent = `エラー: ${String(err)}`;
    } finally {
      downloadBtn.disabled = false;
    }
  });
}
