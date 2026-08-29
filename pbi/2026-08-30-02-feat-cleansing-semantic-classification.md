# PBI: クラス部分一致に依存しないセマンティック分類を導入する

## ユーザーストーリー

閲覧者として、 `address` が `ad-` で誤削除されたり `x-` が無関係なフレームワークにヒットしたりしないクレンジングがほしい。なぜなら現行 `buildClassIdSelectors` は `class*="ad-"` の部分一致でカバレッジ優先のため誤爆が多く、Body Protection 頼みになっているから。

## 優先度

- 順位: 02 / 14
- RICE: Reach 9 / Impact 2 / Confidence 0.7 / Effort 2日 = 6.3
- 根拠: `AD_CLASS_PATTERNS` `SOCIAL_CLASS_PATTERNS` の誤爆は `patterns.test.ts` で部分的に検出されているが、結合後セレクタの誤爆は未検証。修正は `helpers.ts` の判定ロジック追加で局所的。

## 背景

- 現行: `patterns.ts` の `AD_CLASS_PATTERNS = ['ad-', 'advertisement', ...]` を `helpers.ts:buildClassIdSelectors` で `[class*="ad-"]` に展開。`stripCore.ts` / `stripExtended.ts` はこれを `querySelectorAll` で一括検索。
- 課題: `ad-` は `admin`/`address` にヒット。`x-` は `x-data`等にヒット。`isLikelyAd` は単語境界 `(^|[-_\s])ad([-_\s]|$)` で対策済みだが、他パターンは未対策。
- 機会: `role` / `aria-label` / `data-*` / テキスト内容( "Sponsored" ) / 構造(連続カード)を組み合わせた決定木にすれば、誤爆を減らしつつカバレッジ維持可能。

## BDD 受け入れシナリオ

```gherkin
Scenario: addressクラスは広告として削除されない
  Given <div class="address-book">本文</div> がある
  When stripAdElements(root) を実行する
  Then 該当要素は削除されない

Scenario: 本物の広告は削除される
  Given <div class="ad-container sponsored">広告</div> がある
  And role="complementary" を持つ
  When stripAdElements(root) を実行する
  Then 該当要素は削除される

Scenario: aria-labelで広告判定できる
  Given <div aria-label="advertisement">広告</div> がある
  When stripAdElements(root) を実行する
  Then 該当要素は削除される

Scenario: x- の誤爆が抑えられる
  Given <div class="x-data x-bind">本文</div> がある
  When stripSocialElements(root) を実行する
  Then 該当要素は削除されない
```

## 受け入れ基準

- [ ] `AD_CLASS_PATTERNS` / `SOCIAL_CLASS_PATTERNS` などの誤爆ケース(address, admin, x-data)が削除されないことを `patterns.test.ts` で保証
- [ ] 真の広告( `ad-` + sponsored テキスト / role )は削除されることを保証
- [ ] `isLikelyAd` 相当の単語境界判定を他ヘルパ(`isLikelySocial` 等)に横展開するか、判定を統合
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- なし

### 統合
- `stripCore.test.ts` / `stripExtended.test.ts` で `address-book` / `admin-panel` / `x-data` を含むDOMで誤削除0件を検証

### 単体
- `helpers.test.ts` に `isLikelyAd` 境界テスト( `ad-` vs `address` vs `header` )を追加
- `patterns.test.ts` に結合セレクタ経由の統合テスト( `buildClassIdSelectors` → 実DOMマッチ )を追加。既存の `address-book` テストを拡張
- 新ヘルパ `isLikelySocial` / `isLikelyNav` の単体テスト

## 実装アプローチ

- **Outside-In**: `patterns.test.ts` に誤爆REDテストを先に書く → `helpers.ts` に判定関数追加 → `stripCore.ts` の `AD_SELECTOR` 使用箇所を `isLikelyAd` ガード付きに段階移行
- 既存セレクタは残しつつ、削除前に `safeRemoveElement` 前のガードとして判定を追加する形でリスク最小化

## 見積もり

2pt

## 技術的考慮事項

- 依存: なし
- テスタビリティ: `helpers.ts` は純粋関数。jsdomで検証可能
- 非機能: 判定追加による実行時間増は微小。`querySelectorAll` 回数は増やさない

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "AD_CLASS_PATTERNS\|SOCIAL_CLASS_PATTERNS\|buildClassIdSelectors" src/
grep -rn "isLikelyAd\|isLikelyPopup" src/utils/aiSummaryCleaner/helpers.ts
```

### 実装手順
1. `patterns.test.ts` に `address-book` / `x-data` の誤爆REDテスト追加
2. `helpers.ts` に単語境界判定を汎用化( `createWordBoundaryRegex` )し `isLikelySocial` 等を追加
3. `stripCore.ts` / `stripExtended.ts` の該当箇所で `isLikely*` ガードを追加
4. 既存テストの期待値を新判定に合わせて更新

### 落とし穴
- `\b` はハイフンを単語境界とみなさないため、既存の `(^|[-_\s])ad([-_\s]|$)` パターンを流用すること
- `className` が SVGAnimatedString の場合 `getLowerClassName` 経由で取得する必要がある(`elementClassName.ts` 参照)

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
