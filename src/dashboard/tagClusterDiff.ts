/**
 * tagClusterDiff.ts
 * Pure diff between the two co-occurrence snapshots of the tag-cluster
 * time-compare panel (PBI 2026-09-24-08): which tags appeared, disappeared,
 * increased, or decreased between the first half and the second half.
 */

import type { TagNode } from './tagCooccurrence.js';

/** Per-tag count change for the increased/decreased sections. */
export interface TagDelta {
  tag: string;
  /** Count in the first-half snapshot (0 for appeared tags). */
  before: number;
  /** Count in the second-half snapshot (0 for disappeared tags). */
  after: number;
  /** after - before (positive in increased, negative in decreased). */
  delta: number;
}

export interface TagDiffResult {
  /** Tags present only in the second snapshot, name ascending. */
  appeared: string[];
  /** Tags present only in the first snapshot, name ascending. */
  disappeared: string[];
  /** Tags whose count grew, delta descending then name ascending. */
  increased: TagDelta[];
  /** Tags whose count shrank, delta descending then name ascending. */
  decreased: TagDelta[];
}

/**
 * Computes the four diff categories from the two node lists.
 *
 * Ordering contract (deterministic, pinned by tests): appeared/disappeared
 * sort by tag name ascending (code-unit order); increased/decreased sort by
 * signed delta descending with name ascending as the tie-break. The signed
 * rule is kept uniform across both sections per the PBI criteria — for
 * decreased tags this places the smallest drop first, matching the literal
 * "delta desc" rule rather than a magnitude variant.
 *
 * Tags with equal counts in both snapshots land in no category.
 */
export function computeTagDiff(beforeNodes: TagNode[], afterNodes: TagNode[]): TagDiffResult {
  const before = new Map(beforeNodes.map((node) => [node.tag, node.count]));
  const after = new Map(afterNodes.map((node) => [node.tag, node.count]));

  const appeared: string[] = [];
  const disappeared: string[] = [];
  const increased: TagDelta[] = [];
  const decreased: TagDelta[] = [];

  for (const [tag, count] of after) {
    const beforeCount = before.get(tag);
    if (beforeCount === undefined) {
      appeared.push(tag);
      continue;
    }
    const delta = count - beforeCount;
    if (delta > 0) {
      increased.push({ tag, before: beforeCount, after: count, delta });
    } else if (delta < 0) {
      decreased.push({ tag, before: beforeCount, after: count, delta });
    }
  }
  for (const tag of before.keys()) {
    if (!after.has(tag)) {
      disappeared.push(tag);
    }
  }

  const byNameAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const byDeltaDescThenName = (a: TagDelta, b: TagDelta): number =>
    b.delta - a.delta || byNameAsc(a.tag, b.tag);

  appeared.sort(byNameAsc);
  disappeared.sort(byNameAsc);
  increased.sort(byDeltaDescThenName);
  decreased.sort(byDeltaDescThenName);

  return { appeared, disappeared, increased, decreased };
}
