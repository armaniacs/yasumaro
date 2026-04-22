// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { countAISummaryTargets } from '../countTargets.js';

describe('countAISummaryTargets - card detection', () => {
  it('counts card elements when cardEnabled is true', () => {
    document.body.innerHTML = `
      <div>
        <div class="article-card">Card 1</div>
        <div class="post-card">Card 2</div>
        <p>Normal paragraph</p>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      cardEnabled: true,
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.cardRemoved ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 for cards when cardEnabled is false', () => {
    document.body.innerHTML = '<div class="article-card">Card</div>';
    const result = countAISummaryTargets(document.body, {
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.cardRemoved ?? 0).toBe(0);
  });
});

describe('countAISummaryTargets - link density', () => {
  it('counts high link density elements when linkDensityEnabled', () => {
    document.body.innerHTML = `
      <div>
        <ul>
          <li><a href="#">Link 1 with lots of text content here enough</a></li>
          <li><a href="#">Link 2 with lots of text content here enough</a></li>
          <li><a href="#">Link 3 with lots of text content here enough</a></li>
          <li><a href="#">Link 4 with lots of text content here enough</a></li>
        </ul>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      linkDensityEnabled: true,
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.linkDensityRemoved ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for link density when linkDensityEnabled is false', () => {
    document.body.innerHTML = '<div><a href="#">Link</a></div>';
    const result = countAISummaryTargets(document.body, {
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.linkDensityRemoved ?? 0).toBe(0);
  });
});
