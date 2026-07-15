import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// @vitest-environment jsdom

vi.mock('../../dashboard/dashboardSqliteService.js');
vi.mock('../../popup/i18n.js', () => ({ getMessage: (key: string) => `i18n_${key}` }));

function createPanelDom(): void {
  const section = document.createElement('section');
  section.id = 'panel-audit-log';
  section.innerHTML = `
    <input type="text" id="auditLogSearch" placeholder="search">
    <select id="auditLogProviderFilter"><option value="">all</option></select>
    <span id="auditLogCount"></span>
    <div id="auditLogEmptyState" hidden>empty</div>
    <div id="auditLogTableWrapper">
      <table id="auditLogTable">
        <thead>
          <tr>
            <th data-sort="provider"><button type="button" class="audit-log-sort-btn">Provider <span class="sort-icon"></span></button></th>
            <th data-sort="url"><button type="button" class="audit-log-sort-btn">URL <span class="sort-icon"></span></button></th>
            <th data-sort="created_at"><button type="button" class="audit-log-sort-btn">Date <span class="sort-icon"></span></button></th>
          </tr>
        </thead>
        <tbody id="auditLogBody"></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(section);
}

const SAMPLE_ROWS = [
  { id: 1, provider: 'gemini', url: 'https://example.com/a', created_at: 1700000002000 },
  { id: 2, provider: 'openai', url: 'https://example.com/b', created_at: 1700000001000 },
  { id: 3, provider: 'gemini', url: 'https://other.com/c', created_at: 1700000003000 },
];

describe('auditLogPanel', () => {
  beforeEach(() => {
    createPanelDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders table rows when entries exist', async () => {
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');
    const svc = await import('../../dashboard/dashboardSqliteService.js');
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: SAMPLE_ROWS, total: 3 });

    const panel = createAuditLogPanel();
    const container = document.getElementById('panel-audit-log')!;
    panel.mount(container);
    await panel.loadData();

    const tbody = document.getElementById('auditLogBody')!;
    expect(tbody.children.length).toBe(3);
    expect(tbody.textContent).toContain('gemini');
    expect(tbody.textContent).toContain('openai');
  });

  it('shows empty state when no entries', async () => {
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');
    const svc = await import('../../dashboard/dashboardSqliteService.js');
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: [], total: 0 });

    const panel = createAuditLogPanel();
    const container = document.getElementById('panel-audit-log')!;
    panel.mount(container);
    await panel.loadData();

    const emptyState = document.getElementById('auditLogEmptyState')!;
    expect(emptyState.hidden).toBe(false);
  });

  it('filters by provider', async () => {
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');
    const svc = await import('../../dashboard/dashboardSqliteService.js');
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: SAMPLE_ROWS, total: 3 });

    const panel = createAuditLogPanel();
    const container = document.getElementById('panel-audit-log')!;
    panel.mount(container);
    await panel.loadData();

    const select = document.getElementById('auditLogProviderFilter') as HTMLSelectElement;
    select.value = 'openai';
    select.dispatchEvent(new Event('change'));

    const tbody = document.getElementById('auditLogBody')!;
    expect(tbody.children.length).toBe(1);
    expect(tbody.textContent).toContain('openai');
  });

  it('filters by search text', async () => {
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');
    const svc = await import('../../dashboard/dashboardSqliteService.js');
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: SAMPLE_ROWS, total: 3 });

    const panel = createAuditLogPanel();
    const container = document.getElementById('panel-audit-log')!;
    panel.mount(container);
    await panel.loadData();

    const input = document.getElementById('auditLogSearch') as HTMLInputElement;
    input.value = 'other.com';
    input.dispatchEvent(new Event('input'));

    const tbody = document.getElementById('auditLogBody')!;
    expect(tbody.children.length).toBe(1);
    expect(tbody.textContent).toContain('other.com');
  });

  it('sorts by provider when column header clicked', async () => {
    const { createAuditLogPanel } = await import('../panels/asyncData/auditLogPanel.js');
    const svc = await import('../../dashboard/dashboardSqliteService.js');
    vi.mocked(svc.queryAuditLogs).mockResolvedValue({ rows: SAMPLE_ROWS, total: 3 });

    const panel = createAuditLogPanel();
    const container = document.getElementById('panel-audit-log')!;
    panel.mount(container);
    await panel.loadData();

    const providerBtn = container.querySelector('[data-sort="provider"] .audit-log-sort-btn') as HTMLButtonElement;
    providerBtn.click();

    const tbody = document.getElementById('auditLogBody')!;
    const firstCell = tbody.children[0]?.querySelector('.audit-log-provider');
    expect(firstCell?.textContent).toBe('gemini');
    const lastCell = tbody.children[tbody.children.length - 1]?.querySelector('.audit-log-provider');
    expect(lastCell?.textContent).toBe('openai');
  });
});
