---
name: 非推奨 piiStripper shim を削除し import を正す
type: refactor
priority: 4
rice:
  reach: 2
  impact: 1
  confidence: 1.0
  effort: 0.2
  score: 10.0
depends_on: []
---

## 現象
`src/utils/piiStripper.ts` は `piiBoundary` の shallow re-export（本番 import 0件）。`piiSanitizer`（regex マスク）と `piiBoundary`（original 剥離）が同 prefix で並走し、seam 意図が分散して drift の温床。`src/utils/__tests__/piiStripper.test.ts` のみが shim を参照。

## なぜなぜ分析
1. なぜ shim が残るのか → 移行期の互換維持
2. なぜ名前が衝突するのか → PII_MASKING / PII_BOUNDARY で責務が分かれていない
3. なぜ deletion test が合格するのか → 代替（piiBoundary / piiSanitizer）が完全
→ 解: shim に `@deprecated` 期限を明記、次 release で削除。テスト import を `piiBoundary` / `piiSanitizer` に移行し命名を分離。

## 受け入れ基準
- `piiStripper.ts` が削除されている（または `@deprecated` 明記＋削除）
- テストが shim 経由ではなく正しいモジュールを import
- `src/utils/__tests__/piiStripper.test.ts` が合格（import 修正後）

## BDD シナリオ
```gherkin
Scenario: PII マスクは piiSanitizer 経由で動作する
  Given 入力 "contact alice@example.com"
  When  stripPii(input) を呼ぶ
  Then  email がマスクされる

Scenario: original 剥離結果は piiBoundary 経由
  Given  抽出結果
  When  toExternalResult(result) を呼ぶ
  Then  PII 境界メタデータが付与される
```

## DoD
- [x] shim 削除または @deprecated 明記
- [x] テスト import を正モジュールに移行
- [x] type-check / lint / test が PASS
