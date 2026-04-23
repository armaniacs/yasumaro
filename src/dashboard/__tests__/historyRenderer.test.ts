// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHistoryEntries } from '../historyRenderer.js';
import type { HistoryPanelState, HistoryElements, TagEditElements } from '../historyState.js';
import type { SavedUrlEntry } from '../../utils/storageUrls.js';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

const mockMakeRow = vi.fn();
const mockPagination = vi.fn();

vi.mock('../historyEntryRow.js', () => ({
  makeHistoryEntryRow: (...args: unknown[]) => mockMakeRow(...args),
}));

vi.mock('../historyUtils.js', () => ({
  createPaginationControls: (...args: unknown[]) => mockPagination(...args),
}));

describe('renderHistoryEntries', () => {
  beforeEach(() => {
    mockMakeRow.mockReset();
    mockPagination.mockReset();
    mockMakeRow.mockReturnValue(document.createElement('div'));
    mockPagination.mockReturnValue(document.createElement('nav'));
  });

  it('returns early if historyList is missing', () => {
    const state = { entries: [], historyCurrentPage: 0 } as HistoryPanelState;
    const elements = { historyList: null } as unknown as HistoryElements;
    renderHistoryEntries(state, elements, {} as TagEditElements, '', () => {}, () => {});
    expect(mockMakeRow).not.toHaveBeenCalled();
  });

  it('renders empty message when no entries', () => {
    document.body.innerHTML = '<div id="historyList"></div><div id="historyStats"></div>';
    const state = { entries: [], historyCurrentPage: 0, activeFilter: 'all', activeTagFilter: null } as HistoryPanelState;
    const elements = {
      historyList: document.getElementById('historyList'),
      historyStats: document.getElementById('historyStats'),
    } as HistoryElements;
    renderHistoryEntries(state, elements, {} as TagEditElements, '', () => {}, () => {});
    expect(elements.historyList!.innerHTML).toContain('historyEmpty');
  });

  it('renders entry rows for current page', () => {
    document.body.innerHTML = '<div id="historyList"></div><div id="historyStats"></div>';
    const entries: SavedUrlEntry[] = [
      { url: 'https://example.com/1', timestamp: 1 },
      { url: 'https://example.com/2', timestamp: 2 },
    ] as SavedUrlEntry[];
    const state = { entries, historyCurrentPage: 0, activeFilter: 'all', activeTagFilter: null } as HistoryPanelState;
    const elements = {
      historyList: document.getElementById('historyList'),
      historyStats: document.getElementById('historyStats'),
    } as HistoryElements;
    renderHistoryEntries(state, elements, {} as TagEditElements, '', () => {}, () => {});
    expect(mockMakeRow).toHaveBeenCalledTimes(2);
  });

  it('adds pagination when totalPages > 1', () => {
    document.body.innerHTML = '<div id="historyList"></div><div id="historyStats"></div>';
    const entries: SavedUrlEntry[] = Array.from({ length: 15 }, (_, i) => ({
      url: `https://example.com/${i}`,
      timestamp: i,
    })) as SavedUrlEntry[];
    const state = { entries, historyCurrentPage: 0, activeFilter: 'all', activeTagFilter: null } as HistoryPanelState;
    const elements = {
      historyList: document.getElementById('historyList'),
      historyStats: document.getElementById('historyStats'),
    } as HistoryElements;
    renderHistoryEntries(state, elements, {} as TagEditElements, '', () => {}, () => {});
    expect(mockPagination).toHaveBeenCalledTimes(1);
  });
});
