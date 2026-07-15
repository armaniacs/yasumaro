/**
 * auditLogPanel.ts
 * Displays cloud AI provider send events (audit log) in the dashboard.
 */

import { queryAuditLogs } from './dashboardSqliteService.js';
import { getMessage } from '../popup/i18n.js';

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export async function initAuditLogPanel(): Promise<void> {
  const list = document.getElementById('auditLogList');
  const emptyState = document.getElementById('auditLogEmptyState') as HTMLElement | null;
  if (!list) return;

  const result = await queryAuditLogs({ limit: 100, offset: 0 });
  const rows = result?.rows ?? [];

  list.innerHTML = '';

  if (rows.length === 0) {
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  rows.forEach((entry) => {
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
  });
}

void getMessage; // reserved for future i18n labels (provider/url/timestamp column headers)
