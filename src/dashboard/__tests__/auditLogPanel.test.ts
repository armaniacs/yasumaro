import { describe, it, expect, vi, beforeEach } from 'vitest';
import { test } from 'vitest';

// @vitest-environment jsdom

vi.mock('../../utils/auditLog.js');
vi.mock('../../popup/i18n.js', () => ({ getMessage: (key: string) => `i18n_${key}` }));

describe('auditLogPanel', () => {
  beforeEach(() => {
    // Set up a minimal DOM
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="auditLogList"></div>
      <div id="auditLogEmptyState" hidden></div>
    `;
    document.body.appendChild(div);
  });

  it('renders audit log rows when entries exist', async () => {
    const { initAuditLogPanel } = await import('../auditLogPanel.js');
    const auditLog = await import('../../utils/auditLog.js');

    vi.mocked(auditLog.getAuditLogs).mockResolvedValue({
      rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1700000000000 }],
      total: 1,
    });

    await initAuditLogPanel();

    const list = document.getElementById('auditLogList');
    expect(list?.children.length).toBe(1);
    expect(list?.textContent).toContain('gemini');
    expect(list?.textContent).toContain('https://example.com');
  });

  it('shows empty state when no entries exist', async () => {
    const { initAuditLogPanel } = await import('../auditLogPanel.js');
    const auditLog = await import('../../utils/auditLog.js');

    vi.mocked(auditLog.getAuditLogs).mockResolvedValue({ rows: [], total: 0 });

    await initAuditLogPanel();

    const emptyState = document.getElementById('auditLogEmptyState') as HTMLElement;
    expect(emptyState.hidden).toBe(false);
  });
});
