import { getAuditLogs } from '../../../utils/auditLog.js';
import { type AsyncDataPanel } from '../types.js';

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function createAuditLogPanel(): AsyncDataPanel {
  let list: HTMLElement | null = null;
  let emptyState: HTMLElement | null = null;

  return {
    id: 'panel-audit-log',
    category: 'async-data',
    mount(container) {
      list = container.querySelector('#auditLogList');
      emptyState = container.querySelector('#auditLogEmptyState');
    },
    async loadData() {
      if (!list) return;

      const { rows } = await getAuditLogs({ limit: 100, offset: 0 });

      list.innerHTML = '';

      if (rows.length === 0) {
        if (emptyState) emptyState.hidden = false;
        return;
      }

      if (emptyState) emptyState.hidden = true;

      for (const entry of rows) {
        const row = document.createElement('div');
        row.className = 'audit-log-row';

        const providerSpan = document.createElement('span');
        providerSpan.className = 'audit-log-provider';
        providerSpan.textContent = entry.provider;

        const urlSpan = document.createElement('span');
        urlSpan.className = 'audit-log-url';
        urlSpan.textContent = entry.url;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'audit-log-timestamp';
        timeSpan.textContent = formatTimestamp(entry.created_at);

        row.appendChild(providerSpan);
        row.appendChild(urlSpan);
        row.appendChild(timeSpan);
        list.appendChild(row);
      }
    },
  };
}
