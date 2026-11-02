// @vitest-environment jsdom
/**
 * sessionToCollectionHandoff.test.ts (PBI 2026-11-02-05)
 * Panel-level integration: a research session packs to the ids-first v2
 * query, crosses the same draft bus as the history handoff (no silent
 * direct save), restores into the collections editor draft, and resolves
 * in the ask and report scopes (D1/D2 ids consumption, no e2e needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../utils/storage/savedCollectionsRepository.js', () => ({
  getSavedCollections: vi.fn().mockResolvedValue({}),
  duplicateSavedCollectionById: vi.fn().mockResolvedValue(undefined),
  removeSavedCollectionById: vi.fn().mockResolvedValue(undefined),
  upsertSavedCollectionById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../utils/storage/autoTagRulesRepository.js', () => ({
  getAutoTagRules: vi.fn().mockResolvedValue({}),
  getAutoTagApplications: vi.fn().mockResolvedValue([]),
  pruneAutoTagApplications: vi.fn().mockResolvedValue(undefined),
  removeAutoTagRuleById: vi.fn().mockResolvedValue(undefined),
  upsertAutoTagRuleById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn().mockResolvedValue([]),
  removePendingPages: vi.fn().mockResolvedValue(undefined),
}));

import { getSavedCollections, upsertSavedCollectionById } from '../../../../utils/storage/savedCollectionsRepository.js';
import { getAutoTagRules } from '../../../../utils/storage/autoTagRulesRepository.js';
import { createSavedCollectionsPanel } from '../savedCollectionsPanel.js';
import { buildSessionToCollectionQuery } from '../sessionToCollection.js';
import {
  clearHistoryHandoffForTests,
  consumePendingHistoryHandoff,
  requestHistoryHandoff,
} from '../historyHandoff.js';
import { parseCollectionQueryV2 } from '../../../../utils/collectionQueryV2.js';
import { mergeClauseResults } from '../../../../utils/collectionQueryV2.js';
import { normalizeCollectionScope } from '../../../../messaging/responseCanonical.js';
import { buildResearchReportScopeFromCollection } from '../researchReportPanelView.js';
import { tOrKey as t } from '../../../../utils/i18n.js';
import type { SessionInput } from '../../../researchSessionAggregate.js';
import { useTimerClock, waitForMock } from '../../../../../testDir/waitPolicy.js';

const mockedGetSaved = getSavedCollections as unknown as ReturnType<typeof vi.fn>;
const mockedGetRules = getAutoTagRules as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertSavedCollectionById as unknown as ReturnType<typeof vi.fn>;

function at(hour: number, minute = 0, dayOffset = 0): number {
  return new Date(2026, 10, 2 + dayOffset, hour, minute).getTime();
}

function rec(id: number, hour: number, overrides?: Partial<SessionInput>): SessionInput {
  return {
    id,
    url: `https://e.com/${id}`,
    title: `page ${id}`,
    domain: 'e.com',
    tags: '#work',
    created_at: at(hour),
    is_starred: null,
    nav_source_url: null,
    search_query: 'wasm',
    ...overrides,
  };
}

function mountCollectionsSection(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'panel-saved-collections';
  section.innerHTML = `
    <p class="saved-collections-draft" role="status"></p>
    <div id="saved-collections-editor-region"></div>
    <div id="saved-collections-panel-region"></div>`;
  document.body.appendChild(section);
  return section;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSaved.mockResolvedValue({});
  mockedGetRules.mockResolvedValue({});
  clearHistoryHandoffForTests();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('sessionToCollectionHandoff', () => {
  describe('selection to draft restore', () => {
    it('restores the session pins and the uniform clause into the editor draft', async () => {
      useTimerClock();
      const built = buildSessionToCollectionQuery({
        records: [rec(4, 9), rec(2, 10)],
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const section = mountCollectionsSection();
      const panel = createSavedCollectionsPanel();
      panel.mount(section);
      await panel.load?.();

      // The session panel hands the packed query through the shared draft
      // bus (same door as the history handoff): applied, never saved.
      expect(requestHistoryHandoff(built.query)).toBe('applied');

      await waitForMock(() => {
        expect(section.querySelector('.saved-collections-draft')?.textContent).toContain('wasm');
      });
      expect(section.querySelector('.saved-collections-draft')?.textContent).toContain('work');
      expect(section.querySelector<HTMLInputElement>('.clause-search')?.value).toBe('wasm');
      expect(section.querySelector<HTMLInputElement>('.clause-tag')?.value).toBe('work');
      expect(section.querySelector<HTMLInputElement>('.clause-date')?.value).not.toBe('');
      // Naming + save in the collections panel stores the pins: the draft
      // restore carries ids through loadedIds (no silent direct save).
      section.querySelector<HTMLInputElement>('.saved-collection-name-input')!.value = 'Session copy';
      section.querySelector<HTMLButtonElement>('[data-collection-action="save"]')?.click();
      await waitForMock(() => {
        expect(mockedUpsert).toHaveBeenCalledWith(
          expect.any(String),
          'Session copy',
          expect.objectContaining({ ids: [2, 4] }),
          expect.any(Number),
        );
      });
      panel.destroy?.();
    });

    it('lands a pending handoff when the collections panel loads later', async () => {
      useTimerClock();
      const built = buildSessionToCollectionQuery({
        records: [rec(1, 9, { tags: null, search_query: null })],
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      expect(requestHistoryHandoff(built.query)).toBe('pending');
      const section = mountCollectionsSection();
      const panel = createSavedCollectionsPanel();
      panel.mount(section);
      await panel.load?.();

      await waitForMock(() => {
        expect(section.querySelector('.saved-collections-draft')?.textContent).toContain('2026-11-02');
      });
      expect(consumePendingHistoryHandoff()).toBeNull();
      panel.destroy?.();
    });

    it('sends nothing on over-limit refusal, so the draft keeps its empty state', async () => {
      useTimerClock();
      const records = Array.from({ length: 201 }, (_, i) => rec(i + 1, 9));
      const built = buildSessionToCollectionQuery({ records });
      expect(built).toMatchObject({ ok: false, reason: 'over-limit' });

      const section = mountCollectionsSection();
      const panel = createSavedCollectionsPanel();
      panel.mount(section);
      await panel.load?.();

      // The session panel refuses here (no requestHistoryHandoff call), so
      // the bus stays empty and the draft shows the no-condition wording.
      expect(consumePendingHistoryHandoff()).toBeNull();
      expect(section.querySelector('.saved-collections-draft')?.textContent).toBe(
        t('savedCollectionNoCondition'),
      );
      panel.destroy?.();
    });
  });

  describe('saved query resolves in ask/report scopes', () => {
    it('ask scope keeps the pins enforceable (unresolvable stays false)', () => {
      const built = buildSessionToCollectionQuery({
        records: [rec(2, 9), rec(1, 10)],
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const scope = normalizeCollectionScope(built.query);
      expect(scope.unresolvable).toBe(false);
      expect(scope.ids).toEqual([1, 2]);
      expect(scope.clauses).toEqual([
        { tag: 'work', date: expect.any(String) },
      ]);
    });

    it('ask scope stays enforceable for a fully ids-only session query', () => {
      const built = buildSessionToCollectionQuery({
        records: [
          { ...rec(1, 9, { tags: '#a', search_query: 'x' }), created_at: at(23, 50) },
          { ...rec(2, 10, { tags: '#b', search_query: 'y' }), created_at: at(0, 10, 1) },
        ],
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseCollectionQueryV2(built.query).clauses).toEqual([]);
      const scope = normalizeCollectionScope(built.query);
      expect(scope.unresolvable).toBe(false);
      expect(scope.ids).toEqual([1, 2]);
    });

    it('report scope carries pins plus the resolved clause (UNION members)', () => {
      const built = buildSessionToCollectionQuery({
        records: [rec(2, 9), rec(1, 10)],
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const scope = buildResearchReportScopeFromCollection(built.query);
      expect(scope.ids).toEqual([1, 2]);
      expect(scope.tag).toBe('work');
      expect(scope.search).toBe('wasm');
      expect(scope.since).toBeLessThanOrEqual(at(9));
      expect(scope.until).toBeGreaterThanOrEqual(at(10));
    });

    it('report UNION of clause results and pins keeps every pinned id', () => {
      const built = buildSessionToCollectionQuery({
        records: [rec(1, 9), rec(2, 10)],
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const parsed = parseCollectionQueryV2(built.query);
      // A pins-only scope merges zero clauses to empty, never to everything.
      expect(mergeClauseResults([], parsed.op)).toEqual([]);
      const union = [...new Set([...mergeClauseResults([[1]], parsed.op), ...parsed.ids])];
      expect(union).toEqual(expect.arrayContaining([1, 2]));
    });
  });
});
