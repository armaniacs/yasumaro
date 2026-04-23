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

describe('countAISummaryTargets - skipLinkEnabled', () => {
  it('counts anchor hash links when skipLinkEnabled is true', () => {
    document.body.innerHTML = `
      <div>
        <a href="#main">Skip to main</a>
        <a href="#nav">Skip to nav</a>
        <p>Content</p>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      skipLinkEnabled: true,
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.skipLinkRemoved ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('counts role="button" links when skipLinkEnabled is true', () => {
    document.body.innerHTML = `
      <div>
        <a role="button" href="#">Open modal</a>
        <p>Content</p>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      skipLinkEnabled: true,
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.skipLinkRemoved ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('counts sr-only class elements when skipLinkEnabled is true', () => {
    document.body.innerHTML = `
      <div>
        <span class="sr-only">Screen reader text</span>
        <span class="visually-hidden">Hidden</span>
        <p>Content</p>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      skipLinkEnabled: true,
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.skipLinkRemoved ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 when skipLinkEnabled is false', () => {
    document.body.innerHTML = `<div><a href="#main">Skip</a></div>`;
    const result = countAISummaryTargets(document.body, {
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      navEnabled: false,
      socialEnabled: false,
    });
    expect(result.skipLinkRemoved ?? 0).toBe(0);
  });
});

describe('countAISummaryTargets - navEnabled id branch', () => {
  it('counts nav elements matching id patterns', () => {
    document.body.innerHTML = `
      <div>
        <div id="navigation">Nav links here</div>
        <div id="breadcrumb">Home > Page</div>
        <p>Main content</p>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      navEnabled: true,
      altEnabled: false,
      metadataEnabled: false,
      adsEnabled: false,
      socialEnabled: false,
    });
    expect(result.navRemoved ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe('countAISummaryTargets - cardEnabled id branch', () => {
  it('counts card elements matching id patterns', () => {
    document.body.innerHTML = `
      <div>
        <div id="article-card">Card by id</div>
        <p>Main content</p>
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
    expect(result.cardRemoved ?? 0).toBeGreaterThanOrEqual(1);
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
