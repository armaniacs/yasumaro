/**
 * @vitest-environment jsdom
 */

/**
 * countTargets-r3.test.ts
 * Unit test for countTargets.ts — Category A extended options
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { countAISummaryTargets } from '../countTargets.js';

describe('countAISummaryTargets — jpLayoutEnabled (Category A)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('counts SWELL/Cocoon patterns with jpLayoutEnabled true', () => {
    document.body.innerHTML = '<div class="swell-toc">TOC</div><div class="author-box">Author</div><div class="p-postlist">List</div><p>Content</p>';
    const result = countAISummaryTargets(document.body, { jpLayoutEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.jpLayoutRemoved).toBe(3);
  });

  it('returns 0 with jpLayoutEnabled false', () => {
    document.body.innerHTML = '<div class="swell-toc">TOC</div>';
    const result = countAISummaryTargets(document.body, { jpLayoutEnabled: false, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.jpLayoutRemoved).toBe(0);
  });

  it('counts disclosure and recommend ad patterns', () => {
    document.body.innerHTML = '<div class="pr-disclosure">PR</div><div class="popin_recommend">P</div><div class="taboola-unit">T</div>';
    const result = countAISummaryTargets(document.body, { jpLayoutEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.jpLayoutRemoved).toBe(3);
  });
});

describe('countAISummaryTargets — affiliateEnabled', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('counts Rinker/Kaereba/Pochipp patterns', () => {
    document.body.innerHTML = '<div class="yyi-rinker-contents">R</div><div class="kaerebalink-box">K</div><div class="pochipp-box">P</div>';
    const result = countAISummaryTargets(document.body, { affiliateEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.affiliateRemoved).toBeGreaterThanOrEqual(3);
  });

  it('returns 0 with affiliateEnabled false', () => {
    document.body.innerHTML = '<div class="yyi-rinker-contents">R</div>';
    const result = countAISummaryTargets(document.body, { affiliateEnabled: false, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.affiliateRemoved).toBe(0);
  });
});

describe('countAISummaryTargets — speechBubbleEnabled', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('counts speech balloon containers', () => {
    document.body.innerHTML = '<div class="speech-balloon">A</div><div class="talk-balloon">B</div><div class="chat-bubble">C</div>';
    const result = countAISummaryTargets(document.body, { speechBubbleEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.speechBubbleRemoved).toBe(3);
  });

  it('returns 0 with speechBubbleEnabled false', () => {
    document.body.innerHTML = '<div class="speech-balloon">A</div>';
    const result = countAISummaryTargets(document.body, { speechBubbleEnabled: false, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.speechBubbleRemoved).toBe(0);
  });
});

describe('countAISummaryTargets — combined Category A options', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('counts all three categories simultaneously', () => {
    document.body.innerHTML = '<div class="swell-toc">TOC</div><div class="yyi-rinker-contents">R</div><div class="speech-balloon">S</div><p>Content</p>';
    const result = countAISummaryTargets(document.body, {
      jpLayoutEnabled: true,
      affiliateEnabled: true,
      speechBubbleEnabled: true,
      altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.jpLayoutRemoved).toBe(1);
    expect(result.affiliateRemoved).toBe(1);
    expect(result.speechBubbleRemoved).toBe(1);
    expect(result.totalRemoved).toBe(3);
  });

  it('returns 0 for all categories when no matching elements', () => {
    document.body.innerHTML = '<p>Just content</p>';
    const result = countAISummaryTargets(document.body, {
      jpLayoutEnabled: true,
      affiliateEnabled: true,
      speechBubbleEnabled: true,
      altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false,
    });
    expect(result.jpLayoutRemoved).toBe(0);
    expect(result.affiliateRemoved).toBe(0);
    expect(result.speechBubbleRemoved).toBe(0);
    expect(result.totalRemoved).toBe(0);
  });

  it('deduplicates elements matching multiple patterns', () => {
    document.body.innerHTML = '<div class="swell-toc toc">TOC</div>';
    const result = countAISummaryTargets(document.body, { jpLayoutEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false });
    expect(result.jpLayoutRemoved).toBe(1);
  });
});
