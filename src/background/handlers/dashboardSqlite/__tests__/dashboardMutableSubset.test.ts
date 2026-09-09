import { describe, it, expect } from 'vitest';
import { DASHBOARD_MUTABLE_SUBSET } from '../deps.js';
import { UPDATABLE_FIELDS } from '../../../../offscreen/schema.js';

/**
 * Subset-integrity guard: the dashboard route stays deliberately narrower
 * than the offscreen whitelist. Adding a field to the dashboard subset
 * that the storage layer would not accept must fail here.
 */
describe('DASHBOARD_MUTABLE_SUBSET ⊆ UPDATABLE_FIELDS', () => {
  it('contains exactly the 10 dashboard-editable fields', () => {
    expect([...DASHBOARD_MUTABLE_SUBSET].sort()).toEqual(
      [
        'url', 'title', 'summary', 'tags', 'domain',
        'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
        'obsidian_synced',
      ].sort(),
    );
  });

  it('every dashboard-mutable field is storage-updatable', () => {
    for (const field of DASHBOARD_MUTABLE_SUBSET) {
      expect(UPDATABLE_FIELDS as readonly string[]).toContain(field);
    }
  });
});
