---
name: loader domain policy を content-script-safe adapter に抽出
type: refactor
priority: 1
rice:
  reach: 20
  impact: 1
  confidence: 0.8
  effort: 0.6
  score: 26.7
depends_on: []
---

## 現象
`src/content/loader.ts:18-110` が `StorageKeys` を文字列リテラルで再定義し、`checkDomainAllowedFromCache` が `isDomainAllowed` / `isDomainInList` の簡易再実装を抱える。whitelist/blacklist+uBlock の3モード分岐が content-script に漏出し、フィルタ仕様変更が2箇所に波及する（locality 違反）。

## なぜなぜ分析
1. なぜ loader が StorageKeys を再定義するのか → content-script が `utils/storage` を import できないという誤った前提
2. なぜ checkDomainAllowedFromCache を再実装するのか → domainUtils の純粋関数を content-script 用にラップしたかった
3. なぜ3モード分岐が漏出するのか → ポリシ判定を1つの seam に集約していなかった
→ 解: content-script-safe な `domainPolicy` 純粋関数を `src/utils/domainUtils.ts`（または新設 `src/content/domainPolicy.ts`）に置き、loader は `await policy.shouldInject(url)` のみにする。

## 受け入れ基準
- `loader.ts` が `StorageKeys` を再定義しない
- ドメインポリシ判定が `utils/domainUtils` の純粋関数に集約されている
- 既存の `src/content/__tests__/loader.test.ts` が合格

## BDD シナリオ
```gherkin
Scenario: 許可ドメインは注入される
  Given url "https://example.com/page"
  And   example.com が whitelist に含まれる
  When  policy.shouldInject(url) を評価
  Then  true を返す

Scenario: uBlock ルールでブロックされる
  Given url "https://ads.tracker.com"
  And   "||tracker.com^" が uBlock ソースに含まれる
  When  policy.shouldInject(url) を評価
  Then  false を返す
```

## DoD
- [x] domainPolicy 純粋関数を抽出
- [x] loader が再定義を削除し1 seam のみに
- [x] type-check / lint / test が PASS
