/**
 * trend.mjs — aggregate persisted micro bench generations into per-metric
 * time series for the HTML report's Trend section.
 *
 * A "generation" is one micro-<date>.json in the reports directory (same
 * date-stamp family as the retention policy). The loader is deliberately
 * tolerant: files with a schemaVersion other than 1 and unparsable files are
 * skipped with a count instead of failing the bench run, and same-date
 * duplicates resolve to the newest `generatedAt`.
 *
 * Pure-data module: the caller (cli.mjs) owns the I/O boundary and injects the
 * loaded history into renderHtml, which stays a pure function.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATE_JSON_RE = /^micro-(\d{4}-\d{2}-\d{2})\.json$/;
const DEFAULT_CAP = 26;

/**
 * Load trend generations from a reports directory.
 * @param {string} reportsDir
 * @param {{ cap?: number }} [opts]
 * @returns {{ generations: Array<{ date: string, node: string, generatedAt: string, benches: Record<string, object> }>, skipped: number }}
 */
export function loadTrendHistory(reportsDir, opts = {}) {
  const { cap = DEFAULT_CAP } = opts;
  const empty = { generations: [], skipped: 0 };
  if (!reportsDir || !existsSync(reportsDir)) return empty;

  let skipped = 0;
  const byDate = new Map();
  try {
    const files = readdirSync(reportsDir).filter((f) => DATE_JSON_RE.test(f));
    for (const f of files) {
      const date = DATE_JSON_RE.exec(f)[1];
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(join(reportsDir, f), 'utf8'));
      } catch {
        skipped++;
        continue;
      }
      if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.results)) {
        skipped++;
        continue;
      }
      const prev = byDate.get(date);
      const stamp = String(parsed.generatedAt ?? '');
      if (!prev || stamp > String(prev.generatedAt ?? '')) {
        byDate.set(date, { date, node: String(parsed.node ?? ''), generatedAt: stamp, results: parsed.results });
      }
    }
  } catch {
    return empty;
  }

  const dates = [...byDate.keys()].sort();
  const generations = dates
    .slice(-Math.max(1, cap))
    .map((date) => {
      const entry = byDate.get(date);
      const benches = {};
      for (const r of entry.results) {
        if (!r || typeof r.id !== 'string') continue;
        const l = r.perSize?.L;
        benches[r.id] = {
          wall: l ? { p50: l.wallMs?.p50, p95: l.wallMs?.p95, p99: l.wallMs?.p99 } : null,
          heap: l ? l.heapBytes?.p50 : null,
          counters: l?.counters ?? {},
          scalingExponent: r.scaling?.exponent,
        };
      }
      return { date: entry.date, node: entry.node, generatedAt: entry.generatedAt, benches };
    });

  return { generations, skipped };
}
