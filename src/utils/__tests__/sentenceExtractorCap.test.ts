import { describe, it, expect } from 'vitest';
import { extractSentences } from '../sentenceExtractor.js';
import { MAX_SENTENCES_FOR_TEXTRANK } from '../computeLimits.js';

function buildText(sentenceCount: number, len = 40): string {
  return Array.from(
    { length: sentenceCount },
    (_, i) => `This is sentence number ${i} padded ${'x'.repeat(len)}.`
  ).join(' ');
}

describe('sentenceExtractor TextRank input cap (VULN-051)', () => {
  it('completes quickly for 5000 sentences (capped)', () => {
    const text = buildText(5000);
    const start = performance.now();
    const out = extractSentences(text, { topK: 10, minLength: 20 });
    const elapsed = performance.now() - start;
    expect(out.length).toBe(10);
    expect(elapsed).toBeLessThan(2000);
  });

  it('perf: 4x sentences does NOT give ~16x time', () => {
    const run = (n: number): number => {
      const text = buildText(n);
      const start = performance.now();
      extractSentences(text, { topK: 10, minLength: 20 });
      return performance.now() - start;
    };
    run(500);
    const t1 = Math.max(run(500), 0.5);
    const t4 = run(2000);
    expect(t4).toBeLessThan(t1 * 8);
  });

  it('normal-size input (tens of sentences) unaffected by the cap', () => {
    const text = buildText(30);
    const out = extractSentences(text, { topK: 5, minLength: 20 });
    expect(out.length).toBe(5);
  });

  it('boundary: cap and cap+1 sentences both bounded to the cap', () => {
    const atCap = extractSentences(buildText(MAX_SENTENCES_FOR_TEXTRANK), { topK: 10, minLength: 20 });
    const overCap = extractSentences(buildText(MAX_SENTENCES_FOR_TEXTRANK + 1), { topK: 10, minLength: 20 });
    expect(atCap.length).toBe(10);
    expect(overCap.length).toBe(10);
  });

  it('prefers minLength-passing sentences when capping', () => {
    // Many short (below minLength) sentences followed by long ones.
    const shorts = Array.from({ length: 400 }, () => 'hi.').join(' ');
    const longs = Array.from(
      { length: 20 },
      (_, i) => `Meaningful long sentence ${i} with enough characters here.`
    ).join(' ');
    const out = extractSentences(shorts + ' ' + longs, { topK: 5, minLength: 20 });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(s.length).toBeGreaterThanOrEqual(20);
    }
  });
});
