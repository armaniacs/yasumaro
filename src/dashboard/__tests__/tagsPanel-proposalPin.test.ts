// @vitest-environment jsdom
/**
 * tagsPanel-proposalPin.test.ts
 * Behavior pin for a single normalization proposal (PBI 2026-10-23-08):
 * apply/undo through the shared seam keeps the previous button
 * transitions and status text, including the applied-count suffix
 * on failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

const mockQueryLogs = vi.fn();
const mockUpdateLog = vi.fn();

vi.mock('../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  updateLog: (...args: unknown[]) => mockUpdateLog(...args),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = (key: string) => `i18n_${key}`;
  return i18nMock(getMessage);
});

import { initTagsPanel } from '../tagsPanel.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';

function givenRepo(dict: Array<{ from: string; to: string }>): SettingsReader {
  return {
    getMany: vi.fn().mockResolvedValue({
      tag_summary_mode: false,
      tag_categories: [],
      tag_normalization_dict: dict,
    }),
    getAll: vi.fn().mockResolvedValue({}),
  } as unknown as SettingsReader;
}

function fullDom(): void {
  document.body.innerHTML = `
    <input id="tagSummaryMode" type="checkbox" />
    <div id="defaultCategoriesList"></div>
    <input id="newCategoryInput" />
    <button id="addCategoryBtn"></button>
    <button id="saveTagsBtn"></button>
    <div id="userCategoriesList"></div>
    <div id="noUserCategoriesMsg"></div>
    <input id="normFromInput" />
    <input id="normToInput" />
    <button id="addNormEntryBtn"></button>
    <div id="normEntriesList"></div>
    <div id="noNormEntriesMsg"></div>
    <button id="refreshNormProposalsBtn"></button>
    <div id="tagNormProposals"></div>
    <div id="exportImportStatus"></div>
  `;
}

async function showSingleProposal(): Promise<HTMLElement> {
  (document.getElementById('refreshNormProposalsBtn') as HTMLButtonElement).click();
  await waitForMock(() => {
    expect(document.querySelectorAll('.norm-proposal-row')).toHaveLength(1);
  });
  return document.querySelector('.norm-proposal-row') as HTMLElement;
}

async function showTwoProposals(): Promise<HTMLElement[]> {
  (document.getElementById('refreshNormProposalsBtn') as HTMLButtonElement).click();
  await waitForMock(() => {
    expect(document.querySelectorAll('.norm-proposal-row')).toHaveLength(2);
  });
  return Array.from(document.querySelectorAll('.norm-proposal-row'), (el) => el as HTMLElement);
}

describe('tagsPanel — single proposal pin', () => {
  beforeEach(() => {
    mockQueryLogs.mockReset();
    mockUpdateLog.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('applies and undoes a single proposal with unchanged transitions', async () => {
    fullDom();
    const rows = [{ id: 1, tags: 'OldTag', created_at: 1 }];
    mockQueryLogs.mockResolvedValue({ data: { rows } });
    mockUpdateLog.mockResolvedValue({});
    await initTagsPanel(givenRepo([{ from: 'OldTag', to: 'NewTag' }]));

    const row = await showSingleProposal();
    const applyButton = row.querySelector('[data-norm-action="apply"]') as HTMLButtonElement;
    const undoButton = row.querySelector('[data-norm-action="undo"]') as HTMLButtonElement;
    const status = row.querySelector('.norm-proposal-status') as HTMLElement;

    applyButton.click();
    await waitForMock(() => expect(status.textContent).toBe('i18n_normProposalApplied'));
    expect(applyButton.disabled).toBe(true);
    expect(undoButton.hidden).toBe(false);
    expect(mockUpdateLog).toHaveBeenCalledWith(1, { tags: 'NewTag' });

    undoButton.click();
    await waitForMock(() => expect(status.textContent).toBe('i18n_normProposalUndone'));
    expect(undoButton.hidden).toBe(true);
    expect(applyButton.disabled).toBe(false);
  });

  it('restores the apply button with the applied-count suffix when apply fails', async () => {
    fullDom();
    const rows = [
      { id: 1, tags: 'OldTag', created_at: 1 },
      { id: 2, tags: 'OldTag,Keep', created_at: 2 },
    ];
    mockQueryLogs.mockResolvedValue({ data: { rows } });
    mockUpdateLog.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('write failed'));
    await initTagsPanel(givenRepo([{ from: 'OldTag', to: 'NewTag' }]));

    const row = await showSingleProposal();
    const applyButton = row.querySelector('[data-norm-action="apply"]') as HTMLButtonElement;
    const undoButton = row.querySelector('[data-norm-action="undo"]') as HTMLButtonElement;
    const status = row.querySelector('.norm-proposal-status') as HTMLElement;

    applyButton.click();
    await waitForMock(() => expect(status.textContent).toBe('write failed (1 件適用済み)'));
    expect(applyButton.disabled).toBe(false);
    expect(undoButton.hidden).toBe(true);
  });

  it('applies only the second row without touching the first', async () => {
    fullDom();
    const rows = [
      { id: 1, tags: 'OldTag', created_at: 1 },
      { id: 2, tags: 'LegacyTag', created_at: 2 },
    ];
    mockQueryLogs.mockResolvedValue({ data: { rows } });
    mockUpdateLog.mockResolvedValue({});
    await initTagsPanel(
      givenRepo([
        { from: 'OldTag', to: 'NewTag' },
        { from: 'LegacyTag', to: 'ModernTag' },
      ]),
    );

    const proposalRows = await showTwoProposals();
    const [firstRow, secondRow] = proposalRows;
    if (firstRow === undefined || secondRow === undefined) {
      throw new Error('expected two proposal rows');
    }
    const firstApply = firstRow.querySelector(
      '[data-norm-action="apply"]',
    ) as HTMLButtonElement;
    const firstUndo = firstRow.querySelector(
      '[data-norm-action="undo"]',
    ) as HTMLButtonElement;
    const firstStatus = firstRow.querySelector('.norm-proposal-status') as HTMLElement;
    const secondApply = secondRow.querySelector(
      '[data-norm-action="apply"]',
    ) as HTMLButtonElement;
    const secondUndo = secondRow.querySelector(
      '[data-norm-action="undo"]',
    ) as HTMLButtonElement;
    const secondStatus = secondRow.querySelector('.norm-proposal-status') as HTMLElement;

    secondApply.click();
    await waitForMock(() => expect(secondStatus.textContent).toBe('i18n_normProposalApplied'));
    expect(secondApply.disabled).toBe(true);
    expect(secondUndo.hidden).toBe(false);
    expect(mockUpdateLog).toHaveBeenCalledTimes(1);
    expect(mockUpdateLog).toHaveBeenCalledWith(2, { tags: 'ModernTag' });
    expect(firstStatus.textContent).toBe('');
    expect(firstApply.disabled).toBe(false);
    expect(firstUndo.hidden).toBe(true);
  });

  it('routes each row apply to its own tag', async () => {
    fullDom();
    const rows = [
      { id: 1, tags: 'OldTag', created_at: 1 },
      { id: 2, tags: 'LegacyTag', created_at: 2 },
    ];
    mockQueryLogs.mockResolvedValue({ data: { rows } });
    mockUpdateLog.mockResolvedValue({});
    await initTagsPanel(
      givenRepo([
        { from: 'OldTag', to: 'NewTag' },
        { from: 'LegacyTag', to: 'ModernTag' },
      ]),
    );

    const proposalRows = await showTwoProposals();
    const [firstRow, secondRow] = proposalRows;
    if (firstRow === undefined || secondRow === undefined) {
      throw new Error('expected two proposal rows');
    }
    const firstApply = firstRow.querySelector(
      '[data-norm-action="apply"]',
    ) as HTMLButtonElement;
    const firstStatus = firstRow.querySelector('.norm-proposal-status') as HTMLElement;
    const secondApply = secondRow.querySelector(
      '[data-norm-action="apply"]',
    ) as HTMLButtonElement;
    const secondStatus = secondRow.querySelector('.norm-proposal-status') as HTMLElement;

    firstApply.click();
    await waitForMock(() => expect(firstStatus.textContent).toBe('i18n_normProposalApplied'));
    secondApply.click();
    await waitForMock(() => expect(secondStatus.textContent).toBe('i18n_normProposalApplied'));
    expect(mockUpdateLog).toHaveBeenCalledTimes(2);
    expect(mockUpdateLog).toHaveBeenCalledWith(1, { tags: 'NewTag' });
    expect(mockUpdateLog).toHaveBeenCalledWith(2, { tags: 'ModernTag' });
  });
});
