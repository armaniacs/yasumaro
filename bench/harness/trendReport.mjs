/**
 * trendReport.mjs — Trend section presentation for the micro-bench HTML report.
 *
 * Role split: `trend.mjs` is the pure-data module (loads/aggregates persisted
 * generations; I/O owned by cli.mjs), while this module is presentation only
 * (history → HTML string). Trend UI changes (sparkline colors, table columns)
 * should land here without touching htmlReport.mjs.
 */
import { escapeHtml, fmtNum, fmtKB } from './format.mjs';

/** CSS rules for the Trend section, concatenated after the report body CSS. */
export const trendCss = `.sparkline .trend-line-p50 { fill: none; stroke: #2b6cb0; stroke-width: 1.5; }
.sparkline .trend-line-p95 { fill: none; stroke: #7aa5d8; stroke-width: 1; }
.sparkline .trend-line-p99 { fill: none; stroke: #16365c; stroke-width: 1; }
.trend-vals { text-align: left; font-size: 11px; }
`;

/**
 * Multi-series sparkline over a shared value scale. `seriesByKey` maps a
 * metric name to an array of values aligned by generation index (nulls are
 * skipped but keep their x position). Returns '' until 2 plottable points.
 */
export function sparkline(seriesByKey, w = 160, h = 36) {
  const n = Math.max(0, ...Object.values(seriesByKey).map((a) => a.length));
  if (n < 2) return '';
  const all = Object.values(seriesByKey).flat().filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (all.length < 2) return '';
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const polylines = Object.entries(seriesByKey).map(([metric, vals]) => {
    const pts = [];
    vals.forEach((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const x = 2 + (i / (n - 1)) * (w - 4);
      const y = h - 2 - ((v - min) / span) * (h - 4);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    if (pts.length < 2) return '';
    return `<polyline points="${pts.join(' ')}" class="trend-line-${metric}" />`;
  });
  const body = polylines.filter(Boolean).join('');
  if (!body) return '';
  return `<svg class="sparkline" aria-hidden="true" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

export function renderTrendSection(history) {
  if (!history || !Array.isArray(history.generations) || history.generations.length === 0) return '';
  const gens = history.generations;
  const skippedNote = history.skipped > 0 ? `<span class="muted">（スキップ: ${history.skipped} 件）</span>` : '';
  if (gens.length === 1) {
    return `
<section class="card" id="trend">
  <h2>Trend</h2>
  <p class="muted">1 世代のみ（推移は次回以降に蓄積） — ${escapeHtml(gens[0].date)}${skippedNote}</p>
</section>`;
  }
  const ids = [...new Set(gens.flatMap((g) => Object.keys(g.benches ?? {})))].sort();
  const rows = ids.map((id) => {
    const points = gens.map((g) => ({ date: g.date, b: g.benches?.[id] })).filter((p) => p.b);
    if (points.length === 0) return '';
    const first = points[0].b;
    const last = points[points.length - 1].b;
    const seriesByKey = {};
    for (const m of ['p50', 'p95', 'p99']) {
      seriesByKey[m] = points.map((p) => (p.b.wall ? p.b.wall[m] : null));
    }
    const spark = sparkline(seriesByKey);
    const vals = [];
    for (const m of ['p50', 'p95', 'p99']) {
      vals.push(`${m}: ${fmtNum(first.wall?.[m])}→${fmtNum(last.wall?.[m])}ms`);
    }
    vals.push(`heap: ${fmtKB(first.heap)}→${fmtKB(last.heap)}KiB`);
    for (const c of Object.keys(last.counters ?? {})) {
      vals.push(`${c}: ${fmtNum(first.counters?.[c])}→${fmtNum(last.counters?.[c])}`);
    }
    const scalings = points.map((p) => p.b.scalingExponent).filter((v) => typeof v === 'number');
    const scalingTxt = scalings.length >= 2
      ? `${fmtNum(scalings[0])}→${fmtNum(scalings[scalings.length - 1])}`
      : fmtNum(scalings[0]);
    const range = `${escapeHtml(points[0].date)} → ${escapeHtml(points[points.length - 1].date)}（${points.length} 世代）`;
    return (
      `<tr><td>${escapeHtml(id)}</td>` +
        `<td>${spark || '<span class="muted">—</span>'}</td>` +
        `<td class="trend-vals">${vals.map((v) => escapeHtml(v)).join('<br/>')}</td>` +
        `<td>${escapeHtml(scalingTxt)}</td>` +
        `<td class="muted">${range}</td>` +
      '</tr>'
    );
  });
  if (rows.length === 0) rows.push('<tr><td colspan="5" class="muted">no trend data</td></tr>');
  return `
<section class="card" id="trend">
  <h2>Trend</h2>
  <p class="meta">Generations: ${gens.length}${skippedNote}</p>
  <table>
    <thead><tr><th>Bench</th><th>Timeline (L: p50/p95/p99)</th><th>First → Last</th><th>Scaling</th><th>Range</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
</section>`;
}
