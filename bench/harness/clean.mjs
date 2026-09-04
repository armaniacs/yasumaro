/**
 * clean.mjs — retention policy for bench/reports/.
 *
 * A "generation" is one date-stamped report set (micro-2026-09-04.md/.html/.json).
 * After each bench run the reports directory is pruned to:
 *   1. the ROLLING_KEEP (5) newest generations, plus
 *   2. the newest generation of each ISO week among the dropped ones
 *      (weekly anchor; bounded at one extra generation per week).
 *
 * Safety: generations are deleted as a group so .md/.html/.json never go out
 * of step; files without a YYYY-MM-DD stamp are never pruned; only the
 * reports directory passed in is touched (baselines/ etc. are unreachable).
 * Date stamps and ISO weeks are UTC, matching how reports are generated.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROLLING_KEEP = 5;
// Generations are exactly <prefix>-<YYYY-MM-DD>.<ext>; multi-dot names like
// micro-2026-08-27.backup.md intentionally do NOT match and are never auto-deleted.
const DATE_SUFFIX_RE = /(\d{4}-\d{2}-\d{2})\.[^.]+$/;

/** Bucket files by date-stamped generation. Files without a stamp are ignored. */
function groupByGeneration(files) {
  /** @type {Map<string, string[]>} */
  const gens = new Map();
  for (const f of files) {
    const m = DATE_SUFFIX_RE.exec(f);
    if (!m) continue;
    const list = gens.get(m[1]) ?? [];
    list.push(f);
    gens.set(m[1], list);
  }
  return gens;
}

/** ISO week key (UTC) for a YYYY-MM-DD stamp, e.g. "2026-W32". */
export function isoWeekKey(stamp) {
  const date = new Date(`${stamp}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const dow = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((Math.round((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Apply the retention policy to a reports directory.
 * @param {string} reportsDir
 * @param {{ all?: boolean, keep?: number }} [opts]
 * @returns {string[]} deleted file names (sorted ascending)
 */
export function pruneReports(reportsDir, opts = {}) {
  const { all = false, keep = ROLLING_KEEP } = opts;
  if (!existsSync(reportsDir)) return [];
  // Dotfiles are always preserved, even with --all.
  const files = readdirSync(reportsDir).filter((f) => !f.startsWith('.'));
  if (all) {
    for (const f of files) rmSync(join(reportsDir, f), { recursive: true, force: true });
    return [...files].sort();
  }
  const gens = groupByGeneration(files);
  const stamps = [...gens.keys()].sort(); // ascending
  const rolling = new Set(stamps.slice(-keep));
  const dropped = stamps.slice(0, Math.max(stamps.length - keep, 0));
  const keepSet = new Set(rolling);
  const seenWeeks = new Set([...rolling].map(isoWeekKey));
  for (const stamp of [...dropped].reverse()) { // newest dropped first -> newest per week wins
    const week = isoWeekKey(stamp);
    if (week === null || seenWeeks.has(week)) continue;
    keepSet.add(stamp);
    seenWeeks.add(week);
  }
  const deleted = [];
  for (const [stamp, list] of gens) {
    if (keepSet.has(stamp)) continue;
    for (const f of list) {
      rmSync(join(reportsDir, f), { recursive: true, force: true });
      deleted.push(f);
    }
  }
  return deleted.sort();
}

function main() {
  const all = process.argv.slice(2).includes('--all');
  const reportsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
  const deleted = pruneReports(reportsDir, { all });
  if (deleted.length === 0) {
    process.stderr.write('[bench:clean] nothing to delete.\n');
    return;
  }
  process.stderr.write(`[bench:clean] deleted ${deleted.length} file(s):\n`);
  for (const f of deleted) process.stderr.write(`  - ${f}\n`);
}

// Run the CLI only when executed directly (not when imported by cli.mjs/tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
