// @vitest-environment jsdom
/**
 * domainAnalysisPanel-intelBranches.test.ts
 * PBI 2026-10-23-10 — 情報源の偏りと見直し提案の分岐ピン.
 * The unit pin (domainIntelAggregate.test.ts) covers the pure judgment;
 * the proposal pin (domainAnalysisPanel-proposalPin.test.ts) covers one
 * apply/undo row. This file pins the panel branches in between:
 * few-records 縮退, enough-but-quiet (bias shown, no proposals), the empty
 * set (no intel surface), and that a load alone never writes the blacklist
 * (自動除外はしない).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();
const mockTryNavigateTyped = vi.fn();
const mockAddToBlacklist = vi.fn();
const mockRemoveFromBlacklist = vi.fn();
const seenSubs: Array<{ key: string; subs: Record<string, string | number> }> = [];

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

vi.mock('../../../../utils/storage/domainIntelRepository.js', () => ({
  addDomainToBlacklist: (...args: unknown[]) => mockAddToBlacklist(...args),
  removeDomainFromBlacklist: (...args: unknown[]) => mockRemoveFromBlacklist(...args),
}));

vi.mock('../../../../utils/i18n.js', () => ({
  getMessageOr: (key: string, fallback: string) => fallback,
  getMessageWithSubstitutions: (
    key: string,
    subs: Record<string, string | number>,
    fallback: string,
  ): string => {
    seenSubs.push({ key, subs });
    return fallback.replace(/\{(\w+)\}/g, (_, name: string) =>
      subs[name] !== undefined ? String(subs[name]) : `{${name}}`);
  },
  tOrKey: (key: string) => key,
}));

import { createDomainAnalysisPanel } from '../domainAnalysisPanel.js';

function mountPanel(): { panel: ReturnType<typeof createDomainAnalysisPanel>; container: HTMLElement } {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="domainAnalysisFilter"></div>
    <label for="domainAnalysisTagInput">Tag</label>
    <input type="text" id="domainAnalysisTagInput">
    <button type="button" id="domainAnalysisRunBtn">Run</button>
    <div id="domainAnalysisEmptyState" hidden></div>
    <p id="domainAnalysisUnknownNotice" aria-live="polite" hidden></p>
    <div id="domainAnalysisRowCap" class="data-table-notice is-warning" hidden></div>
    <table><tbody id="domainAnalysisDomainBody"></tbody></table>
    <div id="domainAnalysisDomainTruncated" class="data-table-notice is-warning" hidden></div>
    <table><tbody id="domainAnalysisUrlBody"></tbody></table>
    <div id="domainAnalysisUrlTruncated" class="data-table-notice is-warning" hidden></div>
    <div id="domainIntelBiasLine" hidden></div>
    <div id="domainIntelProposals" hidden></div>
  `;
  document.body.appendChild(container);
  const panel = createDomainAnalysisPanel();
  panel.mount(container);
  return { panel, container };
}

function rowsFor(domain: string, count: number, baseId: number): object[] {
  return Array.from({ length: count }, (_, i) => ({
    id: baseId + i,
    url: `https://${domain}/${i}`,
    title: 't',
    created_at: Date.now() - (baseId + i),
    domain,
    tags: null,
    visit_duration: null,
  }));
}

describe('domainAnalysisPanel — intel branches', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    seenSubs.length = 0;
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockAddToBlacklist.mockReset();
    mockRemoveFromBlacklist.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('shows the few-records retreat and no proposals below the minimum', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: [...rowsFor('a.example', 3, 1), ...rowsFor('b.example', 2, 4)], total: 5 },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const biasLine = container.querySelector('#domainIntelBiasLine') as HTMLElement;
    expect(biasLine.hidden).toBe(false);
    // 少件数の縮退: the reason names the count instead of asserting a share.
    expect(biasLine.textContent).toContain('5');
    expect((container.querySelector('#domainIntelProposals') as HTMLElement).hidden).toBe(true);
    expect(container.querySelectorAll('.domain-intel-proposal-row')).toHaveLength(0);
    // 自動除外はしない: rendering the retreat writes nothing.
    expect(mockAddToBlacklist).not.toHaveBeenCalled();
    expect(mockRemoveFromBlacklist).not.toHaveBeenCalled();
  });

  it('shows the bias basis with no proposals when no domain is loud', async () => {
    // 4/3/3: enough records, but every share stays below the 50% proposal line.
    mockQueryLogs.mockResolvedValue({
      data: {
        rows: [...rowsFor('a.example', 4, 1), ...rowsFor('b.example', 3, 5), ...rowsFor('c.example', 3, 8)],
        total: 10,
      },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const biasLine = container.querySelector('#domainIntelBiasLine') as HTMLElement;
    expect(biasLine.hidden).toBe(false);
    expect(biasLine.textContent).toContain('a.example');
    // 根拠 (件数・期間・算出式) rides the message substitutions, not just prose.
    const biasCall = seenSubs.find((call) => call.key === 'domainIntel_biasLine');
    expect(biasCall).toBeDefined();
    expect(biasCall!.subs['domain']).toBe('a.example');
    expect(biasCall!.subs['total']).toBe(10);
    expect(biasCall!.subs['percent']).toBe(40);
    expect(String(biasCall!.subs['formula'])).toContain('4');
    expect(String(biasCall!.subs['period'])).not.toBe('');
    expect((container.querySelector('#domainIntelProposals') as HTMLElement).hidden).toBe(true);
    expect(mockAddToBlacklist).not.toHaveBeenCalled();
  });

  it('hides the whole intel section when the fetch is empty', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect((container.querySelector('#domainAnalysisEmptyState') as HTMLElement).hidden).toBe(false);
    expect((container.querySelector('#domainIntelBiasLine') as HTMLElement).hidden).toBe(true);
    expect((container.querySelector('#domainIntelProposals') as HTMLElement).hidden).toBe(true);
    expect(mockAddToBlacklist).not.toHaveBeenCalled();
    expect(mockRemoveFromBlacklist).not.toHaveBeenCalled();
  });

  it('never writes the blacklist while rendering a loud fetch', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: rowsFor('noisy.com', 10, 1), total: 10 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelectorAll('.domain-intel-proposal-row')).toHaveLength(1);
    // The proposal waits for the user action: load alone applies nothing.
    expect(mockAddToBlacklist).not.toHaveBeenCalled();
    expect(mockRemoveFromBlacklist).not.toHaveBeenCalled();
  });
});
