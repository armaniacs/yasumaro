/**
 * autoTagUndo.test.ts
 * PBI 2026-10-23-06: the rule undo touches only logged URLs carrying the
 * tag, and aborts with a count on write failure.
 */
import { describe, it, expect, vi } from 'vitest';
import { AutoTagUndoError, undoAutoTagRule, type AutoTagUndoDeps } from '../autoTagUndo.js';

function deps(overrides: Partial<AutoTagUndoDeps> = {}): AutoTagUndoDeps & { updateTags: ReturnType<typeof vi.fn> } {
  const updateTags = vi.fn(async (_id: number, _tags: string) => {});
  return {
    queryByTag: async () => [],
    updateTags: updateTags as unknown as AutoTagUndoDeps['updateTags'] & ReturnType<typeof vi.fn>,
    ...overrides,
  };
}

const LOG = [
  { ruleId: 'r1', tag: 'docs', url: 'https://docs.example.com/a', at: 1 },
  { ruleId: 'r1', tag: 'docs', url: 'https://docs.example.com/b', at: 2 },
  { ruleId: 'other', tag: 'docs', url: 'https://docs.example.com/c', at: 3 },
];

describe('undoAutoTagRule', () => {
  it('removes the tag from logged records that still carry it', async () => {
    const d = deps({
      queryByTag: async () => [
        { id: 1, tags: 'docs,news', url: 'https://docs.example.com/a' },
        { id: 2, tags: 'news', url: 'https://docs.example.com/b' },
        { id: 3, tags: 'docs', url: 'https://unlogged.example.com/x' },
        { id: 4, tags: 'docs', url: 'https://docs.example.com/c' },
      ],
    });
    const out = await undoAutoTagRule(d, 'r1', 'docs', LOG);
    expect(out.removed).toBe(1);
    expect(d.updateTags).toHaveBeenCalledTimes(1);
    expect(d.updateTags).toHaveBeenCalledWith(1, 'news');
    expect(out.pruned).toHaveLength(2);
  });

  it('is a no-op without log entries and aborts with a count on failure', async () => {
    const d = deps();
    expect(await undoAutoTagRule(d, 'r1', 'docs', [])).toEqual({ removed: 0, pruned: [] });
    expect(await undoAutoTagRule(d, 'r1', '', LOG)).toEqual({ removed: 0, pruned: [] });

    const failing = deps({
      queryByTag: async () => [
        { id: 1, tags: 'docs', url: 'https://docs.example.com/a' },
        { id: 2, tags: 'docs', url: 'https://docs.example.com/b' },
      ],
      updateTags: vi.fn(async (id: number) => {
        if (id === 2) throw new Error('write failed');
      }),
    });
    const error = await undoAutoTagRule(failing, 'r1', 'docs', LOG).catch((e) => e);
    expect(error).toBeInstanceOf(AutoTagUndoError);
    expect((error as AutoTagUndoError).removed).toBe(1);
  });
});
