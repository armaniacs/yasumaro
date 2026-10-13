# PBI: contentCleaner の count/strip 双子の hidden パス drift を収集ヘルパー抽出で閉じる

- 種別: fix
- RICE: 8.0（R6 × I2 × C1.0 / E1.5）
- 依存: なし
- バッチ: W1

## ユーザーストーリー

クレンジング診断を見るユーザーとして、除去前の見込み数（recount）が実際の strip 契約と一致していてほしい。なぜなら hidden 要素が存在するページで見込み数が過小報告され、診断の信頼性が下がるから。

## 背景（現状）

- `src/utils/contentCleaner.ts:133-181` — `stripHardStripElements` は 3 パス（タグ / 属性 / `HIDDEN_ELEMENT_SELECTOR`）で要素を収集し remove。hidden パスは :168-172
- `src/utils/contentCleaner.ts:276-323` — `countCleanseTargets` はタグ + 属性の 2 パスのみで `HIDDEN_ELEMENT_SELECTOR` パスが欠落（:286-311）
- 消費者: `src/utils/contentExtractor/extractionReport.ts:547`（診断 recount）、`src/utils/contentExtractor/extractPipeline.ts:344`

双子が drift 済み — hidden div が存在する場合、診断 recount の `hardStripRemoved` / `totalRemoved` が実際の strip 契約より過小報告する。keyword 系は既に正解形（`collectKeywordElements` :223 を strip/count で共有）なので、hard-strip 側に同形を複製する。

## BDD 受け入れシナリオ

```gherkin
Scenario: hidden 要素が存在するページの見込み数が実際の除去数と一致する
  Given [hidden] 属性を持つ div と display:none の span が存在するページ
  When countCleanseTargets を呼ぶ
  Then hardStripRemoved に hidden 要素分が含まれる
  And 同一入力で stripHardStripElements の除去数と一致する

Scenario: hidden 要素が存在しないページで見込み数は従来どおり
  Given hidden 要素が存在しないページ
  When countCleanseTargets を呼ぶ
  Then 結果は変更前と同一である（挙動不変）
```

## 受け入れ基準

- [x] `collectHardStripTargets(root): Set<Element>` を 1 本抽出する（タグ / 属性 / hidden の 3 パス、既存 `collectKeywordElements` と同形）
- [x] `stripHardStripElements` は `collectHardStripTargets` を反復して remove し、収集ロジックを二重に持たない
- [x] `countCleanseTargets` は `collectHardStripTargets(...).size` を使い、hidden パスを含む
- [x] hidden 要素を含む fixture テストを追加し、recount と strip の一致を pin する
- [x] hidden 要素なしの既存テストが green（挙動不変）
- [x] `HIDDEN_ELEMENT_SELECTOR` への言及が count 側コメントに残らない（ヘルパーが唯一の所有）

## テスト戦略

- unit: `src/utils/__tests__/contentCleaner*.test.ts` — fixture 先行（hidden 要素を含む DOM で recount < strip が再現する落ちるテストを先に追加してから直す）
- 境界値: hidden セレクタの各形態（`[hidden]` / `[aria-hidden="true"]` / `[style*="display:none"]`）を個別に pin
- 挙動不変: strip 側の除去順序・削除数は変更しない（収集を 1 本化するだけ）

## 見積もり

1.5 SP

## 技術的考慮事項

- 挙動変更は count 側のみ（hidden パス追加）。strip 側は純粋な抽出
- fixture は `src/utils/__tests__/` に配置（unit）
- プライバシー保証: 変更なし（DOM クレンジングの内部構造のみ）

## 実装者向け注記

### 実装手順

1. 落ちる fixture を先に: hidden div を含む DOM で `countCleanseTargets().hardStripRemoved` と `stripHardStripElements()` の一致を assert（現状は不一致で red）
2. `collectHardStripTargets` を抽出（strip 側の :136-172 を移設）
3. `stripHardStripElements` / `countCleanseTargets` を呼び出し側に書き換え
4. green 確認 → `npx vitest run src/utils/__tests__/contentCleaner`

### 落とし穴

- `isHardStripTarget` を使う RegExp 属性パスは `!elementsToRemove.has(elem)` ガード付き（strip 側）。抽出時に Set 重複排除の意味論を保つ（Set 自体が排除するのでガードは最適化、削除可）
- extractionReport 側の型・呼び出しは変更不要（countCleanseTargets の戻り型は不変）

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 収集ロジックの実装箇所が `collectHardStripTargets` の 1 箇所のみ
- [x] hidden 要素を含む fixture テストが red→green の履歴を持つ
- [x] `npx vitest run src/utils` が green
- [x] ロールバック不要（recount の過小報告を塞ぐ fix）
