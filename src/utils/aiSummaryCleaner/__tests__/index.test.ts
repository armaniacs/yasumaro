/**
 * @vitest-environment jsdom
 */

/**
 * index.test.ts
 * Integration tests for aiSummaryCleaner/index.ts (cleanseAISummaryContent)
 */

import { cleanseAISummaryContent } from '../index.js';

describe('cleanseAISummaryContent — Category B integration', () => {
  it('applies newsMediaEnabled when true', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="byline-source">配信：共同通信</div><p>Article body content here for scoring.</p>';
    const result = cleanseAISummaryContent(root, { newsMediaEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false, recommendEnabled: false, popupEnabled: false });
    expect(result.newsMediaRemoved).toBe(1);
  });

  it('does not apply newsMediaEnabled when false (default)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="byline-source">配信：共同通信</div><p>Article body content here for scoring.</p>';
    const result = cleanseAISummaryContent(root, { altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false, recommendEnabled: false, popupEnabled: false });
    expect(result.newsMediaRemoved).toBe(0);
  });

  it('skips body protection when disabled', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Article content with enough length to test body protection threshold.</p><div class="ad-container">Ad content</div>';
    const result = cleanseAISummaryContent(root, { bodyProtectionEnabled: false, altEnabled: false, metadataEnabled: false, adsEnabled: true, navEnabled: false, socialEnabled: false, recommendEnabled: false, popupEnabled: false });
    expect(result).toBeDefined();
    expect(typeof result.adsRemoved).toBe('number');
  });

  it('handles element with empty outerHTML (bytesBefore 0)', () => {
    const root = document.createElement('div');
    // Create an element whose outerHTML is falsy by mocking
    Object.defineProperty(root, 'outerHTML', { value: '', writable: true, configurable: true });
    root.innerHTML = '<p>test</p>';
    const result = cleanseAISummaryContent(root, { altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false, recommendEnabled: false, popupEnabled: false, bodyProtectionEnabled: false });
    expect(result.bytesBefore).toBe(0);
    expect(result.totalRemoved).toBe(0);
  });

  it('covers default options (no options provided)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Content</p>';
    const result = cleanseAISummaryContent(root);
    expect(result).toBeDefined();
    expect(typeof result.totalRemoved).toBe('number');
  });

  it('covers countAISummaryTargets default options', async () => {
    const { countAISummaryTargets } = await import('../index.js');
    const root = document.createElement('div');
    root.innerHTML = '<p>Content for counting</p><div class="ad">Ad</div>';
    const result = countAISummaryTargets(root);
    expect(result).toBeDefined();
  });
});
