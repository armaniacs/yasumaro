// @vitest-environment jsdom
/**
 * visitDurationPanel lifecycle tests: ranked tables, empty/all-null states,
 * truncation notices, and period-filter since/until propagation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  getSqliteStatus: (...args: unknown[]) => mockGetSqliteStatus(...args),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/retry.js')>();
  return {
    retryWithExponentialBackoff: (fn: () => Promise<unknown>, options: Record<string, unknown> = {}) =>
      actual.retryWithExponentialBackoff(fn as never, { ...options, baseDelayMs: 0, maxDelayMs: 0 }),
  };
});

import { createVisitDurationPanel } from '../visitDurationPanel.js';

function mountPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="visitDurationFilter"></div>
    <p id="visitDurationUnmeasuredRatio" hidden></p>
    <div id="visitDurationEmptyState" hidden></div>
    <div id="visitDurationAllUnmeasured" hidden></div>
    <table><tbody id="visitDurationDomainBody"></tbody></table>
    <div id="visitDurationDomainTruncated" hidden></div>
    <table><tbody id="visitDurationTagBody"></tbody></table>
    <div id="visitDurationTagTruncated" hidden></div>
  `;
  document.body.appendChild(container);
  const panel = createVisitDurationPanel();
  panel.mount(container);
  return { panel, container };
}

function row(id: number, domain: string | null, tags: string | null, visit_duration: number | null) {
  return { id, url: 'https://example.com/', title: 't', created_at: Date.now(), domain, tags, visit_duration };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('visitDurationPanel — PanelLifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('has correct id and category', () => {
    const { panel } = mountPanel();
    expect(panel.id).toBe('panel-visit-duration');
    expect(panel.category).toBe('async-data');
  });

  it('load without mount is safe', async () => {
    const p = createVisitDurationPanel();
    await expect(p.load?.()).resolves.toBeUndefined();
  });

  it('renders domain and tag rankings with totals/avgs/counts plus the ratio', async () => {
    mockQueryLogs.mockResolvedValue({
      data: {
        rows: [
          row(1, 'a.com', '#x', 30_000),
          row(2, 'a.com', '#x', 10_000),
          row(3, 'b.com', null, 50_000),
          row(4, 'c.com', null, null),
        ],
        total: 4,
      },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const domainRows = container.querySelectorAll('#visitDurationDomainBody tr');
    expect(domainRows).toHaveLength(2);
    expect(domainRows[0]!.textContent).toContain('b.com');
    expect(domainRows[0]!.textContent).toContain('50s');
    expect(domainRows[1]!.textContent).toContain('a.com');
    expect(domainRows[1]!.textContent).toContain('40s');

    const tagRows = container.querySelectorAll('#visitDurationTagBody tr');
    expect(tagRows).toHaveLength(1);
    expect(tagRows[0]!.textContent).toContain('x');

    const ratio = container.querySelector('#visitDurationUnmeasuredRatio')!;
    expect(ratio.hidden).toBe(false);
    expect(ratio.textContent).toContain('25%');
    expect(container.querySelector('#visitDurationEmptyState')!.hidden).toBe(true);
    expect(container.querySelector('#visitDurationAllUnmeasured')!.hidden).toBe(true);
  });

  it('shows the empty state when 0 rows are returned', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#visitDurationEmptyState')!.hidden).toBe(false);
    expect(container.querySelectorAll('#visitDurationDomainBody tr')).toHaveLength(0);
    expect(container.querySelector('#visitDurationUnmeasuredRatio')!.hidden).toBe(true);
  });

  it('shows a distinct error message when the query keeps failing, and resets on recovery', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'sqlite unavailable' });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const emptyState = container.querySelector('#visitDurationEmptyState')!;
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.getAttribute('data-i18n')).toBe('visitDurationError');
    expect(emptyState.textContent).toContain('Failed to load');

    // A subsequent successful load resets to the normal empty binding.
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    await panel.load?.();

    const recovered = container.querySelector('#visitDurationEmptyState')!;
    expect(recovered.getAttribute('data-i18n')).toBe('visitDurationEmpty');
    expect(recovered.textContent).toBe('No browsing records in this period.');
    expect(recovered.hidden).toBe(false);
  });

  it('issues a single query on first open (no duplicate mount fetch)', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel } = mountPanel();
    // PBI 2026-09-24-11: construction emits nothing, so mounting alone
    // cannot fetch; load() fetches exactly once.
    expect(mockQueryLogs).not.toHaveBeenCalled();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
  });

  it('shows the all-null state when every duration is unmeasured', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: [row(1, 'a.com', '#x', null), row(2, 'b.com', null, null)], total: 2 },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#visitDurationAllUnmeasured')!.hidden).toBe(false);
    expect(container.querySelector('#visitDurationEmptyState')!.hidden).toBe(true);
    expect(container.querySelectorAll('#visitDurationDomainBody tr')).toHaveLength(0);
    const ratio = container.querySelector('#visitDurationUnmeasuredRatio')!;
    expect(ratio.hidden).toBe(false);
    expect(ratio.textContent).toContain('100%');
  });

  it('shows truncation notices beyond the top 20', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row(i + 1, `d${i}.com`, `#t${i}`, (i + 1) * 1_000),
    );
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 25 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelectorAll('#visitDurationDomainBody tr')).toHaveLength(20);
    const domainNotice = container.querySelector('#visitDurationDomainTruncated')!;
    const tagNotice = container.querySelector('#visitDurationTagTruncated')!;
    expect(domainNotice.hidden).toBe(false);
    expect(domainNotice.textContent).toContain('25');
    expect(tagNotice.hidden).toBe(false);
  });

  it('passes the chosen preset since/until to queryLogs', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    (container.querySelector('button[data-preset="last7"]') as HTMLButtonElement).click();
    await flush();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalled();
    const args = mockQueryLogs.mock.calls[mockQueryLogs.mock.calls.length - 1]![0] as {
      since: number;
      until: number;
      limit: number;
    };
    expect(args.limit).toBe(10000);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(args.until - args.since).toBeGreaterThanOrEqual(sevenDaysMs - 60_000);
    expect(args.until - args.since).toBeLessThanOrEqual(sevenDaysMs + 60_000);
  });

  it('tag click navigates to history with the tag', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: [row(1, 'a.com', '#x', 30_000)], total: 1 },
    });
    const seen: unknown[] = [];
    document.addEventListener('navigate-to-tag', (e) => seen.push((e as CustomEvent).detail));
    const { panel, container } = mountPanel();
    await panel.load?.();

    const tagBtn = container.querySelector(
      '#visitDurationTagBody button.visit-duration-tag-btn',
    ) as HTMLButtonElement;
    expect(tagBtn).not.toBeNull();
    tagBtn.click();
    expect(seen).toEqual(['x']);
  });
});
