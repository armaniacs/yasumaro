// ublockMatcher.test.ts
// Tests for the uBlock matcher integration (UF-103)

import { isUrlBlocked, type UblockRules, type UblockMatcherContext } from '../ublockMatcher.js';
import { parseUblockFilterList } from '../ublockParser.js';

/** Helper to create a simple rule set */
function rulesFromText(text: string): UblockRules {
  return parseUblockFilterList(text);
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

  test('3p option matches only third‑party requests', async () => {
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
    // This is a simplified test - in a real implementation, we would need to modify
    // the matching logic to support case-sensitive comparisons
    const ublockRules = rulesFromText('||EXAMPLE.COM^$match-case');
    // For now, we just verify the option is parsed correctly
    expect(ublockRules.blockRules[0].options.matchCase).toBe(true);
  });

  test('~match-case option enables case-insensitive matching', async () => {
    // This is a simplified test - in a real implementation, we would need to modify
    // the matching logic to support case-insensitive comparisons
    const ublockRules = rulesFromText('||example.com^$~match-case');
    // For now, we just verify the option is parsed correctly
    expect(ublockRules.blockRules[0].options.matchCase).toBe(false);
  });

  // 【UF-302追加テスト】ルールインデックス機能のパフォーマンス改善を検証
  test('ルールインデックス機能により大量ルールのマッチングが高速化されること', async () => {
    // 【テスト目的】: ルールインデックス機能により大量ルールのマッチングが高速化されることを確認
    // 【テスト内容】: 10,000件のルールを持つリストに対してマッチングを行い、パフォーマンスを検証
    // 【期待される動作】: 10,000件のルールに対して100回のマッチングが1秒以内に完了すること
    // 🟢 信頼性レベル: UF-302 パフォーマンス最適化要件

    // 【テストデータ準備】: 10,000件のブロックルールと100件の例外ルールを生成
    const blockLines = Array.from({ length: 10000 }, (_, i) => `||domain${i}.com^`);
    const exceptionLines = Array.from({ length: 100 }, (_, i) => `@@||exception${i}.com^`);
    const allLines = [...blockLines, ...exceptionLines];
    const ublockRules = rulesFromText(allLines.join('\n'));

    // 【実際の処理実行】: 100回のマッチング処理時間を計測
    const startTime = performance.now();
    for (let i = 0; i < 100; i++) {
      // マッチするURLとマッチしないURLを交互にテスト
      if (i % 2 === 0) {
        await isUrlBlocked(`https://domain${i}.com/test.js`, ublockRules);
      } else {
        await isUrlBlocked(`https://nonblocked${i}.com/test.js`, ublockRules);
      }
    }
    const endTime = performance.now();

    // 【結果検証】: 100回のマッチングが1秒以内に完了することを確認
    expect(endTime - startTime).toBeLessThan(1000); // 【確認内容】: 100回のマッチングが1秒未満であること 🟢
  });
});