// @vitest-environment jsdom
/**
 * domainAnalysisPanel-proposalPin.test.ts
 * Behavior pin for a single domain-intel proposal (PBI 2026-10-23-08):
 * apply/undo through the shared seam keeps the previous button
 * transitions and status text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();
const mockTryNavigateTyped = vi.fn();
const mockAddToBlacklist = vi.fn();
const mockRemoveFromBlacklist = vi.fn();

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
  ): string =>
    fallback.replace(/\{(\w+)\}/g, (_, name: string) =>
      subs[name] !== undefined ? String(subs[name]) : `{${name}}`),
  tOrKey: (key: string) => key,
}));

import { createDomainAnalysisPanel } from '../domainAnalysisPanel.js';

function mountPanel() {
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

/** Ten records on one domain: a single proposal with full share. */
function noisyRows(): object[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    url: `https://noisy.com/${i}`,
    title: 't',
    created_at: Date.now() - i,
    domain: 'noisy.com',
    tags: null,
    visit_duration: null,
  }));
}

async function loadSingleProposal(): Promise<HTMLElement> {
  mockQueryLogs.mockResolvedValue({ data: { rows: noisyRows(), total: 10 } });
  const { panel, container } = mountPanel();
  await panel.load?.();
  const rows = container.querySelectorAll('.domain-intel-proposal-row');
  expect(rows).toHaveLength(1);
  return rows[0] as HTMLElement;
}

describe('domainAnalysisPanel — single proposal pin', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockAddToBlacklist.mockReset();
    mockRemoveFromBlacklist.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
    mockAddToBlacklist.mockResolvedValue(undefined);
    mockRemoveFromBlacklist.mockResolvedValue(undefined);
  });

  it('applies and undoes a single proposal with unchanged transitions', async () => {
    const row = await loadSingleProposal();
    const applyButton = row.querySelector('[data-intel-action="apply"]') as HTMLButtonElement;
    const undoButton = row.querySelector('[data-intel-action="undo"]') as HTMLButtonElement;
    const status = row.querySelector('.domain-intel-status') as HTMLElement;

    applyButton.click();
    await waitForMock(() =>
      expect(status.textContent).toBe('noisy.com を記録対象外にしました。'),
    );
    expect(mockAddToBlacklist).toHaveBeenCalledWith('noisy.com');
    expect(applyButton.disabled).toBe(true);
    expect(undoButton.hidden).toBe(false);

    undoButton.click();
    await waitForMock(() =>
      expect(status.textContent).toBe('noisy.com の記録対象外を取り消しました。'),
    );
    expect(mockRemoveFromBlacklist).toHaveBeenCalledWith('noisy.com');
    expect(undoButton.hidden).toBe(true);
    expect(applyButton.disabled).toBe(false);
  });

  it('restores the apply button when apply fails', async () => {
    mockAddToBlacklist.mockRejectedValueOnce(new Error('blacklist write failed'));
    const row = await loadSingleProposal();
    const applyButton = row.querySelector('[data-intel-action="apply"]') as HTMLButtonElement;
    const undoButton = row.querySelector('[data-intel-action="undo"]') as HTMLButtonElement;
    const status = row.querySelector('.domain-intel-status') as HTMLElement;

    applyButton.click();
    await waitForMock(() => expect(status.textContent).toBe('blacklist write failed'));
    expect(applyButton.disabled).toBe(false);
    expect(undoButton.hidden).toBe(true);
  });

  it('wires each proposal row independently when two proposals exist', async () => {
    const rowsFor = (domain: string, base: number): object[] =>
      Array.from({ length: 5 }, (_, i) => ({
        id: base + i,
        url: `https://${domain}/${i}`,
        title: 't',
        created_at: Date.now() - i,
        domain,
        tags: null,
        visit_duration: null,
      }));
    mockQueryLogs.mockResolvedValue({
      data: { rows: [...rowsFor('noisy.com', 1), ...rowsFor('loud.com', 11)], total: 10 },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();
    const rows = container.querySelectorAll('.domain-intel-proposal-row');
    expect(rows).toHaveLength(2);
    const second = Array.from(rows).find((row) =>
      row.textContent?.includes('loud.com'),
    ) as HTMLElement;
    const applyButton = second.querySelector(
      '[data-intel-action="apply"]',
    ) as HTMLButtonElement;
    const status = second.querySelector('.domain-intel-status') as HTMLElement;

    applyButton.click();
    await waitForMock(() =>
      expect(status.textContent).toBe('loud.com を記録対象外にしました。'),
    );
    expect(mockAddToBlacklist).toHaveBeenCalledWith('loud.com');
    expect(applyButton.disabled).toBe(true);
  });
});
