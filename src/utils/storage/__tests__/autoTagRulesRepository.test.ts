/**
 * autoTagRulesRepository.test.ts
 *
 * Roundtrip tests for the auto-tag rules repository seam
 * (PBI 2026-10-23-06). The contract mirrors savedCollectionsRepository:
 * save-then-read returns the same shape, a corrupted store degrades to the
 * valid subset, and the application log stays bounded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger/api.js', () => ({ logError: vi.fn(() => Promise.resolve()) }));

const backing = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  failNextGetWith: null as Error | null,
}));

vi.mock('../SettingsRepository.js', () => ({
  settingsRepository: {
    get: async (key: string): Promise<unknown> => {
      if (backing.failNextGetWith !== null) {
        const error = backing.failNextGetWith;
        backing.failNextGetWith = null;
        throw error;
      }
      return backing.store.get(key);
    },
    set: async (key: string, value: unknown): Promise<void> => {
      backing.store.set(key, value);
    },
  },
}));

import {
  appendAutoTagApplicationsById,
  getAutoTagApplications,
  getAutoTagRules,
  pruneAutoTagApplications,
  removeAutoTagRuleById,
  upsertAutoTagRuleById,
} from '../autoTagRulesRepository.js';
import type { AutoTagRule } from '../autoTagRules.js';

function rule(id: string): AutoTagRule {
  return { id, name: `Rule ${id}`, urlContains: id, tag: `tag-${id}`, priority: 100, enabled: true };
}

describe('autoTagRulesRepository', () => {
  beforeEach(() => {
    backing.store.clear();
    backing.failNextGetWith = null;
  });

  it('round-trips rules through upsert and read', async () => {
    await upsertAutoTagRuleById(rule('r1'));
    expect(await getAutoTagRules()).toEqual({ r1: rule('r1') });
  });

  it('rejects an invalid rule instead of storing it', async () => {
    await expect(upsertAutoTagRuleById({ ...rule('bad'), tag: '#nope' })).rejects.toThrow();
    expect(await getAutoTagRules()).toEqual({});
  });

  it('removes by id and degrades a throwing store to empty', async () => {
    await upsertAutoTagRuleById(rule('r1'));
    await removeAutoTagRuleById('r1');
    expect(await getAutoTagRules()).toEqual({});
    backing.failNextGetWith = new Error('store down');
    expect(await getAutoTagRules()).toEqual({});
  });

  it('appends log entries bounded and prunes by predicate', async () => {
    await appendAutoTagApplicationsById([
      { ruleId: 'r1', tag: 't', url: 'https://x/1', at: 1 },
      { ruleId: 'r2', tag: 't', url: 'https://x/2', at: 2 },
    ]);
    expect(await getAutoTagApplications()).toHaveLength(2);
    await pruneAutoTagApplications((entry) => entry.ruleId !== 'r1');
    expect(await getAutoTagApplications()).toEqual([
      { ruleId: 'r2', tag: 't', url: 'https://x/2', at: 2 },
    ]);
  });

  it('degrades a corrupted log to the valid subset', async () => {
    backing.store.set('auto_tag_applications', [
      { ruleId: 'r1', tag: 't', url: 'https://x/1', at: 1 },
      'garbage',
      { ruleId: 'r2' },
    ]);
    expect(await getAutoTagApplications()).toEqual([
      { ruleId: 'r1', tag: 't', url: 'https://x/1', at: 1 },
    ]);
  });
});
