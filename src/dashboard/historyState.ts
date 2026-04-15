import type { SavedUrlEntry } from '../utils/storageUrls.js';
import type { PendingPage } from '../utils/pendingStorage.js';
import { getMessage } from '../popup/i18n.js';

export const HISTORY_PAGE_SIZE = 10;

const i18nCache: Map<string, string> = new Map();

export function getCachedMessage(key: string, fallback: string): string {
  const cached = i18nCache.get(key);
  if (cached !== undefined) return cached;
  const value = getMessage(key) || fallback;
  i18nCache.set(key, value);
  return value;
}

export type FilterType = 'all' | 'auto' | 'manual' | 'skipped' | 'masked' | 'cleansed';

export interface HistoryElements {
  historyList: HTMLElement;
  historyStats: HTMLElement | null;
  historySearchInput: HTMLInputElement | null;
  pendingSection: HTMLElement | null;
  pendingList: HTMLElement | null;
  filterBtns: NodeListOf<HTMLButtonElement>;
}

export interface TagEditElements {
  tagEditModal: HTMLElement | null;
  closeTagEditModalBtn: HTMLButtonElement | null;
  tagEditUrl: HTMLElement | null;
  currentTagsList: HTMLElement | null;
  noCurrentTagsMsg: HTMLElement | null;
  tagCategorySelect: HTMLSelectElement | null;
  addTagBtn: HTMLButtonElement | null;
  saveTagEditsBtn: HTMLButtonElement | null;
}

export interface HistoryPanelState {
  entries: SavedUrlEntry[];
  activeFilter: FilterType;
  activeTagFilter: string | null;
  historyCurrentPage: number;
  pendingPages: PendingPage[];
  pendingUrlSet: Set<string>;
  editingUrl: string | null;
  editingTags: string[];
  tagEditTrapId: string | null;
}

export function createInitialState(): HistoryPanelState {
  return {
    entries: [],
    activeFilter: 'all',
    activeTagFilter: null,
    historyCurrentPage: 0,
    pendingPages: [],
    pendingUrlSet: new Set(),
    editingUrl: null,
    editingTags: [],
    tagEditTrapId: null,
  };
}
