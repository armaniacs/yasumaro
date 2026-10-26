/**
 * sessionTimelinePanel.test.ts
 * PBI 2026-10-22-04 box (a) ― playback-view panel wiring: the row adapter
 * (null-safe mapping), the caller-side private-record exclusion, and the
 * render reaching both the original URL (anchor) and the original record
 * (button via onOpenRecord).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  buildPlaybackModel,
  isPlaybackExcluded,
  renderPlayback,
  toSessionTimelineRecord,
} from '../sessionTimelinePanel.js';
import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';

function makeEntry(overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id: 1,
    url: 'https://example.com/p1',
    title: 'Page 1',
    created_at: 1000,
    domain: 'example.com',
    ...overrides,
  };
}

describe('sessionTimelinePanel', () => {
  describe('toSessionTimelineRecord', () => {
    it('maps SQLite NULLs to absent fields so the aggregate stays fail-closed', () => {
      const record = toSessionTimelineRecord(
        makeEntry({ visit_duration: null, scroll_ratio: null, nav_source_url: null, search_query: null }),
      );
      expect(record.visitDuration).toBeUndefined();
      expect(record.scrollRatio).toBeUndefined();
      expect(record.navSourceUrl).toBeUndefined();
      expect(record.searchQuery).toBeUndefined();
    });

    it('carries present scalars and trail columns through', () => {
      const record = toSessionTimelineRecord(
        makeEntry({ visit_duration: 42, scroll_ratio: 0.5, search_query: 'wasm' }),
      );
      expect(record.visitDuration).toBe(42);
      expect(record.scrollRatio).toBe(0.5);
      expect(record.searchQuery).toBe('wasm');
    });
  });

  describe('isPlaybackExcluded', () => {
    it('excludes private判定 rows (masked content) and keeps plain rows', () => {
      expect(isPlaybackExcluded(makeEntry({ masked_count: 3 }))).toBe(true);
      expect(isPlaybackExcluded(makeEntry({ masked_count: 0 }))).toBe(false);
      expect(isPlaybackExcluded(makeEntry({ masked_count: null }))).toBe(false);
      expect(isPlaybackExcluded(makeEntry())).toBe(false);
    });
  });

  describe('buildPlaybackModel', () => {
    it('drops private判定 rows before aggregation (caller-side contract)', () => {
      const entries = [
        makeEntry({ id: 1, search_query: 'q', created_at: 1000 }),
        makeEntry({ id: 2, search_query: 'q', created_at: 2000, masked_count: 5 }),
        makeEntry({ id: 3, search_query: 'q', created_at: 3000 }),
      ];
      const model = buildPlaybackModel(entries);
      expect(model.sessions).toHaveLength(1);
      expect(model.sessions[0]?.records.map((r) => r.id)).toEqual([1, 3]);
    });
  });

  describe('renderPlayback', () => {
    it('renders the empty reason instead of an empty list (縮退の出口)', () => {
      const container = document.createElement('div');
      renderPlayback(container, [], { onOpenRecord: () => undefined });
      expect(container.querySelector('ol')).toBeNull();
      expect(container.querySelector('.session-playback-empty')).not.toBeNull();
    });

    it('reaches the original URL through an anchor with a safe target', () => {
      const container = document.createElement('div');
      const model = buildPlaybackModel([
        makeEntry({ id: 1, url: 'https://example.com/a', title: 'A', search_query: 'q', created_at: 1000 }),
        makeEntry({ id: 2, url: 'https://example.com/b', title: 'B', search_query: 'q', created_at: 2000 }),
      ]);
      renderPlayback(container, model.sessions, { onOpenRecord: () => undefined });
      const anchors = [...container.querySelectorAll('.session-playback-step a')];
      expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      for (const anchor of anchors) {
        expect(anchor.getAttribute('target')).toBe('_blank');
        expect(anchor.getAttribute('rel')).toContain('noopener');
      }
    });

    it('reaches the original record through the button hook with the row id', () => {
      const container = document.createElement('div');
      const onOpenRecord = vi.fn();
      const model = buildPlaybackModel([
        makeEntry({ id: 7, url: 'https://example.com/a', search_query: 'q', created_at: 1000 }),
        makeEntry({ id: 9, url: 'https://example.com/b', search_query: 'q', created_at: 2000 }),
      ]);
      renderPlayback(container, model.sessions, { onOpenRecord });
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('.session-playback-open-record')];
      expect(buttons).toHaveLength(2);
      buttons[1]?.click();
      expect(onOpenRecord).toHaveBeenCalledTimes(1);
      expect(onOpenRecord).toHaveBeenCalledWith(9);
    });

    it('renders non-http(s) URLs as plain text, never as anchors', () => {
      const container = document.createElement('div');
      const model = buildPlaybackModel([
        makeEntry({ id: 1, url: 'javascript:alert(1)', title: 'X', search_query: 'q', created_at: 1000 }),
        makeEntry({ id: 2, url: 'https://example.com/b', title: 'B', search_query: 'q', created_at: 2000 }),
      ]);
      renderPlayback(container, model.sessions, { onOpenRecord: () => undefined });
      expect(container.querySelectorAll('.session-playback-step a')).toHaveLength(1);
      expect(container.textContent).toContain('X');
    });
  });
});
