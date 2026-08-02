// @vitest-environment jsdom
/**
 * diagnosticsPanel-builtInAi.test.ts
 * Focused DOM tests for the built-in AI diagnostics rendering in diagnosticsPanel.ts.
 */

import { renderBuiltInAiStatus } from '../diagnosticsPanel.js';
import type { BuiltInAiDiagnosticsResult } from '../../../builtInAiDiagnosticsService.js';

function createStatsEl(): HTMLElement {
  return document.createElement('div');
}

function createDownloadBtn(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.classList.add('hidden');
  return btn;
}

describe('renderBuiltInAiStatus', () => {
  test('available: ステータス行のみ表示し、ダウンロードボタンは隠す', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'available', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(statsEl.textContent).toContain('Available');
    expect(downloadBtn.classList.contains('hidden')).toBe(true);
  });

  test('downloadable: ダウンロードボタンを表示する', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'downloadable', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(downloadBtn.classList.contains('hidden')).toBe(false);
  });

  test('downloading: ダウンロードボタンは隠したまま', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'downloading', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(downloadBtn.classList.contains('hidden')).toBe(true);
  });

  test('unavailable かつ guidance あり: フラグURL/フラグ名を表示する', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = {
      status: 'unavailable',
      guidance: { url: 'chrome://flags/#prompt-api-for-gemini-nano', flagName: 'Prompt API for Gemini Nano' },
    };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(statsEl.textContent).toContain('chrome://flags/#prompt-api-for-gemini-nano');
    expect(statsEl.textContent).toContain('Prompt API for Gemini Nano');
    expect(downloadBtn.classList.contains('hidden')).toBe(true);
  });

  test('unavailable かつ guidance なし: 汎用の非対応メッセージを表示する', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'unavailable', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(statsEl.textContent).toContain('This browser does not support built-in AI.');
  });

  test('再描画時に既存の内容をクリアする', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();

    renderBuiltInAiStatus(statsEl, downloadBtn, { status: 'unavailable', guidance: null });
    renderBuiltInAiStatus(statsEl, downloadBtn, { status: 'available', guidance: null });

    expect(statsEl.textContent).not.toContain('does not support');
    expect(statsEl.textContent).toContain('Available');
  });
});
