/**
 * logImportContract-golden.test.ts (PBI 2026-11-26-09)
 *
 * Golden matrix + single-implementation pins for the per-row log-import
 * contract. Pins the exact rejection strings and the first-fail order, and
 * pins that both layers (messaging re-export, dashboard lenient delegation)
 * reference this one layer-0 implementation.
 */
import { describe, it, expect } from 'vitest';
import { validateImportRow } from '../logImportContract.js';
import { validateImportRow as messagingValidateImportRow } from '../../messaging/validators.js';

const NOW = 1_700_000_000_000;
const row = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  url: 'https://a.test',
  created_at: NOW,
  ...patch,
});

const REJECTIONS: ReadonlyArray<[Record<string, unknown> | unknown, string]> = [
  [null, 'must be an object'],
  ['https://a.test', 'must be an object'],
  [[row()], 'must be an object'],
  [{}, 'url must be a non-empty string'],
  [row({ url: '' }), 'url must be a non-empty string'],
  [row({ url: 5 }), 'url must be a non-empty string'],
  [{ url: 'https://a.test' }, 'created_at must be a finite number'],
  [row({ created_at: 'x' }), 'created_at must be a finite number'],
  [row({ created_at: Number.NaN }), 'created_at must be a finite number'],
  [row({ created_at: Number.POSITIVE_INFINITY }), 'created_at must be a finite number'],
  [row({ title: 123 }), 'title must be a string'],
  [row({ summary: {} }), 'summary must be a string'],
  [row({ tags: [] }), 'tags must be a string'],
  [row({ domain: true }), 'domain must be a string'],
  [row({ nav_source_url: 5 }), 'nav_source_url must be a string'],
  [row({ search_query: [] }), 'search_query must be a string'],
  // First-fail order: text fields are checked before created_at.
  [row({ tags: {}, domain: true, created_at: 'x' }), 'tags must be a string'],
  [row({ visit_duration: 'x' }), 'visit_duration must be a finite number'],
  [row({ visit_duration: -1 }), 'visit_duration must be >= 0'],
  [row({ scroll_ratio: 'x' }), 'scroll_ratio must be a finite number'],
  [row({ scroll_ratio: 5 }), 'scroll_ratio must be between 0 and 1'],
  [row({ scroll_ratio: -0.5 }), 'scroll_ratio must be between 0 and 1'],
  [row({ is_starred: 2 }), 'is_starred must be 0 or 1'],
  [row({ is_deleted: 'x' }), 'is_deleted must be 0 or 1'],
];

describe('logImportContract golden: validateImportRow (layer 0)', () => {
  it('is exported by the messaging layer as the same function (no duplicate)', () => {
    expect(messagingValidateImportRow).toBe(validateImportRow);
  });

  it('returns the pinned rejection reason for every rejected row', () => {
    for (const [input, expected] of REJECTIONS) {
      expect(validateImportRow(input)).toBe(expected);
    }
  });

  it('accepts the pinned valid rows', () => {
    expect(validateImportRow(row())).toBeNull();
    expect(
      validateImportRow(
        row({
          title: 'T',
          summary: 'S',
          tags: '["x"]',
          domain: 'a.test',
          visit_duration: 1000,
          scroll_ratio: 0.5,
          is_starred: 1,
          is_deleted: 0,
        })
      )
    ).toBeNull();
  });

  it('treats null optional fields as absent', () => {
    expect(
      validateImportRow(
        row({ title: null, summary: null, visit_duration: null, scroll_ratio: null, is_starred: null, is_deleted: null })
      )
    ).toBeNull();
  });

  it('enforces no length caps and no created_at bounds (dashboard-only strict extras)', () => {
    expect(validateImportRow(row({ url: 'https://a.test/' + 'x'.repeat(3000) }))).toBeNull();
    expect(validateImportRow(row({ created_at: 0 }))).toBeNull();
    expect(validateImportRow(row({ created_at: NOW + 5 * 24 * 3600 * 1000 }))).toBeNull();
    expect(validateImportRow(row({ visit_duration: 10 * 24 * 3600 * 1000 }))).toBeNull();
  });
});
