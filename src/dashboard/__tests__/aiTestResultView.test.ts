/**
 * aiTestResultView.test.ts
 *
 * AI接続テスト結果の表示整形のテスト。DOMを使わない純関数なので直接検証できる。
 * 特に formatElapsed は「50ms未満が全部 0.0秒 になる」という表示バグの回帰防止。
 */
import { describe, it, expect } from 'vitest';

import {
  formatElapsed,
  providerLabel,
  formatProviderHeadline,
  formatProviderDetailLines,
  type AiTestProviderView,
} from '../aiTestResultView.js';

describe('formatElapsed', () => {
  it('renders sub-second durations in milliseconds without rounding to 0.0s', () => {
    expect(formatElapsed(42)).toBe('42ms');
    expect(formatElapsed(1)).toBe('1ms');
    expect(formatElapsed(999)).toBe('999ms');
  });

  it('renders durations of one second or more in seconds', () => {
    expect(formatElapsed(1000)).toBe('1.0s');
    expect(formatElapsed(16200)).toBe('16.2s');
  });

  it('renders 0ms as 0ms without losing information', () => {
    expect(formatElapsed(0)).toBe('0ms');
  });

  it('returns - for invalid values', () => {
    expect(formatElapsed(NaN)).toBe('-');
    expect(formatElapsed(-1)).toBe('-');
    expect(formatElapsed(Infinity)).toBe('-');
  });
});

describe('providerLabel', () => {
  it('converts known providers to display names', () => {
    expect(providerLabel('gemini')).toBe('Google Gemini');
  });

  it('returns unknown provider IDs as-is', () => {
    expect(providerLabel('unknown-provider')).toBe('unknown-provider');
  });

  it('does not pick up Object.prototype keys (catalog is a Map so it is safe)', () => {
    expect(providerLabel('toString')).toBe('toString');
    expect(providerLabel('constructor')).toBe('constructor');
  });
});

describe('formatProviderHeadline', () => {
  const base: AiTestProviderView = {
    provider: 'gemini',
    model: 'gemini-test',
    success: true,
    message: 'Connected to Gemini API.',
    elapsedMs: 320,
  };

  it('includes a checkmark and duration on success', () => {
    expect(formatProviderHeadline(base))
      .toBe('✓ Google Gemini (gemini-test): Connected to Gemini API. (320ms)');
  });

  it('uses ✗ on failure', () => {
    expect(formatProviderHeadline({ ...base, success: false, message: 'Invalid API key' }))
      .toContain('✗');
  });

  it('omits parentheses when no model is specified', () => {
    const { model: _model, ...noModel } = base;
    expect(formatProviderHeadline(noModel as AiTestProviderView))
      .toBe('✓ Google Gemini: Connected to Gemini API. (320ms)');
  });
});

describe('formatProviderDetailLines', () => {
  it('renders sent and received content explicitly', () => {
    const lines = formatProviderDetailLines({
      provider: 'gemini',
      success: true,
      message: 'ok',
      elapsedMs: 100,
      debug: {
        prompt: 'Reply with the single word: OK',
        response: 'OK',
        endpoint: 'POST https://example.com/v1beta/models/x:generateContent',
      },
    });

    expect(lines.some(l => l.includes('送信先') && l.includes('generateContent'))).toBe(true);
    expect(lines.some(l => l.includes('送信内容') && l.includes('Reply with the single word: OK'))).toBe(true);
    expect(lines.some(l => l.includes('受信内容') && l.includes('OK'))).toBe(true);
  });

  it('summarizes token counts and HTTP status in a meta line', () => {
    const lines = formatProviderDetailLines({
      provider: 'openai-compatible',
      success: true,
      message: 'ok',
      elapsedMs: 100,
      debug: { statusCode: 200, sentTokens: 7, receivedTokens: 1, modelName: 'test-model' },
    });

    const meta = lines.find(l => l.includes('HTTP 200'));
    expect(meta).toBeDefined();
    expect(meta).toContain('sent tokens=7');
    expect(meta).toContain('received tokens=1');
    expect(meta).toContain('model=test-model');
  });

  it('renders the error when present', () => {
    const lines = formatProviderDetailLines({
      provider: 'gemini',
      success: false,
      message: 'failed',
      elapsedMs: 50,
      debug: { error: 'Invalid API key' },
    });

    expect(lines.some(l => l.includes('エラー') && l.includes('Invalid API key'))).toBe(true);
  });

  it('returns an empty array when debug is missing', () => {
    expect(formatProviderDetailLines({
      provider: 'gemini', success: true, message: 'ok', elapsedMs: 10,
    })).toEqual([]);
  });
});
