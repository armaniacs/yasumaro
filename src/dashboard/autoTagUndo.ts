/**
 * autoTagUndo.ts
 *
 * Rule-tag undo for auto-tag rules (PBI 2026-10-23-06, BDD scenario 2:
 * 誤適用は取り消せる). The recording step logs every applied { ruleId, tag,
 * url }; the undo removes the rule's tag from exactly the records whose URL
 * is in the rule's log slice, then reports which log entries to prune.
 *
 * Bounded by construction: only logged URLs are touched, so a manually added
 * same-spelling tag on a never-matched record is never removed by this path.
 * A write failure aborts with the count applied so far (best-effort with a
 * reason, never a silent half-undo — same contract as tagRenameApplier).
 */

import { foldTagForMatch } from '../utils/tagUtils.js';
import { removeTagFromCsv } from './tagNormalizationProposals.js';
import type { AutoTagApplication } from '../utils/storage/autoTagRules.js';

export interface AutoTagUndoRow {
  id: number;
  tags: string | null;
  url: string;
}

export interface AutoTagUndoDeps {
  queryByTag: (tag: string) => Promise<AutoTagUndoRow[]>;
  updateTags: (id: number, tags: string) => Promise<void>;
}

export class AutoTagUndoError extends Error {
  readonly removed: number;
  constructor(message: string, removed: number) {
    super(message);
    this.name = 'AutoTagUndoError';
    this.removed = removed;
  }
}

/**
 * Remove `rule.tag` from the logged records that still carry it. Returns the
 * removed count and the log entries the caller should prune.
 */
export async function undoAutoTagRule(
  deps: AutoTagUndoDeps,
  ruleId: string,
  tag: string,
  applications: AutoTagApplication[],
): Promise<{ removed: number; pruned: AutoTagApplication[] }> {
  const wanted = foldTagForMatch(tag);
  if (wanted === '') return { removed: 0, pruned: [] };
  const logged = applications.filter((entry) => entry.ruleId === ruleId);
  if (logged.length === 0) return { removed: 0, pruned: [] };
  const urls = new Set(logged.map((entry) => entry.url));

  let rows: AutoTagUndoRow[];
  try {
    rows = await deps.queryByTag(tag);
  } catch (error) {
    throw new AutoTagUndoError(error instanceof Error ? error.message : String(error), 0);
  }

  let removed = 0;
  for (const row of rows) {
    if (!urls.has(row.url)) continue;
    if (typeof row.tags !== 'string' || !row.tags.split(',').some((t) => foldTagForMatch(t) === wanted)) continue;
    const next = removeTagFromCsv(row.tags, tag);
    if (next === row.tags) continue;
    try {
      await deps.updateTags(row.id, next);
    } catch (error) {
      throw new AutoTagUndoError(error instanceof Error ? error.message : String(error), removed);
    }
    removed += 1;
  }
  return { removed, pruned: logged };
}
