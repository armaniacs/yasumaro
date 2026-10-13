/**
 * aiTestRunner.ts
 * AI 接続テストの実行ループと in-flight guard の単一実装。
 *
 * 「一般設定」と「診断」の 2 面は、同じループ（runId 生成 → 進捗購読 →
 * 経過時間の interval → TEST_AI 送信 → 結果行の描画）をそれぞれ複製して
 * いた。ステップ定義・進捗間隔・二重実行の防ぎ方を片方だけ直すと 2 面の
 * 表示が食い違うため、実行の順序と guard をここへ移した。描画先と結果行の
 * サマリは面ごとの表現なので注入引数として呼び出し側に残す。
 *
 * 進捗 DOM（aiTestProgressView）と結果行の整形（aiTestResultView）は
 * 従来どおり共有モジュールが所有する。
 */

import { type AiTestProgress, type AiProviderTestResult, type MultiProviderTestResult } from '../background/ai/AIService.js';
import { subscribeAiTestProgress, generateAiTestRunId } from './aiTestProgressClient.js';
import { clearElement } from '../utils/domClear.js';
import {
  buildAiTestProgressView,
  renderAiTestProgressLabel,
  renderAiTestProgressElapsed,
} from './aiTestProgressView.js';
import { formatProviderHeadline, formatProviderDetailLines } from './aiTestResultView.js';

/** 経過時間の表示を 200ms ごとに更新する。 */
const DEFAULT_PROGRESS_INTERVAL_MS = 200;

/** 面ごとの描画差分。ループの順序は runner が持ち、ここは「何を書くか」だけ。 */
export interface AiTestRunDraw {
  /** プロバイダ切替のたびに live region のラベルを読み上げる。 */
  onProviderAnnounced?: () => void;
  /** 経過時間の複製先（一般設定の #statusTop）。無ければ同期しない。 */
  elapsedMirror?: HTMLElement | null;
  /** 進捗ビューの最初のフレームを描画した後。 */
  onProgressStarted?: () => void;
  /** 複数プロバイダ時の結果サマリ行を描画する。 */
  multiProviderSummary: (target: HTMLElement, result: MultiProviderTestResult) => void;
  /** 単一プロバイダ（またはプロバイダ無し）の結果行を描画する。 */
  singleProviderSummary: (target: HTMLElement, result: MultiProviderTestResult) => void;
  /** サマリ行とプロバイダ行を描画した後。 */
  onResultRendered?: (target: HTMLElement, result: MultiProviderTestResult) => void;
  /** テストが例外で終わったときの表示。 */
  onError: (target: HTMLElement, error: unknown) => void;
}

export interface AiTestRunOptions {
  /** 進捗と結果を書き込む描画先。 */
  target: HTMLElement;
  /**
   * TEST_AI の送信。runId を渡して進捗を相関させる。
   * transport は generalSettings/connectionTests.js にあり、そのモジュールが
   * 本 runner を import するため、注入して import の循環を避けている。
   */
  run: (runId: string) => Promise<MultiProviderTestResult>;
  draw: AiTestRunDraw;
  /**
   * 進捗ビューを表示した直後・送信の前に実行する前処理。
   * false を返すと送信せず終了する（失敗表示はフック側の責任）。
   */
  prepare?: () => Promise<boolean | void> | boolean | void;
  /** guard を取った直後に呼ばれる（ボタンの無効化など）。 */
  onStart?: () => void;
  /** 進捗購読・interval・guard を片付けた後、成敗にかかわらず呼ばれる。 */
  onFinish?: () => void;
  /** 経過時間の更新間隔。テストから注入する。 */
  intervalMs?: number;
}

/**
 * `ran`: 送信して結果を描画 / `aborted`: prepare が false で送信しない /
 * `failed`: 送信が例外で終わった（onError が描画済み） / `guarded`: 実行中のため抑止。
 */
export type AiTestRunOutcome = 'ran' | 'aborted' | 'failed' | 'guarded';

/**
 * 二重実行の guard。一般設定と診断が同じモジュールを使うので、片方で実行中に
 * もう片方のボタンを押しても二重送信にならない。押した側のボタンだけを無効化
 * （旧実装が 2 つのフラグを持っていた）する方式では防げなかった。
 */
let aiTestInFlight = false;

/**
 * プロバイダごとの結果行と見出し行の描画。2 面の表示が同一なので共有する。
 */
export function renderAiTestProviderLines(target: HTMLElement, providers: readonly AiProviderTestResult[]): void {
  for (const provider of providers) {
    const row = document.createElement('div');
    row.className = 'diag-indent';
    row.textContent = formatProviderHeadline(provider);
    row.classList.add(provider.success ? 'diag-success' : 'diag-error');
    target.appendChild(row);

    // 何を送って何が返ったかを1行ずつ表示する
    for (const line of formatProviderDetailLines(provider)) {
      const detailRow = document.createElement('div');
      detailRow.className = 'diag-indent ai-debug-details';
      detailRow.textContent = line;
      target.appendChild(detailRow);
    }
  }
}

function renderResult(
  target: HTMLElement,
  result: MultiProviderTestResult,
  draw: AiTestRunDraw,
): void {
  clearElement(target);
  const providers = result.providers ?? [];
  if (providers.length > 1) {
    draw.multiProviderSummary(target, result);
    renderAiTestProviderLines(target, providers);
  } else {
    draw.singleProviderSummary(target, result);
  }
  draw.onResultRendered?.(target, result);
}

/**
 * AI 接続テストを 1 回走らせる。実行順序は
 * guard → runId → 進捗購読 → 経過時間 interval → prepare → TEST_AI → 結果描画。
 */
export async function runAiConnectionTest(options: AiTestRunOptions): Promise<AiTestRunOutcome> {
  if (aiTestInFlight) return 'guarded';
  const { target, draw, run, prepare, onStart, onFinish } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;

  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeProgress: (() => void) | undefined;
  try {
    aiTestInFlight = true;
    onStart?.();

    const startTime = performance.now();
    // Correlation id for this test run so that when multiple Dashboard tabs run a
    // test concurrently, each tab only renders the progress it initiated.
    const runId = generateAiTestRunId();
    let latestProgress: AiTestProgress | undefined;
    let lastProviderKey = '';

    const view = buildAiTestProgressView(target);

    // announceProvider=true re-renders the live-region label (only on provider
    // switch); the elapsed timer updates textContent only and is aria-hidden.
    const updateView = (announceProvider: boolean): void => {
      if (announceProvider) {
        renderAiTestProgressLabel(view, latestProgress);
        draw.onProviderAnnounced?.();
      }
      renderAiTestProgressElapsed(view, startTime, draw.elapsedMirror);
    };

    unsubscribeProgress = subscribeAiTestProgress(runId, (progress) => {
      latestProgress = progress;
      const key = `${progress.provider}:${progress.index}`;
      const changed = key !== lastProviderKey;
      lastProviderKey = key;
      updateView(changed);
    });

    renderAiTestProgressLabel(view, undefined);
    renderAiTestProgressElapsed(view, startTime);
    draw.onProgressStarted?.();
    elapsedTimer = setInterval(() => updateView(false), intervalMs);

    try {
      if (prepare && (await prepare()) === false) return 'aborted';
      renderResult(target, await run(runId), draw);
      return 'ran';
    } catch (error) {
      draw.onError(target, error);
      return 'failed';
    }
  } finally {
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (unsubscribeProgress) unsubscribeProgress();
    onFinish?.();
    aiTestInFlight = false;
  }
}
