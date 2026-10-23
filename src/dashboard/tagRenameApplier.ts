/**
 * tagRenameApplier.ts
 *
 * Tag-rename apply/undo seam (PBI 2026-10-23-05). Renames one tag across the
 * stored records: queries the rows carrying the tag, rewrites each row's
 * tags CSV with the pure renameTagInCsv primitive, and writes it back.
 * Undo renames back — the action is reversible end-to-end (適用・取消が
 * できる). Nothing fires without a user action (自動適用はしない).
 *
 * Deps are injected (queryByTag/updateTags) so tests run on mocks; the
 * production wiring resolves them to queryLogs/updateLog. Fail-closed:
 * a row the query cannot read is left untouched, and the first failing
 * write aborts with the count applied so far (best-effort with a reason,
 * never a silent half-rename).
 */

import { renameTagInCsv } from './tagNormalizationProposals.js';

export interface TagRenameRow {
  id: number;
  tags: string | null;
}

export interface TagRenameDeps {
  queryByTag: (tag: string) => Promise<TagRenameRow[]>;
  updateTags: (id: number, tags: string) => Promise<void>;
}

export interface TagRenameResult {
  /** Rows rewritten. On failure the error carries this count as well. */
  updated: number;
}

export class TagRenameError extends Error {
  readonly updated: number;
  constructor(message: string, updated: number) {
    super(message);
    this.name = 'TagRenameError';
    this.updated = updated;
  }
}

/**
 * Renames `from` to `to` across the stored records. 縮退の出口: rows whose
 * tags already equal the renamed value are skipped without a write.
 */
export async function applyTagRename(
  deps: TagRenameDeps,
  from: string,
  to: string,
): Promise<TagRenameResult> {
  return runTagRename(deps, from, to);
}

/** Undo: renames `to` back to `from` (the same path, swapped). */
export async function undoTagRename(
  deps: TagRenameDeps,
  from: string,
  to: string,
): Promise<TagRenameResult> {
  return runTagRename(deps, to, from);
}

async function runTagRename(
  deps: TagRenameDeps,
  from: string,
  to: string,
): Promise<TagRenameResult> {
  const rows = await deps.queryByTag(from);
  let updated = 0;
  for (const row of rows) {
    const renamed = renameTagInCsv(row.tags, from, to);
    if (renamed === (row.tags ?? '')) continue;
    try {
      await deps.updateTags(row.id, renamed);
      updated++;
    } catch (error) {
      throw new TagRenameError(
        error instanceof Error ? error.message : String(error),
        updated,
      );
    }
  }
  return { updated };
}
