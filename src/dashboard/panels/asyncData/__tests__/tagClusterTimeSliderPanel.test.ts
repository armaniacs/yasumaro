// @vitest-environment jsdom
/**
 * tagClusterTimeSliderPanel behavior (PBI 2026-09-24-08):
 * - Apply fires TWO queryLogs calls with the first/second half bounds derived
 *   from the date inputs (limit 10000 each);
 * - a loadSeq generation guard makes rapid applies render only the latest;
 * - one-side-empty renders the empty state on that side only, the other side
 *   normally, and classifies the diff against the empty side;
 * - the diff list renders four sections with counts and clickable tags;
 * - row-cap notices appear per half; inverted inputs are auto-corrected;
 * - common tags share the same --tag-hue across both SVGs;
 * - the aria-live status region announces loading and completion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();
const mockTryNavigateTyped = vi.fn();

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
  getRegistry: () => ({ navigateTyped: vi.fn(), navigate: vi.fn() }),
  tryNavigateTyped: (...args: unknown[]) => mockTryNavigateTyped(...args),
}));

import { createTagClusterTimeSliderPanel } from '../tagClusterTimeSliderPanel.js';
import { tagHue } from '../../../tagClusterColor.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface MockRow {
  id: number;
  url: string;
  title: string;
  tags: string | null;
  created_at: number;
}

function makeRows(tags: string): MockRow[] {
  return [
    { id: 1, url: 'https://example.com/a', title: 'A', tags, created_at: 1_700_000_000_000 },
    { id: 2, url: 'https://example.com/b', title: 'B', tags, created_at: 1_700_000_100_000 },
  ];
}

function mountPanel() {
  const container = document.createElement('div');

  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.id = 'tagCompareStartDate';
  startInput.value = '2026-09-01';
  container.appendChild(startInput);

  const endInput = document.createElement('input');
  endInput.type = 'date';
  endInput.id = 'tagCompareEndDate';
  endInput.value = '2026-09-30';
  container.appendChild(endInput);

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.id = 'tagCompareRunBtn';
  container.appendChild(runBtn);

  const validation = document.createElement('div');
  validation.id = 'tagCompareValidation';
  validation.hidden = true;
  container.appendChild(validation);

  const corrected = document.createElement('div');
  corrected.id = 'tagCompareCorrectedNotice';
  corrected.hidden = true;
  container.appendChild(corrected);

  const status = document.createElement('p');
  status.id = 'tagCompareStatus';
  status.setAttribute('aria-live', 'polite');
  container.appendChild(status);

  const grid = document.createElement('div');
  grid.className = 'tag-cluster-compare-grid';
  container.appendChild(grid);

  for (const side of ['First', 'Second'] as const) {
    const wrap = document.createElement('div');
    const cap = document.createElement('div');
    cap.id = `tagCompare${side}CapNotice`;
    cap.hidden = true;
    wrap.appendChild(cap);
    const empty = document.createElement('div');
    empty.id = `tagCompare${side}Empty`;
    empty.hidden = true;
    wrap.appendChild(empty);
    const truncated = document.createElement('div');
    truncated.id = `tagCompare${side}Truncated`;
    truncated.hidden = true;
    wrap.appendChild(truncated);
    for (const suffix of ['ZoomIn', 'ZoomOut', 'ZoomReset']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `tagCompare${side}${suffix}`;
      wrap.appendChild(button);
    }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = `tagCompare${side}Svg`;
    svg.setAttribute('width', '480');
    svg.setAttribute('height', '420');
    wrap.appendChild(svg);
    grid.appendChild(wrap);
  }

  const diffList = document.createElement('div');
  diffList.id = 'tagCompareDiffList';
  container.appendChild(diffList);

  document.body.appendChild(container);
  const panel = createTagClusterTimeSliderPanel();
  panel.mount(container);
  return {
    panel,
    container,
    startInput,
    endInput,
    runBtn,
    validation,
    corrected,
    status,
    diffList,
    firstSvg: container.querySelector('#tagCompareFirstSvg') as unknown as SVGSVGElement,
    secondSvg: container.querySelector('#tagCompareSecondSvg') as unknown as SVGSVGElement,
    firstEmpty: container.querySelector('#tagCompareFirstEmpty') as HTMLElement,
    secondEmpty: container.querySelector('#tagCompareSecondEmpty') as HTMLElement,
    firstCap: container.querySelector('#tagCompareFirstCapNotice') as HTMLElement,
    secondCap: container.querySelector('#tagCompareSecondCapNotice') as HTMLElement,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface QueryArgs {
  since: number;
  until: number;
  limit: number;
}

function queryArgs(callIndex: number): QueryArgs {
  return mockQueryLogs.mock.calls[callIndex]![0] as QueryArgs;
}

/** Local epoch-ms equivalents the panel derives from the date inputs. */
function expectedBounds(startIso: string, endIso: string): { since: number; until: number; mid: number } {
  const since = new Date(`${startIso}T00:00:00`).getTime();
  const until = new Date(`${endIso}T23:59:59.999`).getTime();
  const mid = since + Math.floor((until - since) / 2);
  return { since, until, mid };
}

/** Deferred queryLogs: each call records its args and a manual resolver. */
function deferQueryLogs(): Array<{ args: QueryArgs; resolve: (value: unknown) => void }> {
  const pending: Array<{ args: QueryArgs; resolve: (value: unknown) => void }> = [];
  mockQueryLogs.mockImplementation(
    (args: QueryArgs) =>
      new Promise((resolve) => {
        pending.push({ args, resolve });
      })
  );
  return pending;
}

function svgTagTexts(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll('text.tag-cluster-text')).map((t) => t.textContent);
}

describe('tagClusterTimeSliderPanel — lifecycle (PBI 2026-09-24-08)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('has correct id and category and a safe lifecycle without mount', async () => {
    const panel = createTagClusterTimeSliderPanel();
    expect(panel.id).toBe('panel-tag-cluster-time-slider');
    expect(panel.category).toBe('async-data');
    expect(() => panel.destroy?.()).not.toThrow();
    // load() without mount finds no inputs and must not query or throw.
    await expect(panel.load?.()).resolves.toBeUndefined();
    expect(mockQueryLogs).not.toHaveBeenCalled();
  });

  it('Apply triggers two queryLogs calls with first/second half bounds', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeRows('#rust #web'), total: 2 } });
    const { panel, runBtn } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    const { since, until, mid } = expectedBounds('2026-09-01', '2026-09-30');
    expect(queryArgs(0)).toEqual({ since, until: mid, limit: 10000 });
    expect(queryArgs(1)).toEqual({ since: mid, until, limit: 10000 });
    expect(runBtn.tagName).toBe('BUTTON');
  });

  it('renders both SVGs and shares the stable hue for common tags', async () => {
    mockQueryLogs.mockImplementation(() => {
      const isFirst = mockQueryLogs.mock.calls.length === 1;
      return Promise.resolve({
        data: { rows: makeRows(isFirst ? '#rust #web' : '#rust #ai'), total: 2 },
      });
    });
    const { panel, firstSvg, secondSvg } = mountPanel();
    await panel.load?.();

    expect(svgTagTexts(firstSvg)).toEqual(expect.arrayContaining(['#rust', '#web']));
    expect(svgTagTexts(secondSvg)).toEqual(expect.arrayContaining(['#rust', '#ai']));

    // Same tag → same --tag-hue custom property on both sides.
    const hue = String(tagHue('rust'));
    const rustCircles = Array.from(
      document.querySelectorAll<SVGElement>('circle.tag-cluster-compare-node')
    ).filter((c) => c.querySelector('title')?.textContent?.startsWith('#rust '));
    expect(rustCircles.length).toBe(2);
    for (const circle of rustCircles) {
      expect(circle.style.getPropertyValue('--tag-hue')).toBe(hue);
    }
  });

  it('rapid applies render only the latest window (stale halves bail via the generation guard)', async () => {
    const pending = deferQueryLogs();
    const { panel, runBtn, startInput, endInput, firstSvg, secondSvg } = mountPanel();

    // Apply 1 (default window): both independent halves fire in parallel.
    void panel.load?.();
    await flush();
    expect(mockQueryLogs).toHaveBeenCalledTimes(2);

    // Apply 2: inputs change and Compare fires while apply 1 is still pending.
    startInput.value = '2026-09-05';
    endInput.value = '2026-09-25';
    runBtn.click();
    await flush();
    expect(mockQueryLogs).toHaveBeenCalledTimes(4);

    // Resolving the STALE halves must bail: no render into the SVGs.
    pending[0]!.resolve({ data: { rows: makeRows('#stale-tag'), total: 2 } });
    await flush();
    pending[1]!.resolve({ data: { rows: makeRows('#stale-second'), total: 2 } });
    await flush();
    expect(svgTagTexts(firstSvg)).not.toContain('#stale-tag');
    expect(svgTagTexts(secondSvg)).not.toContain('#stale-second');

    // The latest halves proceed: rendering waits for BOTH fresh halves.
    pending[2]!.resolve({ data: { rows: makeRows('#fresh-half'), total: 2 } });
    await flush();
    expect(svgTagTexts(firstSvg)).not.toContain('#fresh-half');

    pending[3]!.resolve({ data: { rows: makeRows('#fresh-second'), total: 2 } });
    await flush();

    expect(svgTagTexts(firstSvg)).toContain('#fresh-half');
    expect(svgTagTexts(secondSvg)).toContain('#fresh-second');
    expect(svgTagTexts(firstSvg)).not.toContain('#stale-tag');
    expect(svgTagTexts(secondSvg)).not.toContain('#stale-second');
    expect(firstSvg.querySelectorAll('circle.tag-cluster-compare-node').length).toBeGreaterThan(0);
    expect(secondSvg.querySelectorAll('circle.tag-cluster-compare-node').length).toBeGreaterThan(0);
    // No query after apply 2 ever carried the stale window's mid boundary.
    const { mid: mid1 } = expectedBounds('2026-09-01', '2026-09-30');
    const laterSinces = mockQueryLogs.mock.calls.slice(2).map((c) => (c[0] as QueryArgs).since);
    expect(laterSinces).not.toContain(mid1);
  });

  it('one-side-empty shows the empty state on that side and classifies the diff against it', async () => {
    mockQueryLogs.mockResolvedValueOnce({ data: { rows: [], total: 0 } }); // first half empty
    mockQueryLogs.mockResolvedValue({ data: { rows: makeRows('#only-late #late-two'), total: 2 } });
    const { panel, firstEmpty, secondEmpty, firstSvg, secondSvg, diffList } = mountPanel();
    await panel.load?.();

    expect(firstEmpty.hidden).toBe(false);
    expect(secondEmpty.hidden).toBe(true);
    expect(firstSvg.querySelectorAll('circle.tag-cluster-compare-node').length).toBe(0);
    expect(secondSvg.querySelectorAll('circle.tag-cluster-compare-node').length).toBeGreaterThan(0);

    // Empty first half → every second-half tag is "appeared"; no inc/dec.
    const headings = Array.from(diffList.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings).toEqual(['Appeared tags', 'Disappeared tags', 'Increased tags', 'Decreased tags']);
    const lists = Array.from(diffList.querySelectorAll('ul'));
    const appearedTags = Array.from(lists[0]!.querySelectorAll('button')).map((b) => b.textContent);
    expect(appearedTags).toEqual(['#late-two', '#only-late']);
    expect(lists[1]!.querySelectorAll('li').length).toBe(0);
    expect(lists[2]!.querySelectorAll('li').length).toBe(0);
    expect(lists[3]!.querySelectorAll('li').length).toBe(0);
  });

  it('renders the four diff sections with categories from the two halves', async () => {
    mockQueryLogs.mockImplementation(() => {
      const isFirst = mockQueryLogs.mock.calls.length === 1;
      return Promise.resolve({
        data: { rows: makeRows(isFirst ? '#a #b #c' : '#a #b #d'), total: 2 },
      });
    });
    const { panel, diffList } = mountPanel();
    await panel.load?.();

    const headings = Array.from(diffList.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings).toEqual(['Appeared tags', 'Disappeared tags', 'Increased tags', 'Decreased tags']);
    const lists = Array.from(diffList.querySelectorAll('ul'));
    expect(Array.from(lists[0]!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['#d']);
    expect(Array.from(lists[1]!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['#c']);
    expect(lists[2]!.querySelectorAll('li').length).toBe(0);
    expect(lists[3]!.querySelectorAll('li').length).toBe(0);
  });

  it('shows increased/decreased entries with deltas and clickable tag buttons', async () => {
    mockQueryLogs.mockImplementation(() => {
      const isFirst = mockQueryLogs.mock.calls.length === 1;
      return Promise.resolve({
        data: {
          rows: isFirst
            ? [
                { id: 1, url: 'u', title: 't', tags: '#hot #gone', created_at: 1 },
                { id: 2, url: 'u', title: 't', tags: '#hot', created_at: 2 },
                { id: 3, url: 'u', title: 't', tags: '#hot', created_at: 3 },
              ]
            : [
                { id: 4, url: 'u', title: 't', tags: '#hot #new', created_at: 4 },
                { id: 5, url: 'u', title: 't', tags: '#hot #new', created_at: 5 },
                { id: 6, url: 'u', title: 't', tags: '#hot #new', created_at: 6 },
                { id: 7, url: 'u', title: 't', tags: '#hot #new', created_at: 7 },
                { id: 8, url: 'u', title: 't', tags: '#other', created_at: 8 },
              ],
          total: isFirst ? 3 : 5,
        },
      });
    });
    const { panel, diffList } = mountPanel();
    await panel.load?.();

    // #hot: 3 → 4 (increased +1); #new/#other appeared; #gone disappeared.
    const lists = Array.from(diffList.querySelectorAll('ul'));
    expect(Array.from(lists[0]!.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      '#new', '#other',
    ]);
    expect(Array.from(lists[1]!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['#gone']);
    const increased = lists[2]!.querySelector('li')!;
    expect(increased.querySelector('button')!.textContent).toBe('#hot');
    expect(increased.querySelector('.tag-cluster-diff-delta')!.textContent).toBe('+1');
    expect(lists[3]!.querySelectorAll('li').length).toBe(0);

    // Click a diff tag → navigate-to-history with the raw tag name.
    mockTryNavigateTyped.mockClear();
    (lists[0]!.querySelector('button') as HTMLButtonElement).click();
    expect(mockTryNavigateTyped).toHaveBeenCalledWith(
      'panel-sqlite-history',
      expect.objectContaining({ searchTag: 'new' }),
      expect.any(Function),
    );
  });

  it('shows per-half row-cap notices when a half exceeds the fetch limit', async () => {
    mockQueryLogs.mockResolvedValueOnce({
      data: { rows: makeRows('#rust'), total: 12_345 },
    });
    mockQueryLogs.mockResolvedValue({
      data: { rows: makeRows('#rust'), total: 1 },
    });
    const { panel, firstCap, secondCap } = mountPanel();
    await panel.load?.();

    expect(firstCap.hidden).toBe(false);
    expect(firstCap.textContent).toContain('12345');
    expect(firstCap.textContent).toContain('10000');
    expect(secondCap.hidden).toBe(true);
  });

  it('auto-corrects an inverted window: swaps inputs, shows the notice, queries corrected bounds', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeRows('#rust'), total: 2 } });
    const { panel, startInput, endInput, corrected, validation, runBtn } = mountPanel();
    startInput.value = '2026-09-20';
    endInput.value = '2026-09-01';

    runBtn.click();
    await flush();

    expect(startInput.value).toBe('2026-09-01');
    expect(endInput.value).toBe('2026-09-20');
    expect(corrected.hidden).toBe(false);
    expect(validation.hidden).toBe(true);

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    const { since, until, mid } = expectedBounds('2026-09-01', '2026-09-20');
    expect(queryArgs(0)).toEqual({ since, until: mid, limit: 10000 });
    expect(queryArgs(1)).toEqual({ since: mid, until, limit: 10000 });
  });

  it('shows the validation message and no query when a date input is empty', async () => {
    const { panel, startInput, validation, runBtn } = mountPanel();
    startInput.value = '';

    runBtn.click();
    await flush();

    expect(validation.hidden).toBe(false);
    expect(validation.textContent).toContain('start');
    expect(mockQueryLogs).not.toHaveBeenCalled();
  });

  it('announces loading and completion on the aria-live status region', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: makeRows('#rust'), total: 2 } });
    const { panel, status } = mountPanel();
    await panel.load?.();

    expect(status.getAttribute('aria-live')).toBe('polite');
    // Two rows share one tag → 1 node per half, 0 diff entries.
    expect(status.textContent).toContain('first half 1 tags');
    expect(status.textContent).toContain('0 appeared');
  });

  it('clears the diff list when a half fails instead of fabricating appeared entries', async () => {
    mockQueryLogs.mockResolvedValueOnce({ data: { rows: makeRows('#rust'), total: 2 } });
    mockQueryLogs.mockResolvedValue({ error: 'sqlite unavailable' });
    const { panel, diffList, secondEmpty, status, firstSvg } = mountPanel();
    await panel.load?.();

    expect(secondEmpty.hidden).toBe(false);
    // Unified failure policy: the failed half's empty element carries the
    // distinct error wording.
    expect(secondEmpty.getAttribute('data-i18n')).toBe('tagClusterTimeSliderError');
    expect(diffList.querySelectorAll('ul').length).toBe(0);
    expect(status.textContent).toContain('Failed');
    // The healthy side's loading overlay must not stay frozen on screen.
    expect(firstSvg.querySelector('.tag-cluster-loading-overlay')).toBeNull();
  });

  it('destroy is safe to call twice and stops further renders', async () => {
    const pending = deferQueryLogs();
    const { panel, firstSvg } = mountPanel();
    void panel.load?.();
    await flush();
    expect(() => {
      panel.destroy?.();
      panel.destroy?.();
    }).not.toThrow();

    // Resolving after destroy must not render into the stale SVG.
    pending[0]!.resolve({ data: { rows: makeRows('#after-destroy'), total: 2 } });
    await flush();
    expect(firstSvg.querySelectorAll('circle.tag-cluster-compare-node').length).toBe(0);
  });
});
