// @vitest-environment jsdom
/**
 * stripCore-r2.test.ts — covers core strip functions not yet tested:
 * stripAltAttributes, stripMetadataElements, stripAdElements,
 * stripNavElements, stripLegalTextNodes, stripHighLinkDensityElements,
 * stripSocialElements, stripDeepElements
 *
 * Also covers edge-case branches for existing-tested functions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  stripAltAttributes,
  stripMetadataElements,
  stripAdElements,
  stripNavElements,
  stripLegalTextNodes,
  stripHighLinkDensityElements,
  stripSocialElements,
  stripDeepElements,
  stripJsonLdScripts,
  stripLazyLoadElements,
  stripSkipLinks,
  stripCardElements,
} from '../stripCore.js';

describe('stripAltAttributes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes alt attributes from all images', () => {
    document.body.innerHTML = '<div><img src="a.jpg" alt="desc"><img src="b.jpg" alt=""></div>';
    const count = stripAltAttributes(document.body);
    expect(count).toBe(2);
    expect(document.querySelector('img')?.hasAttribute('alt')).toBe(false);
  });

  it('returns 0 when no images have alt', () => {
    document.body.innerHTML = '<div><img src="a.jpg"></div>';
    const count = stripAltAttributes(document.body);
    expect(count).toBe(0);
  });
});

describe('stripMetadataElements', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes meta, title, and link elements', () => {
    document.body.innerHTML = `
      <div>
        <meta name="description" content="test">
        <title>Page Title</title>
        <link rel="icon" href="favicon.ico">
        <link rel="stylesheet" href="style.css">
        <link rel="canonical" href="https://example.com">
        <p>Content</p>
      </div>
    `;
    const count = stripMetadataElements(document.body);
    expect(count).toBe(5);
    expect(document.querySelector('meta')).toBeNull();
    expect(document.querySelector('title')).toBeNull();
  });

  it('returns 0 when no metadata elements exist', () => {
    document.body.innerHTML = '<div><p>Content</p></div>';
    const count = stripMetadataElements(document.body);
    expect(count).toBe(0);
  });
});

describe('stripAdElements', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes elements with ad data attributes', () => {
    document.body.innerHTML = '<div data-ad-slot="12345"><p>Ad</p></div><p>Content</p>';
    const count = stripAdElements(document.body);
    expect(count).toBe(1);
  });

  it('removes elements with ad class patterns', () => {
    document.body.innerHTML = '<div class="ad-container"><p>Ad</p></div><p>Content</p>';
    const count = stripAdElements(document.body);
    expect(count).toBe(1);
  });

  it('returns 0 when no ad elements exist', () => {
    document.body.innerHTML = '<p>Clean content</p>';
    const count = stripAdElements(document.body);
    expect(count).toBe(0);
  });
});

describe('stripNavElements', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes nav, footer, role navigation, and role contentinfo', () => {
    document.body.innerHTML = `
      <div>
        <nav>Nav</nav>
        <footer>Footer</footer>
        <div role="navigation">Role Nav</div>
        <div role="contentinfo">Content Info</div>
        <p>Content</p>
      </div>
    `;
    const count = stripNavElements(document.body);
    expect(count).toBe(4);
  });

  it('removes SPA nav elements via data-testid', () => {
    document.body.innerHTML = '<div data-testid="footer-section">Footer</div><p>Content</p>';
    const count = stripNavElements(document.body);
    expect(count).toBe(1);
  });

  it('removes nav class patterns via buildClassIdSelectors', () => {
    document.body.innerHTML = '<div class="sidebar">Sidebar</div><p>Content</p>';
    const count = stripNavElements(document.body);
    expect(count).toBe(1);
  });

  it('returns 0 when no nav elements exist', () => {
    document.body.innerHTML = '<p>Content</p>';
    const count = stripNavElements(document.body);
    expect(count).toBe(0);
  });
});

describe('stripLegalTextNodes', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes elements with copyright pattern', () => {
    document.body.innerHTML = '<div><p>© 2024 Example Corp</p><p>Main content here.</p></div>';
    const count = stripLegalTextNodes(document.body);
    expect(count).toBe(1);
  });

  it('skips elements longer than 500 chars', () => {
    document.body.innerHTML = `<p>${'A'.repeat(501)}</p>`;
    const count = stripLegalTextNodes(document.body);
    expect(count).toBe(0);
  });

  it('skips elements with multiple content children', () => {
    document.body.innerHTML = '<div><p>Para 1</p><section>Section</section><p>© 2024</p></div>';
    const count = stripLegalTextNodes(document.body);
    // The div (2+ content children) is skipped.
    // But the inner <p>© 2024</p> is still matched and removed.
    expect(count).toBe(1);
  });

  it('returns 0 when no legal text found', () => {
    document.body.innerHTML = '<p>Just regular content</p>';
    const count = stripLegalTextNodes(document.body);
    expect(count).toBe(0);
  });
});

describe('stripHighLinkDensityElements', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes high link density blocks', () => {
    document.body.innerHTML = `
      <ul>
        <li><a href="#">Long link text content here that exceeds threshold</a></li>
        <li><a href="#">Another long link text with enough characters</a></li>
        <li><a href="#">Yet another lengthy link description right here</a></li>
      </ul>
    `;
    const count = stripHighLinkDensityElements(document.body);

    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('skips elements under 100 chars', () => {
    document.body.innerHTML = '<ul><li><a href="#">Short</a></li></ul>';
    const count = stripHighLinkDensityElements(document.body);
    expect(count).toBe(0);
  });

  it('skips elements whose parent is p/article/section', () => {
    document.body.innerHTML = '<article><ul><li><a href="#">Long link text content here that exceeds threshold</a></li><li><a href="#">Another long link text with enough characters</a></li></ul></article>';
    const count = stripHighLinkDensityElements(document.body);
    expect(count).toBe(0);
  });

  it('returns 0 when no high density blocks', () => {
    document.body.innerHTML = '<p>Normal text with no links here.</p>';
    const count = stripHighLinkDensityElements(document.body);
    expect(count).toBe(0);
  });
});

describe('stripSocialElements', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes comment sections', () => {
    document.body.innerHTML = '<div id="comments">Comments</div><p>Content</p>';
    const count = stripSocialElements(document.body);
    expect(count).toBe(1);
  });

  it('removes social class patterns', () => {
    document.body.innerHTML = '<div class="social-share">Share</div><p>Content</p>';
    const count = stripSocialElements(document.body);
    expect(count).toBe(1);
  });

  it('returns 0 when no social elements exist', () => {
    document.body.innerHTML = '<p>Content</p>';
    const count = stripSocialElements(document.body);
    expect(count).toBe(0);
  });
});

describe('stripDeepElements', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes direct deep tags (aside, form, iframe, script, style, etc.)', () => {
    document.body.innerHTML = `
      <div>
        <aside>Aside</aside>
        <form>Form</form>
        <iframe src="x.html"></iframe>
        <script>alert(1)</script>
        <style>.c{}</style>
        <noscript>No</noscript>
        <button>Btn</button>
        <p>Content</p>
      </div>
    `;
    const count = stripDeepElements(document.body);
    expect(count).toBeGreaterThanOrEqual(7);
  });

  it('removes elements with deep roles', () => {
    document.body.innerHTML = '<div role="banner">Banner</div><p>Content</p>';
    const count = stripDeepElements(document.body);
    expect(count).toBe(1);
  });

  it('removes deep class pattern elements', () => {
    document.body.innerHTML = '<div class="cookie-banner">Cookie</div><p>Content</p>';
    const count = stripDeepElements(document.body);
    expect(count).toBe(1);
  });

  it('removes high density lists', () => {
    document.body.innerHTML = '<ul><li><a href="#">Long link text here enough for density check</a></li><li><a href="#">Another long link description right here</a></li></ul>';
    const count = stripDeepElements(document.body);
    expect(count).toBe(1);
  });

  it('removes hidden elements', () => {
    document.body.innerHTML = '<div hidden>Hidden</div><p>Content</p>';
    const count = stripDeepElements(document.body);
    expect(count).toBe(1);
  });

  it('removes empty containers (div, span, p with no text)', () => {
    document.body.innerHTML = '<div></div><span></span><p></p><p>Content</p>';
    const count = stripDeepElements(document.body);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('returns 0 when no deep targets exist', () => {
    document.body.innerHTML = '<article><p>Clean content paragraph with enough text here.</p></article>';
    const count = stripDeepElements(document.body);
    expect(count).toBe(0);
  });
});

describe('stripJsonLdScripts — edge cases', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('handles multiple JSON-LD scripts', () => {
    document.body.innerHTML = `
      <div>
        <script type="application/ld+json">{"@type":"Article"}</script>
        <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
        <script type="application/ld+json">{"@type":"Product"}</script>
        <p>Content</p>
      </div>
    `;
    const count = stripJsonLdScripts(document.body);
    expect(count).toBe(3);
  });
});

describe('stripLazyLoadElements — all branches', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('counts loading="lazy" elements', () => {
    document.body.innerHTML = '<img loading="lazy" src="a.jpg"><p>Content</p>';
    const count = stripLazyLoadElements(document.body);
    expect(count).toBe(1);
  });

  it('counts data-src elements', () => {
    document.body.innerHTML = '<img data-src="a.jpg"><p>Content</p>';
    const count = stripLazyLoadElements(document.body);
    expect(count).toBe(1);
  });

  it('counts lazy class elements', () => {
    document.body.innerHTML = '<div class="skeleton-loader">Loading</div><p>Content</p>';
    const count = stripLazyLoadElements(document.body);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates across selectors', () => {
    document.body.innerHTML = '<img loading="lazy" class="lazy" data-src="a.jpg"><p>Content</p>';
    const count = stripLazyLoadElements(document.body);
    expect(count).toBe(1);
  });
});

describe('stripSkipLinks — all branches', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes javascript: links', () => {
    document.body.innerHTML = '<a href="javascript:void(0)">Click</a><p>Content</p>';
    const count = stripSkipLinks(document.body);
    expect(count).toBe(1);
  });

  it('removes role="button" links', () => {
    document.body.innerHTML = '<a role="button" href="#">Button</a><p>Content</p>';
    const count = stripSkipLinks(document.body);
    expect(count).toBe(1);
  });

  it('removes screen-reader class elements', () => {
    document.body.innerHTML = '<span class="screen-reader">SR only</span><p>Content</p>';
    const count = stripSkipLinks(document.body);
    expect(count).toBe(1);
  });

  it('deduplicates across selectors', () => {
    document.body.innerHTML = '<a href="#main" role="button">Skip</a><p>Content</p>';
    const count = stripSkipLinks(document.body);
    expect(count).toBe(1);
  });
});

describe('stripCardElements — edge cases', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes kiji pattern elements', () => {
    document.body.innerHTML = '<div class="kiji-list">Article list</div><p>Content</p>';
    const count = stripCardElements(document.body);
    expect(count).toBe(1);
  });

  it('deduplicates matched by both class and id', () => {
    document.body.innerHTML = '<div id="article-card" class="post-card">Card</div><p>Content</p>';
    const count = stripCardElements(document.body);
    expect(count).toBe(1);
  });
});
