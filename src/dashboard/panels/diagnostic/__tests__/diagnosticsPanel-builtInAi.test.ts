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
  test('available: renders only the status row and hides the download button', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'available', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(statsEl.textContent).toContain('Available');
    expect(downloadBtn.classList.contains('hidden')).toBe(true);
  });

  test('downloadable: shows the download button', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'downloadable', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(downloadBtn.classList.contains('hidden')).toBe(false);
  });

  test('downloading: keeps the download button hidden', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'downloading', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(downloadBtn.classList.contains('hidden')).toBe(true);
  });

  test('unavailable with guidance: shows the flag URL and flag name', () => {
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

  test('unavailable without guidance: shows the generic unsupported message', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();
    const result: BuiltInAiDiagnosticsResult = { status: 'unavailable', guidance: null };

    renderBuiltInAiStatus(statsEl, downloadBtn, result);

    expect(statsEl.textContent).toContain('This browser does not support built-in AI.');
  });

  test('clears existing content on re-render', () => {
    const statsEl = createStatsEl();
    const downloadBtn = createDownloadBtn();

    renderBuiltInAiStatus(statsEl, downloadBtn, { status: 'unavailable', guidance: null });
    renderBuiltInAiStatus(statsEl, downloadBtn, { status: 'available', guidance: null });

    expect(statsEl.textContent).not.toContain('does not support');
    expect(statsEl.textContent).toContain('Available');
  });
});
