import type { SavedUrlEntry } from '../utils/storageUrls.js';

export interface CleansingStats {
  count: number;
  avgPageBytes: number;
  avgFinalBytes: number;
  avgReductionRate: number;
  totalSavedBytes: number;
  funnelAvg: {
    page: number;
    candidate: number;
    cleansed: number;
    aiCleansed: number;
  };
}

export function computeCleansingStats(entries: SavedUrlEntry[]): CleansingStats {
  const valid = entries.filter(e => e.pageBytes !== undefined && (e.aiSummaryCleansedBytes !== undefined || e.cleansedBytes !== undefined));

  if (valid.length === 0) {
    return { count: 0, avgPageBytes: 0, avgFinalBytes: 0, avgReductionRate: 0, totalSavedBytes: 0, funnelAvg: { page: 0, candidate: 0, cleansed: 0, aiCleansed: 0 } };
  }

  let sumPage = 0;
  let sumCandidate = 0;
  let sumCleansed = 0;
  let sumAiCleansed = 0;
  let sumFinal = 0;
  let sumReductionRate = 0;
  let sumSaved = 0;

  for (const e of valid) {
    const page = e.pageBytes!;
    const candidate = e.candidateBytes ?? page;
    const cleansed = e.cleansedBytes ?? candidate;
    const aiCleansed = e.aiSummaryCleansedBytes ?? cleansed;
    const final = aiCleansed;
    const saved = page - final;
    const rate = page > 0 ? (saved / page) * 100 : 0;

    sumPage += page;
    sumCandidate += candidate;
    sumCleansed += cleansed;
    sumAiCleansed += aiCleansed;
    sumFinal += final;
    sumReductionRate += rate;
    sumSaved += saved;
  }

  const n = valid.length;
  return {
    count: n,
    avgPageBytes: Math.round(sumPage / n),
    avgFinalBytes: Math.round(sumFinal / n),
    avgReductionRate: sumReductionRate / n,
    totalSavedBytes: sumSaved,
    funnelAvg: {
      page: Math.round(sumPage / n),
      candidate: Math.round(sumCandidate / n),
      cleansed: Math.round(sumCleansed / n),
      aiCleansed: Math.round(sumAiCleansed / n),
    },
  };
}

/**
 * 案A: 統計サマリーカードを指定要素に描画する
 */
export function renderStatsSummary(container: HTMLElement, stats: CleansingStats): void {
  if (stats.count === 0) {
    container.className = 'cleansing-stats-summary no-data';
    container.textContent = '削減率データがありません。クレンジングを有効にして数件記録すると統計が表示されます。';
    return;
  }

  container.className = 'cleansing-stats-summary';

  const totalSavedKB = (stats.totalSavedBytes / 1024).toFixed(1);

  const cards = [
    { value: `${stats.avgReductionRate.toFixed(1)}%`, label: '平均削減率' },
    { value: `${totalSavedKB} KB`, label: '累計削減量' },
    { value: `${stats.count}件`, label: '集計対象' },
  ];

  container.innerHTML = cards.map(c => `
    <div class="stats-card">
      <div class="stats-card-value">${c.value}</div>
      <div class="stats-card-label">${c.label}</div>
    </div>
  `).join('');
}

const FUNNEL_LABELS = ['DOM全体', '候補絞込', 'Content\nCleansing', 'AI要約\nクレンジング'];
const FUNNEL_COLOR = '#7c3aed';
const FUNNEL_COLOR_FINAL = '#10b981';

/**
 * 案B: ファネルチャートを Canvas に描画する
 * jsdom 環境では getContext が null のため何もしない（テスト対応）
 */
export function renderFunnelChart(canvas: HTMLCanvasElement, stats: CleansingStats): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (stats.count === 0) return;

  const values = [
    stats.funnelAvg.page,
    stats.funnelAvg.candidate,
    stats.funnelAvg.cleansed,
    stats.funnelAvg.aiCleansed,
  ];

  const maxVal = values[0];
  if (maxVal === 0) return;

  const paddingLeft = 110;
  const paddingRight = 80;
  const paddingTop = 20;
  const paddingBottom = 20;
  const chartWidth = W - paddingLeft - paddingRight;
  const barHeight = 32;
  const barGap = 16;
  const totalBarsHeight = values.length * barHeight + (values.length - 1) * barGap;
  const startY = paddingTop + (H - paddingTop - paddingBottom - totalBarsHeight) / 2;

  values.forEach((val, i) => {
    const barWidth = (val / maxVal) * chartWidth;
    const y = startY + i * (barHeight + barGap);
    const isLast = i === values.length - 1;
    const color = isLast ? FUNNEL_COLOR_FINAL : FUNNEL_COLOR;
    const alpha = isLast ? 1 : 0.4 + (1 - i / values.length) * 0.5;

    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(paddingLeft, y, barWidth, barHeight, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#1e293b';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    const labelLines = FUNNEL_LABELS[i].split('\n');
    if (labelLines.length === 1) {
      ctx.fillText(labelLines[0], paddingLeft - 8, y + barHeight / 2 + 4);
    } else {
      ctx.fillText(labelLines[0], paddingLeft - 8, y + barHeight / 2 - 3);
      ctx.fillText(labelLines[1], paddingLeft - 8, y + barHeight / 2 + 10);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#475569';
    const kb = (val / 1024).toFixed(1);
    ctx.fillText(`${kb} KB`, paddingLeft + barWidth + 6, y + barHeight / 2 + 4);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#065f46';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(`平均 ${stats.avgReductionRate.toFixed(1)}% 削減`, W / 2, H - 4);
}

/**
 * 案C: 1エントリ分のクレンジングプログレスバー要素を生成する。
 * pageBytes がない、または最終バイトがない場合は null を返す。
 */
export function makeCleansingProgressBar(entry: SavedUrlEntry): HTMLElement | null {
  const page = entry.pageBytes;
  const final = entry.aiSummaryCleansedBytes ?? entry.cleansedBytes;

  if (page === undefined || final === undefined) return null;
  if (page === 0) return null;

  const finalRatio = final / page;
  const reductionRate = (1 - finalRatio) * 100;

  const wrapper = document.createElement('div');
  wrapper.className = 'cleansing-progress-wrapper';

  const track = document.createElement('div');
  track.className = 'cleansing-progress';

  const bar = document.createElement('div');
  bar.className = 'cleansing-progress-bar';
  bar.style.width = `${(finalRatio * 100).toFixed(1)}%`;

  track.appendChild(bar);

  const label = document.createElement('span');
  label.className = 'cleansing-progress-label';
  label.textContent = `${reductionRate.toFixed(1)}% 削減`;

  wrapper.appendChild(track);
  wrapper.appendChild(label);

  return wrapper;
}