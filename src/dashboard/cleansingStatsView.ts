import type { SavedUrlEntry } from '../utils/storageUrls.js';
import { CLEANSING_GRAPH_COLORS_LIGHT, CLEANSING_GRAPH_COLORS_DARK } from '../constants/appConstants.js';
import { getMessageOr } from '../utils/i18n.js';

function t(key: string): string {
  return getMessageOr(key, key);
}

/**
 * バイト数を4桁有効数字で KB / MB / GB に自動変換する
 */
function formatBytes(bytes: number): string {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  const KB = 1024;

  if (bytes >= GB) {
    return `${parseFloat((bytes / GB).toPrecision(4))} GB`;
  } else if (bytes >= MB) {
    return `${parseFloat((bytes / MB).toPrecision(4))} MB`;
  } else {
    return `${parseFloat((bytes / KB).toPrecision(4))} KB`;
  }
}

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
    container.textContent = t('cleansingStatsNoData');
    return;
  }

  container.className = 'cleansing-stats-summary';

  const cards = [
    { value: `${stats.avgReductionRate.toFixed(1)}%`, label: t('cleansingStatsAvgRate') },
    { value: formatBytes(stats.totalSavedBytes), label: t('cleansingStatsTotalSaved') },
    { value: `${stats.count}${t('cleansingStatsCountSuffix')}`, label: t('cleansingStatsCount') },
  ];

  container.innerHTML = cards.map(c => `
    <div class="stats-card">
      <div class="stats-card-value">${c.value}</div>
      <div class="stats-card-label">${c.label}</div>
    </div>
  `).join('');
}

function getFunnelLabels(): string[] {
  return [t('cleansingFunnelDom'), t('cleansingFunnelCandidate'), 'Content\nCleansing', t('cleansingFunnelAi')];
}

// WCAG 2.0 AA準拠カラーパレット（ライト/ダーク両対応）
// ライト: 背景 #f8fafc に対して各色のコントラスト比を確保
// ダーク: 背景 #161b22 に対して各色のコントラスト比を確保
const CHART_COLORS = {
  light: {
    bar: CLEANSING_GRAPH_COLORS_LIGHT.BAR,
    barFinal: CLEANSING_GRAPH_COLORS_LIGHT.BAR_FINAL,
    label: CLEANSING_GRAPH_COLORS_LIGHT.LABEL,
    value: CLEANSING_GRAPH_COLORS_LIGHT.VALUE,
    footer: CLEANSING_GRAPH_COLORS_LIGHT.FOOTER,
  },
  dark: {
    bar: CLEANSING_GRAPH_COLORS_DARK.BAR,
    barFinal: CLEANSING_GRAPH_COLORS_DARK.BAR_FINAL,
    label: CLEANSING_GRAPH_COLORS_DARK.LABEL,
    value: CLEANSING_GRAPH_COLORS_DARK.VALUE,
    footer: CLEANSING_GRAPH_COLORS_DARK.FOOTER,
  },
};

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

  const maxVal = values[0] ?? 0;
  if (maxVal === 0) return;

  // ダークモード判定（document.documentElement の data-theme またはメディアクエリ）
  const isDark =
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light;

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
    // 透明度なし: バー色の濃淡は色そのもので表現してコントラストを確保
    const color = isLast ? colors.barFinal : colors.bar;
    // 最初のバーを100%、後になるほど自然に短くなるので透明度不要
    // ただし視覚的な階層感のため軽微な透明度のみ（0.7以上を維持）
    const alpha = isLast ? 1 : 0.7 + (1 - i / values.length) * 0.3;

    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(paddingLeft, y, barWidth, barHeight, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = colors.label;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    const funnelLabels = getFunnelLabels();
    const labelLine = funnelLabels[i];
    if (labelLine == null) return;
    const labelLines = labelLine.split('\n');
    const line0 = labelLines[0] ?? '';
    const line1 = labelLines[1] ?? '';
    if (labelLines.length === 1) {
      ctx.fillText(line0, paddingLeft - 8, y + barHeight / 2 + 4);
    } else {
      ctx.fillText(line0, paddingLeft - 8, y + barHeight / 2 - 3);
      ctx.fillText(line1, paddingLeft - 8, y + barHeight / 2 + 10);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = colors.value;
    ctx.fillText(formatBytes(val), paddingLeft + barWidth + 6, y + barHeight / 2 + 4);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = colors.footer;
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(`${t('cleansingFunnelFooter')} ${stats.avgReductionRate.toFixed(1)}%`, W / 2, H - 4);
}

/**
 * 案C: 1エントリ分のクレンジングプログレスバー要素を生成する。
 * pageBytes がない、または最終バイトがない場合は null を返す。
 */
export function makeCleansingProgressBar(entry: SavedUrlEntry): HTMLElement | null {
  // base: ページの元のDOMサイズ（コンテンツ抽出開始点）
  const base = entry.pageBytes;

  // sentToAI: AIに実際に送られたバイト数
  // フォールバック発動時は aiSummaryCleansedBytes は無効 → cleansedBytes / originalBytes を使う
  // aiSummaryOriginalBytes がある場合は、AI要約クレンジング前のバイト数を最終バイト数として使用
  const sentToAI = (entry.fallbackTriggered ?? false)
    ? (entry.cleansedBytes ?? entry.originalBytes)
    : (entry.aiSummaryCleansedBytes ?? entry.aiSummaryOriginalBytes ?? entry.cleansedBytes ?? entry.originalBytes);

  if (base === undefined || sentToAI === undefined) return null;
  if (base === 0) return null;

  const sentRatio = Math.min(sentToAI / base, 1);
  // 100.0%（完全削減に見える）は誤解を招くため99.9%でキャップ
  const reductionRate = Math.min((1 - sentRatio) * 100, 99.9);

  // 人間が読みやすいバイト表示
  const formatBytes = (b: number): string => {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'cleansing-progress-wrapper';

  const track = document.createElement('div');
  track.className = 'cleansing-progress';

  const bar = document.createElement('div');
  bar.className = 'cleansing-progress-bar';
  bar.style.width = `${Math.max(sentRatio * 100, 0.2).toFixed(1)}%`; // 最小0.2%でバーを見えるように

  track.appendChild(bar);

  const label = document.createElement('span');
  label.className = 'cleansing-progress-label';
  // "1.76 MB → 16 KB (99.1% 削減)" のような表示
  label.textContent = `${formatBytes(base)} → ${formatBytes(sentToAI)} (${reductionRate.toFixed(1)}% ${t('cleansingReduction')})`;

  wrapper.appendChild(track);
  wrapper.appendChild(label);

  return wrapper;
}

// ---------------------------------------------------------------------------
// 30-14: 観測性ファネル — ルール別削除件数のテーブル表示
// 30-11: 二重ペイロード — originalContent 差分表示
// ---------------------------------------------------------------------------

/**
 * 30-14: ルール別削除件数をテーブルで描画する。
 * Map または Record のいずれも受け付け、空なら「除去なし」メッセージを表示。
 */
export function renderRemovedByReason(
  container: HTMLElement,
  removedByReason?: Map<string, number> | Record<string, number> | null,
): void {
  container.innerHTML = '';
  container.className = 'cleansing-removed-breakdown';

  if (!removedByReason) {
    container.textContent = t('cleansingNoRemoval') || 'クレンジングによる除去はありません';
    container.classList.add('no-data');
    return;
  }

  const entries: Array<[string, number]> =
    removedByReason instanceof Map
      ? [...removedByReason.entries()]
      : Object.entries(removedByReason as Record<string, number>);

  const filtered = entries.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  if (filtered.length === 0) {
    container.textContent = t('cleansingNoRemoval') || 'クレンジングによる除去はありません';
    container.classList.add('no-data');
    return;
  }

  const table = document.createElement('table');
  table.className = 'removed-by-reason-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>${t('cleansingRule') || 'ルール'}</th><th>${t('cleansingCount') || '件数'}</th></tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const [rule, count] of filtered) {
    const tr = document.createElement('tr');
    const tdRule = document.createElement('td');
    tdRule.textContent = rule;
    const tdCount = document.createElement('td');
    tdCount.textContent = String(count);
    tr.appendChild(tdRule);
    tr.appendChild(tdCount);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

/**
 * 30-11: originalContent と content (cleansed) の差分概要を描画する。
 * originalContent が無い場合は null を返す。差分が 80% 超なら警告を表示。
 */
export function makeDualPayloadDiff(
  entry: { content?: string; originalContent?: string; dualPayloadEnabled?: boolean } & Record<string, unknown>,
): HTMLElement | null {
  const original = entry.originalContent as string | undefined;
  const cleansed = entry.content as string | undefined;
  if (!original) return null;
  if (!cleansed) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'dual-payload-diff';

  const originalLen = original.length;
  const cleansedLen = cleansed.length;
  const removedChars = Math.max(0, originalLen - cleansedLen);
  const ratio = originalLen > 0 ? (removedChars / originalLen) * 100 : 0;

  const summary = document.createElement('div');
  summary.className = 'dual-payload-summary';
  summary.textContent = `原文 ${originalLen}字 → クレンジング後 ${cleansedLen}字 (除去 ${removedChars}字, ${ratio.toFixed(1)}%)`;
  wrapper.appendChild(summary);

  if (ratio >= 80) {
    const warn = document.createElement('div');
    warn.className = 'dual-payload-warning';
    warn.textContent = t('cleansingLargeRemovalWarning') || '多くの内容が除去されました。原文を確認してください';
    wrapper.appendChild(warn);
  }

  // 差分テキストの先頭プレビュー（最大500字）
  if (removedChars > 0) {
    const preview = document.createElement('div');
    preview.className = 'dual-payload-preview';
    // 簡易差分: original から cleansed に含まれない部分を抽出（先頭500字）
    let diffText = '';
    if (!cleansed || original.indexOf(cleansed.slice(0, 50)) === -1) {
      diffText = original.slice(0, 500);
    } else {
      // naive: original のうち cleansed に無い連続部分
      diffText = original.length > cleansed.length ? original.slice(cleansed.length, cleansed.length + 500) : original.slice(0, 500);
      if (!diffText) diffText = original.slice(0, 500);
    }
    preview.textContent = `除去内容プレビュー: ${diffText}`;
    wrapper.appendChild(preview);
  }

  return wrapper;
}

/**
 * 30-14: ファネル（page→candidate→cleansed）の3段階バイトを描画する簡易サマリー。
 * Canvas チャートの代替としてテキストサマリーを返す。
 */
export function renderFunnelSummary(
  container: HTMLElement,
  funnel?: { pageBytes: number; candidateBytes: number; cleansedBytes: number } | null,
): void {
  container.innerHTML = '';
  container.className = 'cleansing-funnel-summary';
  if (!funnel) {
    container.textContent = t('cleansingStatsNoData') || 'データなし';
    return;
  }
  const { pageBytes, candidateBytes, cleansedBytes } = funnel;
  const div = document.createElement('div');
  div.className = 'funnel-values';
  div.textContent = `${formatBytes(pageBytes)} → ${formatBytes(candidateBytes)} → ${formatBytes(cleansedBytes)}`;
  container.appendChild(div);
  const reduction = pageBytes > 0 ? ((pageBytes - cleansedBytes) / pageBytes) * 100 : 0;
  const rate = document.createElement('div');
  rate.className = 'funnel-rate';
  rate.textContent = `削減率 ${reduction.toFixed(1)}%`;
  container.appendChild(rate);
}