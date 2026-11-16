import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { preparePageContent } from '../pageContentPipeline.js';
import { extractMainContentWithInfo } from '../contentExtractor/index.js';
import { buildExtractionOptions } from '../contentExtractor/optionBuilder.js';
import { createDefaultCleansingConfig, type CleansingConfig } from '../cleansingConfig.js';

const HEALTHY_HTML = `
  <article>
    <h1>Single Seam Contract</h1>
    <p>${'Contract paragraph with enough text to survive the fallback floor. '.repeat(4)}</p>
  </article>
`;

const SMALL_MAX_CHARS = 120;

function installDom(html: string): JSDOM {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
  dom.window.document.body.innerHTML = html;
  // @ts-ignore — jsdom globals for contentExtractor
  global.document = dom.window.document;
  // @ts-ignore
  global.window = dom.window as unknown as Window & typeof globalThis;
  // @ts-ignore
  global.chrome = undefined;
  return dom;
}

describe('pageContentPipeline single seam', () => {
  describe('preparePageContent DOM contract', () => {
    let dom: JSDOM;

    beforeEach(() => {
      dom = installDom('');
    });

    it('returns the article text on a healthy document', async () => {
      dom.window.document.body.innerHTML = HEALTHY_HTML;
      const result = await preparePageContent(createDefaultCleansingConfig());
      expect(result.content).toContain('Single Seam Contract');
    });

    it('returns an empty string without throwing when the body element is missing', async () => {
      dom.window.document.body.innerHTML = HEALTHY_HTML;
      dom.window.document.body.remove();
      expect(document.body).toBeNull();
      // PBI 1116b: the seam is async now — "without throwing" means the
      // promise resolves instead of rejecting; a rejection fails the test.
      const result: Awaited<ReturnType<typeof preparePageContent>> | undefined =
        await preparePageContent(createDefaultCleansingConfig());
      expect(typeof result?.content).toBe('string');
      expect(result?.content).toBe('');
    });

    it('returns a string without throwing on an empty body', async () => {
      dom.window.document.body.innerHTML = '';
      const result: Awaited<ReturnType<typeof preparePageContent>> | undefined =
        await preparePageContent(createDefaultCleansingConfig());
      expect(typeof result?.content).toBe('string');
    });

    it('honours maxChars truncation through the single seam', async () => {
      dom.window.document.body.innerHTML = HEALTHY_HTML;
      const result = await preparePageContent(createDefaultCleansingConfig(), SMALL_MAX_CHARS);
      expect(result.content.length).toBeLessThanOrEqual(SMALL_MAX_CHARS);
      expect(result.content.length).toBeGreaterThan(0);
    });
  });

  describe('preparePageContent legacy parity', () => {
    const cases: Array<{ name: string; config: (c: CleansingConfig) => CleansingConfig; maxChars?: number }> = [
      {
        name: 'dedup enabled',
        config: (c) => ({ ...c, contentDedupEnabled: true }),
      },
      {
        name: 'all cleansing disabled',
        config: (c) => ({
          ...c,
          contentStripHardEnabled: false,
          contentStripKeywordEnabled: false,
          aiSummaryCleansingEnabled: false,
        }),
      },
      {
        name: 'truncated output',
        config: (c) => c,
        maxChars: SMALL_MAX_CHARS,
      },
    ];

    for (const testCase of cases) {
      it(`matches the legacy two-step call — ${testCase.name}`, async () => {
        const viaSeamConfig = testCase.config(createDefaultCleansingConfig());
        const viaLegacyConfig = testCase.config(createDefaultCleansingConfig());

        const dom = installDom(HEALTHY_HTML);
        const viaSeam = await preparePageContent(viaSeamConfig, testCase.maxChars ?? 10000);

        dom.window.document.body.innerHTML = HEALTHY_HTML;
        const { cleanseOptions, aiSummaryCleanseOptions, dedupOptions } =
          buildExtractionOptions(viaLegacyConfig);
        const viaLegacy = await extractMainContentWithInfo(
          testCase.maxChars ?? 10000,
          cleanseOptions,
          aiSummaryCleanseOptions,
          dedupOptions,
        );

        expect(viaSeam).toEqual(viaLegacy);
      });
    }
  });
});
