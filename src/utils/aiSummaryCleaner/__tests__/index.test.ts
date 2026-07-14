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
});
