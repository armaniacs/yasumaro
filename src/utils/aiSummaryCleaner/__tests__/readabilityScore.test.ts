// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { calculateReadabilityScore } from '../readabilityScore.js';

describe('calculateReadabilityScore', () => {
  it('returns 0 for empty element', () => {
    const el = document.createElement('div');
    const score = calculateReadabilityScore(el);
    expect(score).toBe(0);
  });

  it('scores based on text length', () => {
    const el = document.createElement('div');
    el.textContent = 'a'.repeat(100);
    const score = calculateReadabilityScore(el);
    expect(score).toBeGreaterThanOrEqual(10); // 100 / 10 = 10
  });

  it('caps text length score at 300', () => {
    const el = document.createElement('div');
    el.textContent = 'a'.repeat(10000);
    const score = calculateReadabilityScore(el);
    // Text score capped at 300, no other scoring factors
    expect(score).toBe(300);
  });

  it('adds score for <p> tags', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>Paragraph 1</p><p>Paragraph 2</p><p>Paragraph 3</p>';
    const score = calculateReadabilityScore(el);
    // 3 paragraphs * 25 = 75, plus text score
    expect(score).toBeGreaterThanOrEqual(75);
  });

  it('adds score for heading tags', () => {
    const el = document.createElement('div');
    el.innerHTML = '<h1>Title</h1><h2>Subtitle</h2>';
    const score = calculateReadabilityScore(el);
    // 2 headings * 50 = 100, plus text score
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('adds score for positive class patterns', () => {
    const el = document.createElement('div');
    el.className = 'article-content';
    el.textContent = 'Some content text here.';
    const score = calculateReadabilityScore(el);
    expect(score).toBeGreaterThanOrEqual(50);
  });

  it('adds score for positive id patterns', () => {
    const el = document.createElement('div');
    el.id = 'main-content';
    el.textContent = 'Some content text here.';
    const score = calculateReadabilityScore(el);
    expect(score).toBeGreaterThanOrEqual(50);
  });

  it('subtracts score for negative class patterns', () => {
    const el = document.createElement('div');
    el.className = 'sidebar-nav';
    el.textContent = 'Navigation links';
    const score = calculateReadabilityScore(el);
    // Negative pattern subtracts 50
    expect(score).toBeLessThanOrEqual(0);
  });

  it('subtracts score for negative id patterns', () => {
    const el = document.createElement('div');
    el.id = 'footer-comment';
    el.textContent = 'Comment section';
    const score = calculateReadabilityScore(el);
    expect(score).toBeLessThanOrEqual(0);
  });

  it('reduces score for high link density', () => {
    const el = document.createElement('div');
    // Create element with text and high link density
    el.innerHTML = '<p>Some text <a href="#">Link with text content</a> more text</p>';
    const scoreWithLinks = calculateReadabilityScore(el);
    
    // Create same element without links
    const elNoLinks = document.createElement('div');
    elNoLinks.innerHTML = '<p>Some text Link with text content more text</p>';
    const scoreNoLinks = calculateReadabilityScore(elNoLinks);
    
    // High link ratio (>50%) should halve the score
    expect(scoreWithLinks).toBeLessThan(scoreNoLinks);
  });

  it('does not reduce score for low link density', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>This is a long paragraph with <a href="#">one link</a> inside it.</p>';
    const score = calculateReadabilityScore(el);
    // Link ratio should be low, no penalty
    expect(score).toBeGreaterThan(25); // At least the <p> tag score
  });

  it('combines multiple scoring factors', () => {
    const el = document.createElement('article');
    el.className = 'main-content';
    el.innerHTML = `
      <h1>Article Title</h1>
      <p>First paragraph with substantial content to increase text score.</p>
      <p>Second paragraph with more content for better scoring.</p>
      <p>Third paragraph to boost the paragraph count.</p>
    `;
    const score = calculateReadabilityScore(el);
    // Should have high score: text + 3 paragraphs + 1 heading + positive class
    expect(score).toBeGreaterThanOrEqual(200);
  });

  it('handles elements with both positive and negative patterns', () => {
    const el = document.createElement('div');
    el.className = 'article-nav'; // article (+50) + nav (-50) = 0
    el.textContent = 'Content';
    const score = calculateReadabilityScore(el);
    // Should have net 0 from class patterns
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('is case insensitive for class/id matching', () => {
    const el = document.createElement('div');
    el.className = 'ARTICLE-CONTENT';
    el.textContent = 'Test';
    const score = calculateReadabilityScore(el);
    expect(score).toBeGreaterThanOrEqual(50);
  });
});
