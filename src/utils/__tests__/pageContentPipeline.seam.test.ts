import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { preparePageContent } from '../pageContentPipeline.js';
import { extractMainContentWithInfo } from '../contentExtractor/index.js';
import { buildExtractionOptions } from '../contentExtractor/optionBuilder.js';
import { createDefaultCleansingConfig, type CleansingConfig } from '../cleansingConfig.js';

// Reproduction of the keyword-overstrip fixture: most of the candidate's text
// lives in a keyword-matching element (class/id contains 'login'), so Content
// Cleansing guts it and post/pre falls below the fallback ratio while the
// pre-cleanse text clears the 100-char floor.
const KEYWORD_OVERSTRIP_HTML = `
  <main>
    <article id="answer">
      <p>Oliveランク切替の手順について、短い導入をここに記載します。</p>
      <div class="login-history" id="login-history">
        <p>
          login履歴とランク判定の関係について説明します。過去12か月間のlogin回数、
          取引残高、および入出金の頻度がランク算出に反映されます。特にオンラインバンク
          からのloginは通常取引と同等に加点され、年間を通じて安定した利用実績がある場合、
          上位ランクへの切替対象となります。逆に、長期間loginがない場合はランク再判定の
          対象になることがありますのでご注意ください。
        </p>
        <p>
          login時に利用する認証情報の変更手続きもランク判定に影響しませんが、
          定期的なパスワード更新はご利用状況の継続とみなされます。
        </p>
      </div>
      <p>ご不明な点は当行までお問い合わせください。</p>
    </article>
  </main>
`;

// Nav-heavy candidate: the AI nav rule (default-enabled) removes the nav, so
// the extracted content drops below the absolute byte floor while the pre-AI
// text stays large — over-cleansed without the Content Cleansing pair.
const NAV_HEAVY_HTML = `
  <article>
    <p>Main content paragraph with sufficient text for the extractor here.</p>
    <nav>${'Navigation filler text. '.repeat(30)}</nav>
  </article>
`;

const HEALTHY_HTML = `
  <article>
    <p>${'Sufficient content for this article. '.repeat(10)}</p>
    <p>${'More paragraphs with additional text. '.repeat(10)}</p>
  </article>
`;

describe('preparePageContent — fallback priority through the single seam', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    // @ts-ignore — jsdom globals for contentExtractor
    global.document = dom.window.document;
    // @ts-ignore
    global.window = dom.window as unknown as Window & typeof globalThis;
    // @ts-ignore
    global.chrome = undefined;
  });

  it('content_overcut fires and restores the pre-cleanse text (② alone)', () => {
    dom.window.document.body.innerHTML = KEYWORD_OVERSTRIP_HTML;
    const cfg = createDefaultCleansingConfig();
    cfg.aiSummaryCleansingEnabled = false;
    const result = preparePageContent(cfg);
    expect(result.fallbackTriggered).toBe(true);
    expect(result.fallbackReason).toBe('content_overcut');
    expect(result.content).toContain('login履歴とランク判定');
  });

  it('② content_overcut wins over ③ over_cleansed when both arms are armed', () => {
    dom.window.document.body.innerHTML = KEYWORD_OVERSTRIP_HTML;
    const cfg = createDefaultCleansingConfig();
    const result = preparePageContent(cfg);
    expect(result.fallbackTriggered).toBe(true);
    expect(result.fallbackReason).toBe('content_overcut');
    expect(result.content).toContain('login履歴とランク判定');
    // The ② winner invalidates the ③ pair — AI diagnostics are discarded.
    expect(result.aiSummaryOriginalBytes).toBeUndefined();
  });

  it('over_cleansed wins when only the AI path is armed (③ without ②)', () => {
    dom.window.document.body.innerHTML = NAV_HEAVY_HTML;
    const cfg = createDefaultCleansingConfig();
    cfg.contentStripHardEnabled = false;
    cfg.contentStripKeywordEnabled = false;
    const result = preparePageContent(cfg);
    expect(result.fallbackTriggered).toBe(true);
    expect(result.fallbackReason).toBe('over_cleansed');
    // The ③ arm restores the pre-AI text and keeps its diagnostics.
    expect(result.content).toContain('Main content paragraph');
    expect(result.aiSummaryOriginalBytes).toBeGreaterThan(0);
  });

  it('short_content body fallback when no guard arms and the content is tiny', () => {
    dom.window.document.body.innerHTML =
      '<article><p>Hi</p></article><div>Some other body content that will be used as fallback text here.</div>';
    const cfg = createDefaultCleansingConfig();
    cfg.contentStripHardEnabled = false;
    cfg.contentStripKeywordEnabled = false;
    cfg.aiSummaryCleansingEnabled = false;
    cfg.candidateGuardEnabled = false;
    const result = preparePageContent(cfg);
    expect(result.fallbackTriggered).toBe(true);
    expect(result.fallbackReason).toBe('short_content');
  });
});

describe('preparePageContent — legacy adapter parity', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    // @ts-ignore — jsdom globals for contentExtractor
    global.document = dom.window.document;
    // @ts-ignore
    global.window = dom.window as unknown as Window & typeof globalThis;
    // @ts-ignore
    global.chrome = undefined;
  });

  const cases: Array<{ name: string; html: string; config: (c: CleansingConfig) => CleansingConfig; maxChars?: number }> = [
    { name: 'default config on a healthy article', html: HEALTHY_HTML, config: (c) => c },
    { name: 'default config on the overstrip fixture (fallback path)', html: KEYWORD_OVERSTRIP_HTML, config: (c) => c },
    {
      name: 'AI-only config on the nav-heavy fixture (over_cleansed path)',
      html: NAV_HEAVY_HTML,
      config: (c) => ({ ...c, contentStripHardEnabled: false, contentStripKeywordEnabled: false }),
    },
    { name: 'maxChars truncation', html: HEALTHY_HTML, config: (c) => c, maxChars: 200 },
  ];

  for (const testCase of cases) {
    it(`returns the identical ExtractResult as the legacy adapter — ${testCase.name}`, () => {
      const viaSeamConfig = testCase.config(createDefaultCleansingConfig());
      const viaLegacyConfig = testCase.config(createDefaultCleansingConfig());

      dom.window.document.body.innerHTML = testCase.html;
      const viaSeam = preparePageContent(viaSeamConfig, testCase.maxChars ?? 10000);

      dom.window.document.body.innerHTML = testCase.html;
      const { cleanseOptions, aiSummaryCleanseOptions, dedupOptions } = buildExtractionOptions(viaLegacyConfig);
      const viaLegacy = extractMainContentWithInfo(
        testCase.maxChars ?? 10000,
        cleanseOptions,
        aiSummaryCleanseOptions,
        dedupOptions,
      );

      expect(viaSeam).toEqual(viaLegacy);
    });
  }
});
