// @vitest-environment jsdom
/**
 * dualPayload.test.ts — 30-11 二重ペイロード
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { extractMainContent, extractMainContentWithInfo } from '../index.js';
import type { ExtractResult } from '../types.js';

describe('dualPayload (30-11)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('attaches originalContent and dualPayloadEnabled when cleansing', () => {
    document.body.innerHTML = `<article><p>${'本文 '.repeat(50)}</p><div class="ad-banner">広告</div></article>`;
    const result = extractMainContentWithInfo(
      10000,
      { cleanseEnabled: false },
      { aiSummaryCleanseEnabled: true },
    ) as ExtractResult;
    expect(result.originalContent).toBeDefined();
    expect(typeof result.originalContent).toBe('string');
    expect((result.originalContent as string).length).toBeGreaterThan(0);
    expect(result.dualPayloadEnabled).toBe(true);
  });

  it('originalContent is longer than or equal to cleansed content', () => {
    document.body.innerHTML = `<article><p>${'本文 '.repeat(100)}</p><nav>ナビ</nav><div class="social-share">share</div></article>`;
    const result = extractMainContentWithInfo(
      10000,
      { cleanseEnabled: false },
      { aiSummaryCleanseEnabled: true },
    ) as ExtractResult;
    expect(result.originalContent!.length).toBeGreaterThanOrEqual(result.content.length);
  });

  it('generates a funnel even when dualPayload is disabled', () => {
    document.body.innerHTML = `<article><p>${'a'.repeat(500)}</p></article>`;
    const result = extractMainContentWithInfo(
      10000,
      { cleanseEnabled: false },
      { aiSummaryCleanseEnabled: false },
    ) as ExtractResult;
    // originalContent は body からフォールバックで入る
    expect(result.originalContent).toBeDefined();
    expect(result.funnel).toBeDefined();
  });

  it('retrieves originalContent even for a short page', () => {
    document.body.innerHTML = `<article><p>短い本文テストコンテンツです。十分な長さを確保します。${'x'.repeat(200)}</p></article>`;
    const result = extractMainContentWithInfo(10000, { cleanseEnabled: false }, { aiSummaryCleanseEnabled: true }) as ExtractResult;
    expect(result.originalContent).toBeTruthy();
  });

  it('makeDualPayloadDiff returns an element with a warning when removal exceeds 80%', async () => {
    const { makeDualPayloadDiff } = await import('../../../dashboard/cleansingStatsView.js');
    const entry = {
      content: '短い',
      originalContent: 'a'.repeat(1000),
      dualPayloadEnabled: true,
    };
    const el = makeDualPayloadDiff(entry as unknown as Parameters<typeof makeDualPayloadDiff>[0]);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('除去');
    // 80%超なので警告が含まれる
    expect(el!.querySelector('.dual-payload-warning')).not.toBeNull();
  });

  it('makeDualPayloadDiff returns null without originalContent', async () => {
    const { makeDualPayloadDiff } = await import('../../../dashboard/cleansingStatsView.js');
    const entry = { content: 'abc' } as unknown as Parameters<typeof makeDualPayloadDiff>[0];
    expect(makeDualPayloadDiff(entry)).toBeNull();
  });

  it('renders no warning when the diff is small', async () => {
    const { makeDualPayloadDiff } = await import('../../../dashboard/cleansingStatsView.js');
    const entry = {
      content: 'a'.repeat(90),
      originalContent: 'a'.repeat(100),
    };
    const el = makeDualPayloadDiff(entry as unknown as Parameters<typeof makeDualPayloadDiff>[0]);
    expect(el).not.toBeNull();
    expect(el!.querySelector('.dual-payload-warning')).toBeNull();
  });
});
