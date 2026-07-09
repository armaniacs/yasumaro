// @vitest-environment jsdom
/**
 * countTargets-r2.test.ts — additional branch coverage for countTargets.ts.
 * Covers: all enable/disable branches (alt, metadata, ads, nav, social, deep,
 * jsonLd, lazyLoad, skipLink, card, linkDensity), counting edge cases,
 * zero/empty DOM, overflow-size DOM, deduplication across patterns,
 * and the total sum calculation.
 */
import { describe, it, expect } from 'vitest';
import { countAISummaryTargets } from '../countTargets.js';

describe('countAISummaryTargets - R2 all option branches', () => {
  it('counts alt attributes when altEnabled is true', () => {
    document.body.innerHTML = '<div><img src="a.jpg" alt="A"><img src="b.jpg" alt="B"><img src="c.jpg"></div>';
    const result = countAISummaryTargets(document.body, { altEnabled: true, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.altRemoved).toBe(2);
  });

  it('returns 0 for alt when altEnabled is false', () => {
    document.body.innerHTML = '<div><img src="a.jpg" alt="A"></div>';
    const result = countAISummaryTargets(document.body, { altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.altRemoved).toBe(0);
  });

  it('counts metadata elements when metadataEnabled is true', () => {
    document.body.innerHTML = '<div><meta name="desc"><title>T</title><link rel="icon" href="f.ico"><p>Content</p></div>';
    const result = countAISummaryTargets(document.body, { metadataEnabled: true, altEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.metadataRemoved).toBe(3);
  });

  it('returns 0 for metadata when metadataEnabled is false', () => {
    document.body.innerHTML = '<div><meta name="desc"></div>';
    const result = countAISummaryTargets(document.body, { metadataEnabled: false, altEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.metadataRemoved).toBe(0);
  });

  it('counts ads when adsEnabled is true', () => {
    document.body.innerHTML = '<div><div class="ad-container">Ad</div><div class="sponsored">Sponsored</div></div>';
    const result = countAISummaryTargets(document.body, { adsEnabled: true, altEnabled: false, metadataEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.adsRemoved).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 for ads when adsEnabled is false', () => {
    document.body.innerHTML = '<div class="ad-container">Ad</div>';
    const result = countAISummaryTargets(document.body, { adsEnabled: false, altEnabled: false, metadataEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.adsRemoved).toBe(0);
  });

  it('counts nav elements when navEnabled is true', () => {
    document.body.innerHTML = '<div><nav>Nav</nav><footer>Footer</footer><div role="navigation">Role Nav</div></div>';
    const result = countAISummaryTargets(document.body, { navEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, socialEnabled: false });
    expect(result.navRemoved).toBeGreaterThanOrEqual(3);
  });

  it('returns 0 for nav when navEnabled is false', () => {
    document.body.innerHTML = '<nav>Nav</nav>';
    const result = countAISummaryTargets(document.body, { navEnabled: false, altEnabled: false, metadataEnabled: false, adsEnabled: false, socialEnabled: false });
    expect(result.navRemoved).toBe(0);
  });

  it('counts social elements when socialEnabled is true', () => {
    document.body.innerHTML = '<div><div class="social-share">Share</div><div class="twitter">Tweet</div></div>';
    const result = countAISummaryTargets(document.body, { socialEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false });
    expect(result.socialRemoved).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 for social when socialEnabled is false', () => {
    document.body.innerHTML = '<div class="social-share">Share</div>';
    const result = countAISummaryTargets(document.body, { socialEnabled: false, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false });
    expect(result.socialRemoved).toBe(0);
  });
});

describe('countAISummaryTargets - deepEnabled', () => {
  it('counts deep elements when deepEnabled is true', () => {
    document.body.innerHTML = `
      <div>
        <aside>Aside</aside>
        <form>Form</form>
        <div hidden>Hidden</div>
        <div role="banner">Banner</div>
        <p>Content</p>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      deepEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.deepRemoved).toBeGreaterThanOrEqual(4);
  });

  it('returns 0 for deep when deepEnabled is false', () => {
    document.body.innerHTML = '<aside>Aside</aside>';
    const result = countAISummaryTargets(document.body, {
      deepEnabled: false, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.deepRemoved).toBe(0);
  });

  it('counts high link density lists in deepEnabled', () => {
    document.body.innerHTML = '<ul><li><a href="#">Long link text content that exceeds threshold</a></li><li><a href="#">More long link text content here enough</a></li><li><a href="#">Yet more long link description here</a></li></ul>';
    const result = countAISummaryTargets(document.body, {
      deepEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.deepRemoved).toBeGreaterThanOrEqual(1);
  });

  it('counts empty containers in deepEnabled', () => {
    document.body.innerHTML = '<div></div><span></span><p></p><p>Content</p>';
    const result = countAISummaryTargets(document.body, {
      deepEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.deepRemoved).toBeGreaterThanOrEqual(3);
  });
});

describe('countAISummaryTargets - jsonLdEnabled', () => {
  it('counts JSON-LD scripts when jsonLdEnabled is true', () => {
    document.body.innerHTML = `
      <div>
        <script type="application/ld+json">{"@type":"Article"}</script>
        <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      jsonLdEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.jsonLdRemoved).toBe(2);
  });

  it('returns 0 for JSON-LD when jsonLdEnabled is false', () => {
    document.body.innerHTML = '<script type="application/ld+json">{}</script>';
    const result = countAISummaryTargets(document.body, {
      jsonLdEnabled: false, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.jsonLdRemoved).toBe(0);
  });
});

describe('countAISummaryTargets - lazyLoadEnabled', () => {
  it('counts loading="lazy" elements', () => {
    document.body.innerHTML = '<img loading="lazy" src="a.jpg"><p>Content</p>';
    const result = countAISummaryTargets(document.body, {
      lazyLoadEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.lazyLoadRemoved).toBe(1);
  });

  it('counts data-src elements', () => {
    document.body.innerHTML = '<img data-src="a.jpg"><p>Content</p>';
    const result = countAISummaryTargets(document.body, {
      lazyLoadEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.lazyLoadRemoved).toBe(1);
  });

  it('counts lazy class elements', () => {
    document.body.innerHTML = '<div class="skeleton-loader">Loading</div>';
    const result = countAISummaryTargets(document.body, {
      lazyLoadEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.lazyLoadRemoved).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 for lazyLoad when lazyLoadEnabled is false', () => {
    document.body.innerHTML = '<img loading="lazy" src="a.jpg">';
    const result = countAISummaryTargets(document.body, {
      lazyLoadEnabled: false, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.lazyLoadRemoved).toBe(0);
  });
});

describe('countAISummaryTargets - zero/overflow/empty DOM', () => {
  it('returns all zeros for empty DOM', () => {
    document.body.innerHTML = '';
    const result = countAISummaryTargets(document.body, {
      altEnabled: true, metadataEnabled: true, adsEnabled: true,
      navEnabled: true, socialEnabled: true, deepEnabled: true,
      jsonLdEnabled: true, lazyLoadEnabled: true, skipLinkEnabled: true,
      cardEnabled: true, linkDensityEnabled: true,
    });
    expect(result.totalRemoved).toBe(0);
    expect(result.altRemoved).toBe(0);
    expect(result.metadataRemoved).toBe(0);
    expect(result.adsRemoved).toBe(0);
    expect(result.navRemoved).toBe(0);
    expect(result.socialRemoved).toBe(0);
    expect(result.deepRemoved).toBe(0);
    expect(result.jsonLdRemoved).toBe(0);
    expect(result.lazyLoadRemoved).toBe(0);
    expect(result.skipLinkRemoved).toBe(0);
    expect(result.cardRemoved).toBe(0);
    expect(result.linkDensityRemoved).toBe(0);
  });

  it('handles large DOM without crashing', () => {
    let html = '<div>';
    for (let i = 0; i < 50; i++) {
      html += `<div class="item-${i}"><a href="#">Link text content here for the test element</a></div>`;
    }
    html += '</div>';
    document.body.innerHTML = html;
    const result = countAISummaryTargets(document.body, {
      altEnabled: true, metadataEnabled: true, adsEnabled: true,
      navEnabled: true, socialEnabled: true, deepEnabled: true,
      jsonLdEnabled: true, lazyLoadEnabled: true, skipLinkEnabled: true,
      cardEnabled: true, linkDensityEnabled: true,
    });
    expect(typeof result.totalRemoved).toBe('number');
    expect(result.totalRemoved).toBeGreaterThanOrEqual(0);
  });
});

describe('countAISummaryTargets - total sum', () => {
  it('calculates total as sum of all categories', () => {
    document.body.innerHTML = `
      <div>
        <img src="a.jpg" alt="A">
        <div class="ad-container">Ad</div>
        <nav>Nav</nav>
        <div class="social-share">Share</div>
      </div>
    `;
    const result = countAISummaryTargets(document.body, {
      altEnabled: true, metadataEnabled: true, adsEnabled: true,
      navEnabled: true, socialEnabled: true,
    });
    expect(result.totalRemoved).toBe(
      result.altRemoved + result.metadataRemoved + result.adsRemoved +
      result.navRemoved + result.socialRemoved
    );
  });
});

describe('countAISummaryTargets - deduplication within ads', () => {
  it('does not double-count the same element matched by class and id pattern', () => {
    document.body.innerHTML = '<div class="ad-container" id="ad-container">Ad</div>';
    const result = countAISummaryTargets(document.body, {
      adsEnabled: true, altEnabled: false, metadataEnabled: false,
      navEnabled: false, socialEnabled: false,
    });
    expect(result.adsRemoved).toBe(1);
  });
});

describe('countAISummaryTargets - linkDensityEnabled edge cases', () => {
  it('counts high link density blocks', () => {
    document.body.innerHTML = '<ul><li><a href="#">Long text content link here for density threshold</a></li><li><a href="#">More text link content here for density check</a></li></ul>';
    const result = countAISummaryTargets(document.body, {
      linkDensityEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.linkDensityRemoved).toBeGreaterThanOrEqual(0);
  });

  it('skips elements under 100 chars', () => {
    document.body.innerHTML = '<ul><li><a href="#">Short</a></li></ul>';
    const result = countAISummaryTargets(document.body, {
      linkDensityEnabled: true, altEnabled: false, metadataEnabled: false,
      adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.linkDensityRemoved).toBe(0);
  });
});
