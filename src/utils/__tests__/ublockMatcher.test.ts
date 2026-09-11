// ublockMatcher.test.ts
// Tests for the uBlock matcher integration (UF-103)

import { isUrlBlocked, type UblockMatcherContext } from '../ublockMatcher.js';
import type { UblockRules } from '../types.js';
import { parseUblockFilterList, type ParsedUblockRuleset } from '../ublockParser/index.js';

/** Helper to create a simple rule set */
function rulesFromText(text: string): UblockRules {
  // parseUblockFilterList はパーサ中間形式（ParsedUblockRuleset）を返す。
  // isUrlBlocked が受け取るのはストレージ形式（UblockRules）のため、
  // ここでは明示的に変換する（as unknown as ブリッジは使わない）。
  // 注: isUrlBlocked 実行時の blockDomains 優先・blockRules フォールバック両対応を
  // 型レベルで union として表現する対応は本 PBI スコープ外（別 PBI）。
  return toStorageRules(parseUblockFilterList(text));
}

/** パーサ中間形式をストレージ形式に変換する（テスト用） */
function toStorageRules(parsed: ParsedUblockRuleset): UblockRules {
  return {
    blockDomains: [],
    exceptionDomains: [],
    blockRules: parsed.blockRules.map((rule) => ({ domain: rule.domain, options: { ...rule.options } })),
    exceptionRules: parsed.exceptionRules.map((rule) => ({ domain: rule.domain, options: { ...rule.options } })),
    metadata: { importedAt: parsed.metadata.importedAt, ruleCount: parsed.metadata.ruleCount },
  };
}

describe('isUrlBlocked', () => {
  test('basic block rule matches URL', async () => {
    const ublockRules = rulesFromText('||ads.google.com^');
    const result = await isUrlBlocked('https://ads.google.com/tracker.js', ublockRules);
    expect(result).toBe(true);
  });

  test('exception rule overrides block', async () => {
    const ublockRules = rulesFromText(`||ads.google.com^\n@@||ads.google.com^$domain=example.com`);
    const result = await isUrlBlocked('https://ads.google.com/asset.js', ublockRules, { currentDomain: 'example.com' });
    expect(result).toBe(false);
  });

  test('domain option restricts block to specific domain', async () => {
    const ublockRules = rulesFromText('||tracker.com^$domain=example.com');
    const blocked = await isUrlBlocked('https://tracker.com/track', ublockRules, { currentDomain: 'example.com' });
    const notBlocked = await isUrlBlocked('https://tracker.com/track', ublockRules, { currentDomain: 'other.com' });
    expect(blocked).toBe(true);
    expect(notBlocked).toBe(false);
  });

  test('~domain option excludes specific domain', async () => {
    const ublockRules = rulesFromText('||ads.google.com^$~domain=example.com');
    const blocked = await isUrlBlocked('https://ads.google.com/asset.js', ublockRules, { currentDomain: 'other.com' });
    const allowed = await isUrlBlocked('https://ads.google.com/asset.js', ublockRules, { currentDomain: 'example.com' });
    expect(blocked).toBe(true);
    expect(allowed).toBe(false);
  });

  test('3p option matches only third-party requests', async () => {
    const ublockRules = rulesFromText('||adnetwork.com^$3p');
    const thirdParty = await isUrlBlocked('https://adnetwork.com/ad.js', ublockRules, { isThirdParty: true });
    const firstParty = await isUrlBlocked('https://adnetwork.com/ad.js', ublockRules, { isThirdParty: false });
    expect(thirdParty).toBe(true);
    expect(firstParty).toBe(false);
  });

  test('wildcard pattern matches subdomains', async () => {
    const ublockRules = rulesFromText('||*.ads.net^');
    const result = await isUrlBlocked('https://sub.ads.net/image.gif', ublockRules);
    expect(result).toBe(true);
  });

  test('no matching rule returns false', async () => {
    const ublockRules = rulesFromText('||ads.google.com^');
    const result = await isUrlBlocked('https://example.com', ublockRules);
    expect(result).toBe(false);
  });

  test('match-case option enables case-sensitive matching', async () => {
    const ublockRules = rulesFromText('||EXAMPLE.COM^$match-case');
    expect(ublockRules.blockRules![0]!.options!.matchCase).toBe(true);
  });

  test('~match-case option enables case-insensitive matching', async () => {
    const ublockRules = rulesFromText('||example.com^$~match-case');
    expect(ublockRules.blockRules![0]!.options!.matchCase).toBe(false);
  });

  // Edge cases for isUrlBlocked guard clauses (lines 176-177, 180-182)
  test('empty string URL returns false', async () => {
    const ublockRules = rulesFromText('||ads.google.com^');
    const result = await isUrlBlocked('', ublockRules);
    expect(result).toBe(false);
  });

  test('non-string URL returns false', async () => {
    const ublockRules = rulesFromText('||ads.google.com^');
    const result = await isUrlBlocked(null as any, ublockRules);
    expect(result).toBe(false);
  });

  test('URL with no extractable domain returns false', async () => {
    const ublockRules = rulesFromText('||ads.google.com^');
    const result = await isUrlBlocked('not-a-url', ublockRules);
    expect(result).toBe(false);
  });

  // blockDomains (new lightweight format) - lines 67-74
  test('blockDomains lightweight format blocks matching URL', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['ads.example.com'],
      exceptionDomains: [],
    };
    const result = await isUrlBlocked('https://ads.example.com/track', ublockRules);
    expect(result).toBe(true);
  });

  test('blockDomains wildcard pattern blocks subdomain', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['*.tracker.net'],
      exceptionDomains: [],
    };
    const result = await isUrlBlocked('https://sub.tracker.net/pixel', ublockRules);
    expect(result).toBe(true);
  });

  test('blockDomains does not block non-matching URL', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['ads.example.com'],
      exceptionDomains: [],
    };
    const result = await isUrlBlocked('https://safe.example.com/page', ublockRules);
    expect(result).toBe(false);
  });

  // exceptionDomains (new lightweight format) - lines 105-112
  test('exceptionDomains lightweight format overrides block', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['ads.example.com'],
      exceptionDomains: ['ads.example.com'],
    };
    const result = await isUrlBlocked('https://ads.example.com/allowed', ublockRules);
    expect(result).toBe(false);
  });

  test('exceptionDomains wildcard pattern overrides block for subdomain', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['*.tracker.net'],
      exceptionDomains: ['*.tracker.net'],
    };
    const result = await isUrlBlocked('https://sub.tracker.net/pixel', ublockRules);
    expect(result).toBe(false);
  });

  // wildcard exception rules (old format) - lines 93, 132-134
  test('wildcard exception rule overrides wildcard block rule', async () => {
    const ublockRules = rulesFromText(`||*.ads.net^\n@@||*.ads.net^`);
    const result = await isUrlBlocked('https://sub.ads.net/image.gif', ublockRules);
    expect(result).toBe(false);
  });

  // 1p option (firstParty) - line 252
  test('1p option matches only first-party requests', async () => {
    const ublockRules = rulesFromText('||analytics.com^$1p');
    const firstParty = await isUrlBlocked('https://analytics.com/track', ublockRules, { isThirdParty: false });
    const thirdParty = await isUrlBlocked('https://analytics.com/track', ublockRules, { isThirdParty: true });
    expect(firstParty).toBe(true);
    expect(thirdParty).toBe(false);
  });

  // Rule index caching (WeakMap) - reuse same rules object
  test('rule index is cached across calls with same rules object', async () => {
    const ublockRules = rulesFromText('||cached.example.com^');
    const result1 = await isUrlBlocked('https://cached.example.com/page', ublockRules);
    const result2 = await isUrlBlocked('https://cached.example.com/page2', ublockRules);
    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });

  // blockDomains with multiple entries
  test('blockDomains with multiple domains blocks all of them', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['ads.example.com', 'tracker.example.com'],
      exceptionDomains: [],
    };
    expect(await isUrlBlocked('https://ads.example.com/track', ublockRules)).toBe(true);
    expect(await isUrlBlocked('https://tracker.example.com/pixel', ublockRules)).toBe(true);
    expect(await isUrlBlocked('https://safe.example.com/page', ublockRules)).toBe(false);
  });

  // exceptionDomains with multiple entries
  test('exceptionDomains with multiple domains exempts all of them', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['*.example.com'],
      exceptionDomains: ['safe.example.com', 'trusted.example.com'],
    };
    expect(await isUrlBlocked('https://safe.example.com/page', ublockRules)).toBe(false);
    expect(await isUrlBlocked('https://trusted.example.com/page', ublockRules)).toBe(false);
    expect(await isUrlBlocked('https://other.example.com/page', ublockRules)).toBe(true);
  });

  // blockDomains takes priority over blockRules (old format)
  test('blockDomains takes priority over blockRules when both present', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['new.example.com'],
      exceptionDomains: [],
      blockRules: [{ domain: 'old.example.com', options: {} }],
    };
    // blockDomains should be used, blockRules should be skipped
    expect(await isUrlBlocked('https://new.example.com/page', ublockRules)).toBe(true);
    expect(await isUrlBlocked('https://old.example.com/page', ublockRules)).toBe(false);
  });

  // exceptionDomains takes priority over exceptionRules (old format)
  test('exceptionDomains takes priority over exceptionRules when both present', async () => {
    const ublockRules: UblockRules = {
      blockDomains: ['*.example.com'],
      exceptionDomains: ['new-exception.example.com'],
      exceptionRules: [{ domain: 'old-exception.example.com', options: {} }],
    };
    expect(await isUrlBlocked('https://new-exception.example.com/page', ublockRules)).toBe(false);
    // old-exception rule should be skipped
    expect(await isUrlBlocked('https://old-exception.example.com/page', ublockRules)).toBe(true);
  });

  // UF-302 performance test
  test('matches many rules faster via the rule index', async () => {
    const blockLines = Array.from({ length: 10000 }, (_, i) => `||domain${i}.com^`);
    const exceptionLines = Array.from({ length: 100 }, (_, i) => `@@||exception${i}.com^`);
    const allLines = [...blockLines, ...exceptionLines];
    const ublockRules = rulesFromText(allLines.join('\n'));

    const startTime = performance.now();
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        await isUrlBlocked(`https://domain${i}.com/test.js`, ublockRules);
      } else {
        await isUrlBlocked(`https://nonblocked${i}.com/test.js`, ublockRules);
      }
    }
    const endTime = performance.now();

    expect(endTime - startTime).toBeLessThan(1000);
  });

  describe('legacy + lightweight format mixing (PBI 2026-09-12-08)', () => {
    test('warns when both blockDomains and legacy blockRules are present', async () => {
      const logger = await import('../logger/api.js');
      const warnSpy = vi.spyOn(logger, 'logWarn').mockResolvedValue(undefined);
      try {
        // Both shapes present: the priority rule (domains win) must stay
        // unchanged — the mixed store only gains observability.
        const ublockRules: UblockRules = {
          blockDomains: ['blocked.example.com'],
          exceptionDomains: [],
          blockRules: [{ domain: 'legacy.example.com', options: {} }],
          exceptionRules: [],
          metadata: { importedAt: 0, ruleCount: 2 },
        };
        const matched = await isUrlBlocked('https://blocked.example.com/page', ublockRules);
        expect(matched).toBe(true);
        const legacyMatched = await isUrlBlocked('https://legacy.example.com/page', ublockRules);
        expect(legacyMatched).toBe(false); // legacy set ignored (by design)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('legacy blockRules'),
          expect.objectContaining({ blockRules: 1, blockDomains: 1 }),
          undefined,
          'ublockMatcher',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    test('does not warn for the single-format stores', async () => {
      const logger = await import('../logger/api.js');
      const warnSpy = vi.spyOn(logger, 'logWarn').mockResolvedValue(undefined);
      try {
        const ublockRules: UblockRules = {
          blockDomains: ['blocked.example.com'],
          exceptionDomains: [],
          blockRules: [],
          exceptionRules: [],
          metadata: { importedAt: 0, ruleCount: 1 },
        };
        await isUrlBlocked('https://blocked.example.com/page', ublockRules);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
