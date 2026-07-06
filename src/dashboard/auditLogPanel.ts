/**
 * auditLogPanel.ts
 * Displays cloud AI provider send events (audit log) in the dashboard.
 */

import { getAuditLogs } from '../utils/auditLog.js';
import { getMessage } from '../popup/i18n.js';

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export async function initAuditLogPanel(): Promise<void> {
  const list = document.getElementById('auditLogList');
  const emptyState = document.getElementById('auditLogEmptyState') as HTMLElement | null;
  if (!list) return;

  const { rows } = await getAuditLogs({ limit: 100, offset: 0 });

  list.innerHTML = '';

  if (rows.length === 0) {
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  rows.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'audit-log-row';
    row.innerHTML = `
      <span class="audit-log-provider">${entry.provider}</span>
      <span class="audit-log-url">${entry.url}</span>
      <span class="audit-log-timestamp">${formatTimestamp(entry.created_at)}</span>
    `;
    list.appendChild(row);
  });
}

void getMessage; // reserved for future i18n labels (provider/url/timestamp column headers)
