# CLEANSING_RULES → フラグ prop 名導出の 3 重実装を共有化（refactor）

## 1. タイトル + 種別

- **タイトル**: 「`aiSummaryCleansing` + Capitalize(rule.key)」という prop 名導出ルールの 3 重実装を `cleansingFlagProp(rule)` 1 つに共有化する
- **種別**: refactor（挙動不変・重複の共有化のみ）
- **見積もり**: 1 SP

## 2. 優先度

- **優先度**: 順位 7
- **RICE**: R3 / I1 / C1.0 / E1 → **3.0**
- **根拠**:
  - prop 名導出ルール（`aiSummaryCleansing` + ルールキーの先頭大文字化）が 3 箇所で別々に書かれている。動作は今日同一だが、ルールキーの命名規約変更や新規ルール追加時に「大文字化の仕方が片方だけ違う」サイレント不整合が起きうる
  - 発生すると設定値が黙って適用されない（動的 property access が undefined を返し、キャストやフォールバックで黙って通る）。重複削減でこの実害リスクを構造的に潰せる
  - `as` キャストが 2 箇所（optionBuilder・visitGating）に散在しており、1 つの型付きヘルパーに折りたためる
- **依存**: なし

## 3. ユーザーストーリー

**コンテンツクレンジング設定の保守担当者として**、CLEANSING_RULES のルールキーから CleansingConfig の prop 名を導出するルールが 1 箇所だけに存在してほしい。なぜなら、導出ルールが 3 箇所に分かれていると、キー命名規約の変更や新規ルール追加時に 1 箇所だけ更新が漏れてもコンパイルもテストも失敗せず、設定値が黙って適用されなくなるから。

## 4. 背景

「`aiSummaryCleansing` + Capitalize(rule.key)」という prop 名導出ルールが 3 箇所で別々に書かれている。1 箇所は独自 `capitalize()` ヘルパー経由、残り 2 箇所は `charAt(0).toUpperCase() + slice(1)` の直書き。今日は同一だが、将来ルールキーの命名規約が変わったときに片方だけ大文字化方法が変わると、動的 property access の不一致が silent 不整合（設定値が黙って適用されない）として顕在化する。`as` キャストも 2 箇所に散在している。

該当箇所（全 file:line 検証済み）:

- `src/utils/contentExtractor/optionBuilder.ts:21-23` — 独自 `capitalize()` ヘルパー（`s.charAt(0).toUpperCase() + s.slice(1)`）
- `src/utils/contentExtractor/optionBuilder.ts:45` — `(config as unknown as Record<string, unknown>)[\`aiSummaryCleansing${capitalize(rule.key)}\`] as boolean`（二重キャスト付きの動的 property access）
- `src/content/visitGating.ts:175-178` — `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}` を `as BooleanCleansingKey` でキャスト
- `src/utils/cleansingConfig.ts:54-59` — `CLEANSING_RULE_PLACEHOLDER_DEFAULTS` 生成時の同一インライン導出

## 5. BDD シナリオ

### シナリオ 1: prop 名導出が 1 実装に統一される

```gherkin
Given cleansingConfig.ts に cleansingFlagProp(rule) がエクスポートされている
When リポジトリ内の aiSummaryCleansing プレフィックス付き prop 名導出を検索する
Then 導出ロジックは cleansingFlagProp 内の 1 実装のみであること
And optionBuilder.ts と visitGating.ts と CLEANSING_RULE_PLACEHOLDER_DEFAULTS 生成の 3 箇所すべてが cleansingFlagProp を呼び出していること
```

### シナリオ 2: 導出 prop 名が golden pin と一致する

```gherkin
Given CLEANSING_RULES の各ルール key に対する期待 prop 名の一覧（golden pin）がテストに存在する
When cleansingFlagProp(rule) を各ルールに適用する
Then 導出結果が golden pin の期待 prop 名とすべて一致すること
```

### シナリオ 3: 挙動が完全に不変である

```gherkin
Given optionBuilder・visitGating・cleansingConfig 関連の既存テストが green である
When リファクタリング後に npm run validate を実行する
Then すべてのテストが無変更（pin 部分のみ）で通過すること
And 導出される prop 名・フラグ値は変更前と同一であること
```

## 6. 受け入れ基準

- [x] `cleansingConfig.ts` に単一の `cleansingFlagProp(rule)` がエクスポートされている（型付きヘルパーで、散在していた 2 箇所の `as` キャストが 1 つのヘルパーに折りたたまれている）
- [x] `optionBuilder.ts:21-23` の独自 `capitalize()` ヘルパーが削除されている
- [x] `optionBuilder.ts:45` の導出が `cleansingFlagProp(rule)` を使用している（`as unknown as Record<string, unknown>` の二重キャストが削除されている）
- [x] `visitGating.ts:175-178` の導出が `cleansingFlagProp(rule)` を使用している（`as BooleanCleansingKey` キャストが削除されている）
- [x] `cleansingConfig.ts:54-59` の `CLEANSING_RULE_PLACEHOLDER_DEFAULTS` 生成が同一インライン導出から `cleansingFlagProp(rule)` を使用している
- [x] `CLEANSING_RULES` 自体は SSOT のまま変更されない
- [x] 挙動が完全に不変である（導出 prop 名・フラグ値は変更前と同一、既存テスト全通過）

## 7. テスト戦略

1. **prop 名導出の golden pin 先行**: 着手前に CLEANSING_RULES の各 key に対する導出 prop 名の期待一覧（golden pin）をテストに置き、`cleansingFlagProp(rule)` の導出結果と一致することを pin する。リファクタリング中はこの pin を安全網として使う
2. **既存テスト green**: optionBuilder・visitGating・cleansingConfig の既存テストは無変更で通過させる（pin 部分の変更は許可しない。呼び出し置換とキャスト削除のみ行う）
3. **type-check 通過**: `npm run type-check` で散在していた `as` キャストがヘルパー 1 箇所に折りたたまれたことをコンパイル時に確認する
4. **挙動不変の確認**: `npm run validate`（type-check + test）で既存テスト全通過を確認する

## 8. 見積もり

**1 SP** — 1 ヘルパーの追加と 3 箇所の呼び出し置換、キャスト削除のみでロジック変更なし。影響範囲は `cleansingConfig.ts`、`optionBuilder.ts`、`visitGating.ts` の 3 ファイル（+ 必要に応じて golden pin テスト 1 件）

## 9. DoD

- [x] 受け入れ基準 7 件すべて充足
- [x] `npm run validate`（type-check + test）が green
- [x] prop 名導出の golden pin が green（CLEANSING_RULES 全ルールに対する導出 prop 名の一致）
- [x] リポジトリ内に `aiSummaryCleansing${` による prop 名直書き導出が残っていない（grep で確認。`cleansingFlagProp` 実装内のみ許容）
- [x] 既存機能への影響ゼロ（挙動不変）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 7（R3 / I1 / C1.0 / E1 → 3.0）。同点 5-way の順位根拠は台帳「同点の順位根拠」節（リスク軽減順: 設定値 silent 不整合は wire 契約 silent drift の次）
- 依存: なし
