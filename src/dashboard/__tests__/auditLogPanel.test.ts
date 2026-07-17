// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as svc from '../dashboardSqliteService.js';

vi.mock('../dashboardSqliteService.js', () => ({
  queryAuditLogs: vi.fn(),
}));

const SAMPLE_ROWS = [
  { id: 1, provider: 'gemini', url: 'https://example.com/a', created_at: 1721203200000 },
  { id: 2, provider: 'openai', url: 'https://example.com/b', created_at: 1721289600000 },
];

describe('auditLogPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="panel-audit-log" class="panel">
        <div id="auditLogEmptyState" hidden>empty</div>
        <button id="auditLogDownloadTsv">TSV</button>
        <span id="auditLogStatus"></span>
      </section>
    `;
  });

  it('shows empty state when no audit logs exist', async () => {
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: [], total: 0 });
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');

    const panel = createAuditLogPanel();
    await panel.loadData();

    const empty = document.getElementById('auditLogEmptyState')!;
    expect(empty.hidden).toBe(false);
  });

  it('hides empty state when audit logs exist', async () => {
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: SAMPLE_ROWS, total: 2 });
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');

    const panel = createAuditLogPanel();
    await panel.loadData();

    const empty = document.getElementById('auditLogEmptyState')!;
    expect(empty.hidden).toBe(true);
  });

  it('disables download button when no audit logs exist', async () => {
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: [], total: 0 });
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');

    const panel = createAuditLogPanel();
    await panel.loadData();

    const btn = document.getElementById('auditLogDownloadTsv') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
