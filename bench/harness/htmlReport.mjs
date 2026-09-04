/**
 * htmlReport.mjs — render micro-bench results as a single self-contained HTML
 * file. Inline CSS/JS only (zero external resources) so the report renders
 * identically over file://, offline, and in CI.
 *
 * The report's job is human judgment support: show which metrics moved and by
 * how much, not just a PASS/FAIL verdict (the bench:check gate covers that).
 */
import { fmtNum, fmtKB } from './format.mjs';

/** Escape a string for safe interpolation into HTML text and attributes. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const VERDICT_CLASS = {
  'sub-linear': 'v-good',
  linear: 'v-ok',
  'super-linear': 'v-warn',
  quadratic: 'v-bad',
  'polynomial-or-worse': 'v-bad',
  'insufficient-data': 'v-muted',
  unknown: 'v-muted',
};

const STATUS_CLASS = {
  regressed: 'st-regressed',
  improved: 'st-improved',
  'worse-ungated': 'st-ungated',
  ok: 'st-ok',
  new: 'st-new',
};

const CSS = `
:root { color-scheme: light; }
body { font-family: system-ui, sans-serif; margin: 24px; color: #1a2233; background: #f6f7fa; }
h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin: 0 0 8px; }
.badge { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: .8rem; color: #fff; }
.v-good { background: #0b7a4b; } .v-ok { background: #2b6cb0; } .v-warn { background: #b7791f; }
.v-bad { background: #b42318; } .v-muted { background: #667085; }
.st-regressed { color: #b42318; font-weight: 600; } .st-improved { color: #0b7a4b; font-weight: 600; }
.st-ungated { color: #b7791f; } .st-ok { color: #475467; } .st-new { color: #475467; }
.meta { color: #475467; margin: 0 0 8px; }
.card { background: #fff; border: 1px solid #d8dde8; border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
.chart .bar-p50 { fill: #7aa5d8; } .chart .bar-p95 { fill: #2b6cb0; } .chart .bar-p99 { fill: #16365c; }
.axis { font: 10px system-ui; fill: #475467; } .axis-line { stroke: #d8dde8; }
.chips { margin: 8px 0 0; } .chip { display: inline-block; background: #eef1f7; border-radius: 6px; padding: 2px 8px; margin: 2px 4px 2px 0; font: 12px ui-monospace, monospace; }
table { border-collapse: collapse; width: 100%; font: 13px ui-monospace, monospace; }
th, td { text-align: right; padding: 4px 10px; border-bottom: 1px solid #e4e8f0; }
th:first-child, td:first-child { text-align: left; }
body:not(.show-ok) tr.row-ok { display: none; }
.muted { color: #667085; } .toggle { font-size: 13px; color: #475467; }
`;

const JS = `
document.getElementById('show-all-rows')?.addEventListener('change', (e) => {
  document.body.classList.toggle('show-ok', e.target.checked);
});
`;

/** Grouped horizontal bars (p50/p95/p99 per size), decorative — values also appear as text chips. */
function barChartSvg(perSize) {
  const sizes = Object.entries(perSize);
  const max = Math.max(...sizes.map(([, s]) => Math.max(s.wallMs.p50, s.wallMs.p95, s.wallMs.p99)), 0);
  if (!(max > 0)) return '';
  const groupW = 120;
  const barW = 32;
  const gap = 4;
  const chartH = 80;
  const width = sizes.length * groupW + 8;
  const parts = [
    `<svg class="chart" aria-hidden="true" width="${width}" height="${chartH + 18}" viewBox="0 0 ${width} ${chartH + 18}">`,
  ];
  sizes.forEach(([sizeKey, s], i) => {
    const x0 = 4 + i * groupW;
    ['p50', 'p95', 'p99'].forEach((m, j) => {
      const h = Math.max(1, Math.round((s.wallMs[m] / max) * chartH));
      const x = x0 + j * (barW + gap);
      parts.push(`<rect x="${x}" y="${chartH - h}" width="${barW}" height="${h}" class="bar-${m}"><title>${escapeHtml(sizeKey)} ${m}: ${fmtNum(s.wallMs[m])}ms</title></rect>`);
    });
    parts.push(`<text x="${x0 + (barW * 3 + gap * 2) / 2}" y="${chartH + 14}" text-anchor="middle" class="axis">${escapeHtml(sizeKey)} (N=${s.n})</text>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

function benchCard(r) {
  const chips = [];
  for (const [sizeKey, s] of Object.entries(r.perSize)) {
    chips.push(`<span class="chip">${escapeHtml(sizeKey)} heap=${fmtKB(s.heapBytes.p50)}KiB</span>`);
    for (const [c, v] of Object.entries(s.counters ?? {})) {
      chips.push(`<span class="chip">${escapeHtml(sizeKey)}.${escapeHtml(c)}=${fmtNum(v)}</span>`);
    }
  }
  const vc = VERDICT_CLASS[r.scaling.verdict] ?? 'v-muted';
  return `
<section class="card" id="bench-${escapeHtml(r.id)}">
  <h2>${escapeHtml(r.id)}${r.description ? ` — ${escapeHtml(r.description)}` : ''}</h2>
  <p class="meta">warmup ${r.config.warmup} · measure ${r.config.measure} · scaling exponent <strong>${fmtNum(r.scaling.exponent)}</strong> <span class="badge ${vc}">${escapeHtml(r.scaling.verdict)}</span></p>
  ${barChartSvg(r.perSize) || '<p class="muted">no size data</p>'}
  <p class="chips">${chips.join('')}</p>
</section>`;
}

function comparisonTable(comparison) {
  const rows = comparison.rows.map((row) => {
    const cls = STATUS_CLASS[row.status] ?? 'st-ok';
    const hidden = row.status === 'ok' ? ' row-ok' : '';
    return (
      `<tr class="${cls}${hidden}" data-status="${escapeHtml(row.status)}">` +
        `<td>${escapeHtml(row.metric)}</td>` +
        `<td>${fmtNum(row.baseline)}</td>` +
        `<td>${fmtNum(row.current)}</td>` +
        `<td>${row.deltaPct === null ? '—' : fmtNum(row.deltaPct, '%')}</td>` +
        `<td>${escapeHtml(row.status)}</td>` +
      '</tr>'
    );
  });
  if (rows.length === 0) rows.push('<tr><td colspan="5" class="muted">no metrics</td></tr>');
  return `
<section class="card" id="comparison">
  <h2>Baseline comparison</h2>
  <label class="toggle"><input type="checkbox" id="show-all-rows" /> show unchanged rows</label>
  <table>
    <thead><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Δ%</th><th>Status</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
</section>`;
}

/**
 * @param {Awaited<ReturnType<import('./runner.mjs').bench>>[]} results
 * @param {{ comparison?: ReturnType<typeof import('./report.mjs').compareToBaseline>, title?: string }} [opts]
 */
export function renderHtml(results, opts = {}) {
  const { comparison, title = 'Micro Benchmark Report' } = opts;
  const badge = comparison
    ? comparison.ok === true
      ? '<span class="badge v-good">PASS</span>'
      : comparison.ok === false
        ? '<span class="badge v-bad">REGRESSED</span>'
        : '<span class="badge v-muted">UNKNOWN</span>'
    : '<span class="badge v-muted">baseline 未登録</span>';
  const cards = results.map(benchCard).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${escapeHtml(title)} ${badge}</h1>
<p class="meta">Generated: ${new Date().toISOString()} · Node: ${escapeHtml(process.version)} · Benches: ${escapeHtml(results.map((r) => r.id).join(', '))}</p>
${cards}
${comparison ? comparisonTable(comparison) : ''}
<script>${JS}</script>
</body>
</html>
`;
}
