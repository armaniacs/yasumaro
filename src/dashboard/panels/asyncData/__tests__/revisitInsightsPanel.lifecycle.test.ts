// @vitest-environment jsdom
/**
 * revisitInsightsPanel lifecycle tests: the four sections render, the empty
 * and error surfaces are distinct, the row cap surfaces, the copy button
 * round-trips Markdown through the clipboard with transient feedback, and
 * domain rows hand off to the history panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();
const mockTryNavigateTyped = vi.fn();
const mockCopyTextToClipboard = vi.fn();

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

vi.mock('../../registryContext.js', () => ({
  tryNavigateTyped: (...args: unknown[]) => mockTryNavigateTyped(...args),
}));

// clipboard.ts lives under src/utils, so the specifier needs one more level
// than the src/dashboard/* mocks above.
vi.mock('../../../../utils/clipboard.js', () => ({
  copyTextToClipboard: (...args: unknown[]) => mockCopyTextToClipboard(...args),
}));

import { createRevisitInsightsPanel } from '../revisitInsightsPanel.js';

const DAY_MS = 86_400_000;

function mountPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="revisitInsightsEmptyState" hidden></div>
    <div id="revisitInsightsRowCap" class="data-table-notice is-warning" hidden></div>
    <table><tbody id="revisitInsightsLoopsBody"></tbody></table>
    <table><tbody id="revisitInsightsRankingBody"></tbody></table>
    <table><tbody id="revisitInsightsDormantBody"></tbody></table>
    <div id="revisitInsightsCapsule"></div>
  `;
  document.body.appendChild(container);
  const panel = createRevisitInsightsPanel();
  panel.mount(container);
  return { panel, container };
}

function row(id: number, url: string, domain: string | null, daysAgo: number, tags: string | null = null) {
  return {
    id,
    url,
    title: `title-${id}`,
    domain,
    tags,
    created_at: Date.now() - daysAgo * DAY_MS,
    visit_duration: null,
  };
}

/** A row set with one of each section populated. */
function sampleRows() {
  return [
    // a.dev: a loop (100d past + 3 distinct recent days) and also the
    // ranking leader (4 distinct days on the same url).
    row(1, 'https://a.dev/p', 'a.dev', 100),
    row(2, 'https://a.dev/p', 'a.dev', 1),
    row(3, 'https://a.dev/p', 'a.dev', 5),
    row(4, 'https://a.dev/p', 'a.dev', 10),
    // b.dev: dormant only (70/80/90 days ago, nothing recent).
    row(5, 'https://b.dev/x', 'b.dev', 70),
    row(6, 'https://b.dev/y', 'b.dev', 80),
    row(7, 'https://b.dev/z', 'b.dev', 90),
    // c.dev: inside the capsule week (364d back lands in the same week).
    row(8, 'https://c.dev/old', 'c.dev', 364),
  ];
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('revisitInsightsPanel — PanelLifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockCopyTextToClipboard.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
    mockCopyTextToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the expected id and category', () => {
    const panel = createRevisitInsightsPanel();
    expect(panel.id).toBe('panel-revisit-insights');
    expect(panel.category).toBe('async-data');
  });

  it('does not throw when load runs before mount', async () => {
    const panel = createRevisitInsightsPanel();
    await expect(panel.load()).resolves.toBeUndefined();
  });

  it('renders loops, ranking, dormant and capsule sections', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 8 } });
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    const loops = document.querySelector('#revisitInsightsLoopsBody')!;
    expect(loops.querySelectorAll('tr').length).toBeGreaterThan(0);
    expect(loops.textContent).toContain('a.dev');

    const ranking = document.querySelector('#revisitInsightsRankingBody')!;
    // The ranking shows the title carried by the most recent visit (id 2, 1 day ago).
    expect(ranking.textContent).toContain('title-2');

    const dormant = document.querySelector('#revisitInsightsDormantBody')!;
    expect(dormant.textContent).toContain('b.dev');

    const capsule = document.querySelector('#revisitInsightsCapsule')!;
    expect(capsule.textContent).toContain('c.dev');
  });

  it('shows the empty state for zero rows and hides it once rows arrive', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    const empty = document.querySelector('#revisitInsightsEmptyState') as HTMLElement;
    expect(empty.hidden).toBe(false);

    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 8 } });
    await panel.load();
    await flush();

    expect(empty.hidden).toBe(true);
  });

  it('shows an error when sqlite is unavailable, then recovers on reload', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    const empty = document.querySelector('#revisitInsightsEmptyState') as HTMLElement;
    expect(empty.hidden).toBe(false);
    // The error surface is the empty element, so it must NOT read as "no records".
    expect(empty.getAttribute('data-i18n')).toBe('revisitInsightsError');
    expect(document.querySelector('#revisitInsightsLoopsBody')!.children.length).toBe(0);

    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 8 } });
    await panel.load();
    await flush();

    expect(document.querySelector('#revisitInsightsLoopsBody')!.children.length).toBeGreaterThan(0);
  });

  it('copies Markdown and restores the idle label after the feedback window', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 8 } });
    const { panel } = mountPanel();

    // Load under real timers (the fetch seam awaits a backoff timer), then
    // switch to fake timers so the 2s feedback reset is instant.
    await panel.load();
    await flush();

    vi.useFakeTimers();
    const copyBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#revisitInsightsLoopsBody button'),
    ).find((b) => b.textContent === 'Copy as Markdown') as HTMLButtonElement;
    expect(copyBtn).toBeDefined();
    const idleLabel = copyBtn.textContent;

    copyBtn.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockCopyTextToClipboard).toHaveBeenCalledTimes(1);
    const markdown = mockCopyTextToClipboard.mock.calls[0]![0] as string;
    expect(markdown).toContain('## a.dev');
    expect(markdown).toContain('](https://a.dev/p)');
    expect(copyBtn.textContent).toBe('Copied');

    await vi.advanceTimersByTimeAsync(2000);
    expect(copyBtn.textContent).toBe(idleLabel);
  });

  it('falls back to a failure label when the clipboard write rejects', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 8 } });
    mockCopyTextToClipboard.mockRejectedValue(new Error('denied'));
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    vi.useFakeTimers();
    const copyBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#revisitInsightsLoopsBody button'),
    ).find((b) => b.textContent === 'Copy as Markdown') as HTMLButtonElement;

    copyBtn.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(copyBtn.textContent).toBe('Copy failed');
  });

  it('navigates to the history panel for a domain loop row', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 8 } });
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    // Find the row whose target cell is a.dev, then its history button.
    const rows = Array.from(document.querySelectorAll('#revisitInsightsLoopsBody tr'));
    const domainRow = rows.find((r) => r.querySelector('th')?.textContent === 'a.dev');
    expect(domainRow).toBeDefined();

    const buttons = Array.from(domainRow!.querySelectorAll('button'));
    const historyBtn = buttons[buttons.length - 1]!;
    historyBtn.click();

    expect(mockTryNavigateTyped).toHaveBeenCalledWith('panel-sqlite-history', {
      searchDomain: 'a.dev',
    });
  });

  it('is safe to destroy twice', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: sampleRows(), total: 8 } });
    const { panel } = mountPanel();

    await panel.load();
    await flush();

    expect(() => {
      panel.destroy();
      panel.destroy();
    }).not.toThrow();
  });
});
