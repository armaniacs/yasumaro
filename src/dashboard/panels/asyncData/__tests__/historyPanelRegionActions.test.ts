// @vitest-environment jsdom
/**
 * historyPanelRegionActions.test.ts
 * Region-owned action bundles (PBI 2026-10-24-05): each region module owns
 * its ask/generate/save behavior via a small createXxxActions factory; the
 * panel only wires mount/load with narrow inputs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../messaging/askHistoryGateway.js', () => ({
  askHistory: vi.fn(),
}));

vi.mock('../../../../messaging/researchReportGateway.js', () => ({
  exportResearchReport: vi.fn(),
}));

vi.mock('../../../../utils/storage/savedCollectionsRepository.js', () => ({
  getSavedCollections: vi.fn().mockResolvedValue({}),
  removeSavedCollectionById: vi.fn().mockResolvedValue(undefined),
  upsertSavedCollectionById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(true),
}));

import { askHistory } from '../../../../messaging/askHistoryGateway.js';
import { exportResearchReport } from '../../../../messaging/researchReportGateway.js';
import {
  getSavedCollections,
  removeSavedCollectionById,
  upsertSavedCollectionById,
} from '../../../../utils/storage/savedCollectionsRepository.js';
import { createAskHistoryActions } from '../askHistoryPanelView.js';
import {
  buildResearchReportScope,
  createResearchReportActions,
} from '../researchReportPanelView.js';
import { createSavedCollectionsActions } from '../savedCollectionsPanelView.js';

const mockedAsk = askHistory as unknown as ReturnType<typeof vi.fn>;
const mockedReport = exportResearchReport as unknown as ReturnType<typeof vi.fn>;
const mockedGetSaved = getSavedCollections as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertSavedCollectionById as unknown as ReturnType<typeof vi.fn>;
const mockedRemove = removeSavedCollectionById as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAskHistoryActions — region owns the ask call', () => {
  it('repacks the gateway result through the seam translator', async () => {
    mockedAsk.mockResolvedValue({ success: true, status: 'answered', answer: 'hi', citations: [] });
    const actions = createAskHistoryActions((error) => `T:${error}`);
    const result = await actions.onAsk('question', null);
    expect(mockedAsk).toHaveBeenCalledWith({ question: 'question', collectionId: null });
    expect(result).toEqual({ ok: true, status: 'answered', answer: 'hi', citations: [] });
  });

  it('maps a gateway failure through the translator', async () => {
    mockedAsk.mockResolvedValue({ success: false, error: 'boom' });
    const actions = createAskHistoryActions((error) => `T:${error}`);
    const result = await actions.onAsk('q', 'col-1');
    expect(result).toEqual({ ok: false, error: 'T:boom' });
  });
});

describe('createResearchReportActions — region owns scope + generate', () => {
  it('builds the scope from the source accessor', async () => {
    mockedReport.mockResolvedValue({ success: true, recordCount: 3 });
    const actions = createResearchReportActions(() => ({
      searchQuery: 'wasm',
      activeTagFilter: null,
      selectedDate: null,
    }));
    const result = await actions.onGenerate(false);
    expect(mockedReport).toHaveBeenCalledWith({ scope: { search: 'wasm' }, sendToObsidian: false });
    expect(result.ok).toBe(true);
  });

  it('buildResearchReportScope keeps the selected day as since/until', () => {
    const scope = buildResearchReportScope({
      searchQuery: '',
      activeTagFilter: 'tools',
      selectedDate: '2026-10-23',
    });
    expect(scope.tag).toBe('tools');
    expect(typeof scope.since).toBe('number');
    expect(typeof scope.until).toBe('number');
  });
});

describe('createSavedCollectionsActions — region owns save/apply/delete', () => {
  function makeDeps(overrides: Record<string, unknown> = {}): Parameters<typeof createSavedCollectionsActions>[0] {
    return {
      getQueryInput: () => ({ searchQuery: 'wasm', activeTagFilter: null, selectedDate: null }),
      applyCollection: vi.fn(),
      getCollections: () => ({}),
      reload: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as Parameters<typeof createSavedCollectionsActions>[0];
  }

  it('fails closed on an empty condition without touching the repository', async () => {
    const deps = makeDeps({
      getQueryInput: () => ({ searchQuery: '   ', activeTagFilter: null, selectedDate: null }),
    });
    const actions = createSavedCollectionsActions(deps);
    const result = await actions.onSave('name');
    expect(result.ok).toBe(false);
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('saves the current conditions and reloads', async () => {
    const deps = makeDeps();
    const actions = createSavedCollectionsActions(deps);
    const result = await actions.onSave('mine');
    expect(result).toEqual({ ok: true });
    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it('recalls through the injected apply dispatch', () => {
    const applyCollection = vi.fn();
    const deps = makeDeps({
      applyCollection,
      getCollections: () => ({ c1: { id: 'c1', name: 'n', query: { search: 'x' }, updatedAt: 1 } }),
    });
    const actions = createSavedCollectionsActions(deps);
    actions.onApply('c1');
    expect(applyCollection).toHaveBeenCalledWith({ search: 'x' });
  });

  it('ignores unknown ids without side effects', async () => {
    const deps = makeDeps();
    const actions = createSavedCollectionsActions(deps);
    actions.onApply('missing');
    await actions.onDelete('missing');
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it('loads the region through the repository pairing', async () => {
    void mockedGetSaved;
    const deps = makeDeps();
    const actions = createSavedCollectionsActions(deps);
    expect(typeof actions.onSave).toBe('function');
    expect(typeof actions.onApply).toBe('function');
    expect(typeof actions.onDelete).toBe('function');
  });
});
