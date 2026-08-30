// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { calculateReadabilityScore } from '../readabilityScore.js';
import { markBodyElements } from '../bodyProtection.js';

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

// ---------------------------------------------------------------------------
// Spike 2026-08-30: 閾値×重みマトリクス — 短文3パターン (300/600/800字, p=3/h=1)
// ---------------------------------------------------------------------------

/**
 * 短文記事DOMを生成するヘルパー。
 * - コンテナ: <div> (markBodyElements のスキャン対象)
 * - 内容: <h1> + <p>*3 で textContent 合計が totalChars になるよう按分
 * - class/id 補正なし（純粋に text.length + p*weight + h*weight の検証）
 */
function createShortArticleDOM(totalChars: number): Element {
  const container = document.createElement('div');
  // 見出しは7文字 "Heading" 相当で、残りを p 3つで均等配分
  const headingText = 'Heading';
  const remaining = totalChars - headingText.length;
  const perP = Math.floor(remaining / 3);
  const remainder = remaining - perP * 3;
  // 最後の p に端数を乗せる
  const pLengths = [perP, perP, perP + remainder];
  const pTexts = pLengths.map((len) => 'a'.repeat(len));
  container.innerHTML = `<h1>${headingText}</h1><p>${pTexts[0]}</p><p>${pTexts[1]}</p><p>${pTexts[2]}</p>`;
  return container;
}

/**
 * スコアの期待値を純粋に計算（class 補正・リンク補正なし）。
 * readabilityScore.ts の式: min(text.length/10,300) + p*weight + h*50
 * このヘルパーはテストの期待値算出と比較用。
 */
function expectedScore(totalChars: number, pWeight: number, hCount = 1, pCount = 3): number {
  return Math.min(totalChars / 10, 300) + pCount * pWeight + hCount * 50;
}

describe('Spike 2026-08-30: 短文記事DOMの閾値別保護マトリクス', () => {
  const patterns: Array<{ label: string; totalChars: number }> = [
    { label: '300字', totalChars: 300 },
    { label: '600字', totalChars: 600 },
    { label: '800字', totalChars: 800 },
  ];
  const thresholds = [200, 150, 120, 100] as const;

  for (const { label, totalChars } of patterns) {
    describe(`${label} (p=3/h=1)`, () => {
      for (const threshold of thresholds) {
        it(`閾値 ${threshold} で markBodyElements の保護有無を検証 (現行 p*25)`, () => {
          const el = createShortArticleDOM(totalChars);
          // 孤立したコンテナを body に一時配置して markBodyElements を実行
          // markBodyElements は root.querySelectorAll('p, div, section, article') で自身を含まないため、
          // wrapper を root とする
          const wrapper = document.createElement('div');
          wrapper.appendChild(el);
          document.body.appendChild(wrapper);

          const score = calculateReadabilityScore(el);
          // 期待スコアと実スコアが一致することを担保（式の回帰検出）
          const expected = expectedScore(totalChars, 25);
          expect(score).toBe(expected);

          markBodyElements(wrapper, threshold);
          const isProtected = el.getAttribute('data-ow-body-protected') === 'true';
          const shouldProtect = expected >= threshold;
          expect(isProtected).toBe(shouldProtect);

          // クリーンアップ
          wrapper.remove();
          document.body.innerHTML = '';
        });
      }
    });
  }

  describe('p*40 への重み増 + 閾値 120 への緩和の効果（仮説検証）', () => {
    it('RED: 現行 p*25 閾値200 では 600字記事が保護されないことを確認', () => {
      const el = createShortArticleDOM(600);
      const score = calculateReadabilityScore(el);
      // 現行: 60 + 75 + 50 = 185 < 200 → 保護失敗（バグ再現/RED）
      expect(score).toBe(185);
      expect(score).toBeLessThan(200);

      const wrapper = document.createElement('div');
      wrapper.appendChild(el);
      document.body.appendChild(wrapper);
      markBodyElements(wrapper, 200);
      expect(el.getAttribute('data-ow-body-protected')).toBeNull();
      wrapper.remove();
      document.body.innerHTML = '';
    });

    it('GREEN仮説: p*40 + 閾値120 なら 600字記事は保護される（計算上の検証）', () => {
      // 現行コードは p*25 なので、p*40 を仮定したスコアは expectedScore で算出
      const hypotheticalScoreP40 = expectedScore(600, 40);
      expect(hypotheticalScoreP40).toBe(230);
      expect(hypotheticalScoreP40).toBeGreaterThanOrEqual(120);
      expect(hypotheticalScoreP40).toBeGreaterThanOrEqual(200);

      // 現行スコア (p*25) でも閾値120なら保護されることを実測
      const el = createShortArticleDOM(600);
      const actualScore = calculateReadabilityScore(el);
      expect(actualScore).toBe(185);
      const wrapper = document.createElement('div');
      wrapper.appendChild(el);
      document.body.appendChild(wrapper);
      markBodyElements(wrapper, 120);
      expect(el.getAttribute('data-ow-body-protected')).toBe('true');
      wrapper.remove();
      document.body.innerHTML = '';

      // 参考: 現行スコアでも閾値120で保護 → 閾値緩和だけで 600字は救える
      // 一方 300字は 155 なので閾値120で救えるが p*25 閾値200では不可
      const el300 = createShortArticleDOM(300);
      const score300 = calculateReadabilityScore(el300);
      expect(score300).toBe(155);
      expect(score300).toBeLessThan(200);
      expect(score300).toBeGreaterThanOrEqual(120);
    });

    it('300字記事: p*40 閾値200 でも保護され、閾値120なら現行でも保護される', () => {
      const scoreP25 = expectedScore(300, 25);
      const scoreP40 = expectedScore(300, 40);
      expect(scoreP25).toBe(155);
      expect(scoreP40).toBe(200);
      // p*40 なら閾値200でちょうど保護
      expect(scoreP40).toBeGreaterThanOrEqual(200);
      // p*25 でも閾値120なら保護
      expect(scoreP25).toBeGreaterThanOrEqual(120);

      const el = createShortArticleDOM(300);
      const wrapper = document.createElement('div');
      wrapper.appendChild(el);
      document.body.appendChild(wrapper);

      // 閾値200 では現行は保護されない
      markBodyElements(wrapper, 200);
      expect(el.getAttribute('data-ow-body-protected')).toBeNull();

      // クリーンアップして閾値120で再検証
      el.removeAttribute('data-ow-body-protected');
      markBodyElements(wrapper, 120);
      expect(el.getAttribute('data-ow-body-protected')).toBe('true');

      wrapper.remove();
      document.body.innerHTML = '';
    });
  });
});
