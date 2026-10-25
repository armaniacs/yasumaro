/**
 * tagNormalizationProposals.ts
 *
 * Tag-normalization proposals (PBI 2026-10-23-05, acceptance: タグ正規化の
 * 提案が出て、適用・取消ができる). Given the distinct stored tags and the
 * user's normalization dictionary, surfaces the tags that would change —
 * with the record count as the proposal's own basis — so the user applies
 * renames deliberately instead of discovering them after the fact.
 *
 * The match semantics ride normalizeTags exactly (NFKC + lowercase keys,
 * first dict entry wins); this module never invents its own folding.
 * Pure: proposing never writes, applying is a caller-side user action with
 * an undo (the rename back), never automatic.
 */

import type { TagNormalizationEntry } from '../utils/types.js';
import { foldTagForMatch } from '../utils/tagUtils.js';

/** One rename proposal: an existing tag and its canonical form. */
export interface TagNormalizationProposal {
  from: string;
  to: string;
}

/**
 * Proposals for the stored tags that change under the dictionary. 縮退の
 * 出口: empty inputs and an empty dictionary propose nothing — the panel
 * shows the reason instead of an empty proposal list.
 */
export function buildTagNormalizationProposals(
  distinctTags: string[],
  dict: TagNormalizationEntry[],
): TagNormalizationProposal[] {
  if (distinctTags.length === 0 || dict.length === 0) return [];
  const map = new Map<string, string>();
  for (const entry of dict) {
    const key = foldTagForMatch(entry.from);
    if (key !== '' && !map.has(key)) map.set(key, entry.to);
  }
  const proposals: TagNormalizationProposal[] = [];
  const proposed = new Set<string>();
  for (const tag of distinctTags) {
    const folded = foldTagForMatch(tag);
    if (folded === '' || proposed.has(folded)) continue;
    const to = map.get(folded);
    if (to === undefined) continue;
    // A rule that leaves the stored spelling untouched is not a proposal.
    // (Case-only changes like ai -> AI still count: normalizeTags rewrites
    // them at record time, so they are real display changes.)
    if (to.trim() === tag.trim()) continue;
    proposed.add(folded);
    proposals.push({ from: tag.trim(), to });
  }
  return proposals;
}

/**
 * Renames one tag inside a stored tags CSV (the apply/undo primitive).
 * Unknown shapes fail closed to the input unchanged — never a throw, never
 * a dropped row.
 */
export function renameTagInCsv(tagsCsv: string | null | undefined, from: string, to: string): string {
  if (typeof tagsCsv !== 'string' || tagsCsv === '') return tagsCsv ?? '';
  const wanted = foldTagForMatch(from);
  if (wanted === '') return tagsCsv;
  const renamed = tagsCsv
    .split(',')
    .map((t) => (foldTagForMatch(t) === wanted ? to.trim() : t.trim()))
    .filter((t) => t !== '');
  // Dedupes case-only collisions the rename may create (same rule as
  // normalizeTags: first occurrence wins).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of renamed) {
    const key = foldTagForMatch(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.join(',');
}

/**
 * Removes one tag from a stored tags CSV (PBI 2026-10-23-06: the auto-tag
 * rule undo). Same shape contract as renameTagInCsv: comma cells, folded
 * comparison, unknown shapes fail closed to the input unchanged.
 */
export function removeTagFromCsv(tagsCsv: string | null | undefined, tag: string): string {
  if (typeof tagsCsv !== 'string' || tagsCsv === '') return tagsCsv ?? '';
  const wanted = foldTagForMatch(tag);
  if (wanted === '') return tagsCsv;
  return tagsCsv
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '' && foldTagForMatch(t) !== wanted)
    .join(',');
}
