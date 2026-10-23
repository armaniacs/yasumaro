/**
 * tagNormalizationProposals.test.ts
 * PBI 2026-10-23-05 ― 持続保守 (タグ正規化の提案・適用・取消).
 * Pins: the proposal table (dict semantics identical to normalizeTags),
 * the rename primitive with dedup, and the fail-closed 縮退.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTagNormalizationProposals,
  renameTagInCsv,
} from '../tagNormalizationProposals.js';
import {
  applyTagRename,
  TagRenameError,
  undoTagRename,
  type TagRenameDeps,
} from '../tagRenameApplier.js';

const DICT = [
  { from: '人工知能', to: 'AI' },
  { from: 'ai', to: 'AI' },
  { from: 'same', to: 'same' },
];

describe('buildTagNormalizationProposals (提案が出る)', () => {
  it('proposes the stored tags that change under the dictionary', () => {
    const proposals = buildTagNormalizationProposals(['人工知能', 'ai', 'web', 'AI'], DICT);
    expect(proposals).toEqual([
      { from: '人工知能', to: 'AI' },
      { from: 'ai', to: 'AI' },
    ]);
  });

  it('skips self-mappings and dedupes case-only duplicates', () => {
    const proposals = buildTagNormalizationProposals(['same', 'AI', 'ai'], DICT);
    expect(proposals).toEqual([{ from: 'ai', to: 'AI' }]);
  });

  it('proposes nothing on empty inputs (縮退の出口)', () => {
    expect(buildTagNormalizationProposals([], DICT)).toEqual([]);
    expect(buildTagNormalizationProposals(['ai'], [])).toEqual([]);
  });
});

describe('renameTagInCsv (適用・取消の基本形)', () => {
  it('renames one tag inside the CSV, following normalizeTags dedup', () => {
    // 'AI' collides with the existing 'ai' after folding, so normalizeTags
    // itself would drop it too — the rename stays consistent with recording.
    expect(renameTagInCsv('ai, web ,人工知能', '人工知能', 'AI')).toBe('ai,web');
    expect(renameTagInCsv('web,人工知能', '人工知能', 'AI')).toBe('web,AI');
  });

  it('dedupes the collisions a rename creates', () => {
    expect(renameTagInCsv('ai,人工知能', '人工知能', 'AI')).toBe('ai');
  });

  it('fails closed on unknown shapes (縮退の出口)', () => {
    expect(renameTagInCsv(null, 'ai', 'AI')).toBe('');
    expect(renameTagInCsv(undefined, 'ai', 'AI')).toBe('');
    expect(renameTagInCsv('', 'ai', 'AI')).toBe('');
    expect(renameTagInCsv('ai,web', '', 'AI')).toBe('ai,web');
  });

  it('round-trips apply then undo (適用・取消ができる)', () => {
    const applied = renameTagInCsv('ai,web', 'ai', 'AI');
    expect(applied).toBe('AI,web');
    expect(renameTagInCsv(applied, 'AI', 'ai')).toBe('ai,web');
  });
});

describe('applyTagRename / undoTagRename (適用・取消のseam)', () => {
  function makeDeps(rows: { id: number; tags: string | null }[], failOn?: number): TagRenameDeps & {
    written: Map<number, string>;
  } {
    const written = new Map<number, string>();
    return {
      written,
      queryByTag: async () => rows,
      updateTags: async (id: number, tags: string) => {
        if (id === failOn) throw new Error('write failed');
        written.set(id, tags);
      },
    };
  }

  it('rewrites the rows carrying the tag and skips clean rows', async () => {
    const deps = makeDeps([
      { id: 1, tags: 'ai,web' },
      { id: 2, tags: 'web' },
    ]);
    const result = await applyTagRename(deps, 'ai', 'AI');
    // Row 2 has no 'ai' after folding... 'web' stays 'web': skipped.
    expect(result).toEqual({ updated: 1 });
    expect(deps.written.get(1)).toBe('AI,web');
    expect(deps.written.has(2)).toBe(false);
  });

  it('undoes by renaming back (取消ができる)', async () => {
    const deps = makeDeps([{ id: 1, tags: 'AI,web' }]);
    const result = await undoTagRename(deps, 'ai', 'AI');
    expect(result).toEqual({ updated: 1 });
    expect(deps.written.get(1)).toBe('ai,web');
  });

  it('aborts with the applied count on a failing write (縮退の出口)', async () => {
    const deps = makeDeps(
      [
        { id: 1, tags: 'ai' },
        { id: 2, tags: 'ai' },
      ],
      2,
    );
    const error = await applyTagRename(deps, 'ai', 'AI').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TagRenameError);
    expect((error as TagRenameError).updated).toBe(1);
  });
});
