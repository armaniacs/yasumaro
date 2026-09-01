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
  it('1秒未満はミリ秒で表示する（0.0秒に丸めない）', () => {
    expect(formatElapsed(42)).toBe('42ms');
    expect(formatElapsed(1)).toBe('1ms');
    expect(formatElapsed(999)).toBe('999ms');
  });

  it('1秒以上は秒で表示する', () => {
    expect(formatElapsed(1000)).toBe('1.0s');
    expect(formatElapsed(16200)).toBe('16.2s');
  });

  it('0msでも 0ms と表示し、情報を失わない', () => {
    expect(formatElapsed(0)).toBe('0ms');
  });

  it('不正値は - を返す', () => {
    expect(formatElapsed(NaN)).toBe('-');
    expect(formatElapsed(-1)).toBe('-');
    expect(formatElapsed(Infinity)).toBe('-');
  });
});

describe('providerLabel', () => {
  it('既知のプロバイダは表示名に変換する', () => {
    expect(providerLabel('gemini')).toBe('Google Gemini');
  });

  it('未知のプロバイダはIDをそのまま返す', () => {
    expect(providerLabel('unknown-provider')).toBe('unknown-provider');
  });

  it('Object.prototype のキーを拾わない（catalog は Map なので安全）', () => {
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

  it('成功時はチェックマークと所要時間を含む', () => {
    expect(formatProviderHeadline(base))
      .toBe('✓ Google Gemini (gemini-test): Connected to Gemini API. (320ms)');
  });

  it('失敗時は✗を使う', () => {
    expect(formatProviderHeadline({ ...base, success: false, message: 'Invalid API key' }))
      .toContain('✗');
  });

  it('モデル未指定なら括弧を出さない', () => {
    const { model: _model, ...noModel } = base;
    expect(formatProviderHeadline(noModel as AiTestProviderView))
      .toBe('✓ Google Gemini: Connected to Gemini API. (320ms)');
  });
});

describe('formatProviderDetailLines', () => {
  it('送信内容と受信内容を明示的に出す', () => {
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

  it('トークン数やHTTPステータスをメタ行にまとめる', () => {
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

  it('エラーがあれば表示する', () => {
    const lines = formatProviderDetailLines({
      provider: 'gemini',
      success: false,
      message: 'failed',
      elapsedMs: 50,
      debug: { error: 'Invalid API key' },
    });

    expect(lines.some(l => l.includes('エラー') && l.includes('Invalid API key'))).toBe(true);
  });

  it('debugが無ければ空配列を返す', () => {
    expect(formatProviderDetailLines({
      provider: 'gemini', success: true, message: 'ok', elapsedMs: 10,
    })).toEqual([]);
  });
});
