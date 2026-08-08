/**
 * aiTestResultView.ts
 * AI接続テスト結果の表示整形。
 *
 * 「初期設定」画面(dashboard.ts)と「診断」画面(diagnosticsPanel.ts)で
 * 同じ整形ロジックが重複していたため、純関数として切り出した。
 * DOM を触らず文字列を返すので単体テストできる。
 */

import { PROVIDER_LABELS } from '../background/aiClient.js';

/** 表示に必要な範囲だけを受け取る（aiClient の型に依存しすぎないため） */
export interface AiTestProviderView {
  provider: string;
  model?: string;
  success: boolean;
  message: string;
  elapsedMs: number;
  debug?: {
    prompt?: string;
    response?: string;
    error?: string;
    statusCode?: number;
    hasContent?: boolean;
    availability?: string;
    endpoint?: string;
    modelName?: string;
    sentTokens?: number;
    receivedTokens?: number;
  };
}

/**
 * 所要時間を人が読める形に整形する。
 *
 * 以前は常に `(elapsedMs/1000).toFixed(1)` としていたため、50ms未満が
 * すべて「0.0秒」になり計測値として意味をなさなかった。1秒未満はミリ秒で
 * 出すことで、実際にどれだけ速かったのかが読み取れる。
 */
export function formatElapsed(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '-';
  if (elapsedMs < 1000) return `${Math.round(elapsedMs)}ms`;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

/** プロバイダ表示名を Object.prototype 汚染なしで引く */
export function providerLabel(provider: string): string {
  return Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, provider)
    ? PROVIDER_LABELS[provider]
    : provider;
}

/** 1プロバイダぶんの見出し行（✓/✗ ラベル(モデル): メッセージ (所要時間)） */
export function formatProviderHeadline(p: AiTestProviderView): string {
  const label = providerLabel(p.provider);
  const model = p.model ? ` (${p.model})` : '';
  return `${p.success ? '✓' : '✗'} ${label}${model}: ${p.message} (${formatElapsed(p.elapsedMs)})`;
}

/**
 * 送受信内容の詳細行。何を送って何が返ったかを最初に置く。
 * 長い応答は折り返して読めるよう、呼び出し側で pre-wrap 前提の要素に入れる。
 */
export function formatProviderDetailLines(p: AiTestProviderView): string[] {
  const d = p.debug;
  if (!d) return [];

  const lines: string[] = [];
  if (d.endpoint) lines.push(`送信先 / Endpoint: ${d.endpoint}`);
  if (d.prompt) lines.push(`送信内容 / Sent: ${d.prompt}`);
  if (d.response) lines.push(`受信内容 / Received: ${d.response}`);
  if (d.error) lines.push(`エラー / Error: ${d.error}`);

  const meta: string[] = [];
  if (d.modelName) meta.push(`model=${d.modelName}`);
  if (d.statusCode !== undefined) meta.push(`HTTP ${d.statusCode}`);
  if (d.sentTokens !== undefined) meta.push(`sent tokens=${d.sentTokens}`);
  if (d.receivedTokens !== undefined) meta.push(`received tokens=${d.receivedTokens}`);
  if (d.availability) meta.push(`availability=${d.availability}`);
  if (d.hasContent !== undefined) meta.push(`has content=${d.hasContent}`);
  if (meta.length > 0) lines.push(meta.join(' | '));

  return lines;
}
