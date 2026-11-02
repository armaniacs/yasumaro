/**
 * historyHandoff.test.ts (PBI 2026-11-02-03)
 * History → collection handoff: the pure triple packer and the draft bus.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildHistoryHandoffQuery,
  requestHistoryHandoff,
  consumePendingHistoryHandoff,
  registerCollectionDraftApplier,
  unregisterCollectionDraftApplier,
  clearHistoryHandoffForTests,
} from '../historyHandoff.js';

afterEach(() => {
  clearHistoryHandoffForTests();
});

describe('historyHandoff', () => {
  describe('buildHistoryHandoffQuery', () => {
    it('packs the full state triple into one query record', () => {
      const result = buildHistoryHandoffQuery(
        { searchQuery: 'wasm', activeTagFilter: 'tools', selectedDate: '2026-11-02' },
        null,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.query).toEqual({ search: 'wasm', tag: 'tools', date: '2026-11-02' });
    });

    it('packs a partial triple (search only)', () => {
      const result = buildHistoryHandoffQuery(
        { searchQuery: 'wasm', activeTagFilter: null, selectedDate: null },
        null,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.query).toEqual({ search: 'wasm' });
    });

    it('refuses an empty triple with the empty reason (no-condition wording family)', () => {
      const result = buildHistoryHandoffQuery(
        { searchQuery: '   ', activeTagFilter: null, selectedDate: null },
        null,
      );
      expect(result).toEqual({ ok: false, reason: 'empty', dropped: [] });
    });

    it('refuses a custom range even when the triple is non-empty (no silent drop)', () => {
      const result = buildHistoryHandoffQuery(
        { searchQuery: 'wasm', activeTagFilter: null, selectedDate: null },
        { since: 100, until: 200 },
      );
      expect(result).toEqual({ ok: false, reason: 'custom-range', dropped: [] });
    });

    it('names the range refusal before the empty check (range alone, empty triple)', () => {
      const result = buildHistoryHandoffQuery(
        { searchQuery: '', activeTagFilter: null, selectedDate: null },
        { since: 100, until: 200 },
      );
      expect(result).toEqual({ ok: false, reason: 'custom-range', dropped: [] });
    });

    it('reports no dropped conditions while state holds only the triple', () => {
      const result = buildHistoryHandoffQuery(
        { searchQuery: 'wasm', activeTagFilter: null, selectedDate: null },
        null,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.dropped).toEqual([]);
    });
  });

  describe('handoff bus', () => {
    it('applies immediately when the collections draft applier is registered', () => {
      const applier = vi.fn();
      registerCollectionDraftApplier(applier);
      const where = requestHistoryHandoff({ search: 'wasm' });
      expect(where).toBe('applied');
      expect(applier).toHaveBeenCalledWith({ search: 'wasm' });
      expect(consumePendingHistoryHandoff()).toBeNull();
    });

    it('stashes one pending query when nothing is registered, consumed once', () => {
      const where = requestHistoryHandoff({ search: 'wasm' });
      expect(where).toBe('pending');
      expect(consumePendingHistoryHandoff()).toEqual({ search: 'wasm' });
      expect(consumePendingHistoryHandoff()).toBeNull();
    });

    it('returns null when nothing is pending', () => {
      expect(consumePendingHistoryHandoff()).toBeNull();
    });

    it('unregistering stops immediate apply and falls back to pending', () => {
      const applier = vi.fn();
      registerCollectionDraftApplier(applier);
      unregisterCollectionDraftApplier();
      expect(requestHistoryHandoff({ search: 'wasm' })).toBe('pending');
      expect(applier).not.toHaveBeenCalled();
    });
  });
});
