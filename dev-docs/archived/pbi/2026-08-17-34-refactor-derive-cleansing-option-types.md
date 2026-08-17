# PBI: クレンジング型定義を CLEANSING_RULES から導出し、手書き32フィールドを廃止する

## ユーザーストーリー
開発者として、AI 要約クレンジングのルール追加時に `CLEANSING_RULES` 行・`CleansingConfig` フィールド・`optionBuilder` の手書きマッピング・`AiSummaryCleanseOptions` フィールド・`AiSummaryCleansingSettings` フィールドの6箇所を編集し、完全性を実行時テストでしか担保できていない状態を解消したい。なぜなら、`CLEANSING_RULES` は既に単一ソースなのに、型とマッピングだけが手書きで残っており、ルール追加の際にドリフトしやすいから。

## ビジネス価値
- ルール追加が「テーブル1行＋パターン定数1つ」に縮小する
- 完全性を実行時テストからコンパイル時保証に格上げする
- `optionBuilder` の32行の手書きマッピングを機械的に導出する

## BDD受け入れシナリオ

```gherkin
Scenario: 型がルールテーブルから導出される
  Given CLEANSING_RULES が唯一のソースである
  When AiSummaryCleanseOptions 型を解決する
  Then ルールキーから `${key}Enabled` として導出される
  And 手書きの32フィールド宣言が存在しない

Scenario: ルール追加が1行で完結する
  Given 新しいクレンジングルールを追加する
  When CLEANSING_RULES に1行追加する
  Then optionBuilder のマッピングとオプション型が自動的に追随する
  And 型エラーで欠落が検出される

Scenario: 完全性がコンパイル時に保証される
  Given ルールとオプションの対応が型で固定されている
  When ルールを追加してオプション型を更新し忘れる
  Then 型チェックが失敗する
```

## 受け入れ基準
- [ ] `AiSummaryCleanseOptions` / `CleansingConfig` が `CLEANSING_RULES` のキーから導出されている
- [ ] `optionBuilder.ts`（`src/utils/contentExtractor/optionBuilder.ts:33-75`）の手書き32フィールドマッピングが `Object.fromEntries(CLEANSING_RULES.map(...))` に置き換わっている
- [ ] 完全性テスト（`pageState.test.ts` のランタイム検証）が型レベル保証に置き換わっている
- [ ] 既存のクレンジングテスト（`aiSummaryCleaner` 16テストファイル）がすべてパスする
- [ ] `npm run type-check` と `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- 設定UI（`aiSummaryCleansingSettingsV2.ts`）とクレンジング実行が同一のルールセットを使う契約テスト

### 単体テスト
- 型導出の正しさを検証する型レベルのテスト（`expectTypeOf` 等）
- `optionBuilder` の導出マッピングが旧手書きマッピングと等価であることの回帰テスト

## 実装アプローチ
- **Outside-In**: まず型導出の失敗する型テストを書き、導出型を定義してグリーン化
- **Red-Green-Refactor**: `optionBuilder` を導出マッピングへ置換し、既存テストで挙動を固定

## 見積もり
1ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: 型導出はコンパイル時に解決されるため、`vitest` の型テストで検証
- 副作用: 実行時挙動は不変（マッピングの等価性を回帰テストで固定）

## 実装者向け注記

### 現状コードの確認
```bash
# 手書き32フィールドマッピングを確認
sed -n '33,75p' src/utils/contentExtractor/optionBuilder.ts
# ルールテーブルを確認
grep -n "CLEANSING_RULES" src/utils/aiSummaryCleaner/rules.ts
# 型宣言の手書きを確認
grep -rn "CleansingConfig\|AiSummaryCleanseOptions" src/content/pageState.ts src/utils/aiSummaryCleaner/types.ts
```

### 現状（2026-08-17 確認済み）
- `CLEANSING_RULES`（`rules.ts`）は単一ソースで、`index.ts` / `ruleLabels.ts` / `storage/defaults.ts` / `aiSummaryCleansingSettingsV2.ts` は既にループで導出している
- `optionBuilder.ts:33-75` だけが32フィールドを手書きで `config.aiSummaryCleansingXxx` → `options.xxxEnabled` に展開している
- `pageState.ts:17-65` の `CleansingConfig` と `types.ts` の `AiSummaryCleanseOptions` は手書き宣言で、`as unknown as CleansingConfig` のキャストで整合性を逃している
- 完全性は `pageState.test.ts` のランタイム検証でしか担保されていない
- 既実装の重複: なし（この PBI は未実装）

### 実装手順
1. `CLEANSING_RULES` のキーからオプション型を導出する mapped type を定義（例: `type AiSummaryCleanseOptions = { [K in RuleKey as `${K}Enabled`]?: boolean } & { /* thresholds */ }`）
2. `CleansingConfig` を同様に導出（`aiSummaryCleansing${Capitalize<K>}` 命名規則に合わせる）
3. `optionBuilder.ts` を `Object.fromEntries(CLEANSING_RULES.map(...))` へ置換
4. `as unknown as CleansingConfig` のキャストを除去
5. ランタイム完全性テストを型テストへ置換し、等価性回帰テストを追加

### 落とし穴
- 命名規則が2系統ある: `CleansingConfig` は `aiSummaryCleansing${key}`（capitalize）、`AiSummaryCleanseOptions` は `${key}Enabled`。mapped type の key remapping で両方に対応すること
- 閾値（`linkRatioThreshold` 等）や `bodyProtection` など、ルール由来でないオプションは導出対象外。mapped type との交差（`&`）で明示的に残すこと
- `ruleHtmlId()`（`aiSummaryCleansingSettingsV2.ts`）は DOM ID を導出するUI専用の関数。型導出とは独立に維持すること
- `as unknown as` キャストの除去は、既存の `DEFAULT_CLEANSING_CONFIG` 導出（`CLEANSING_RULE_PLACEHOLDER_DEFAULTS`）と合わせて行い、中途半端に残さないこと

## Definition of Done
- [ ] `AiSummaryCleanseOptions` / `CleansingConfig` が `CLEANSING_RULES` から導出されている
- [ ] `optionBuilder.ts` の手書きマッピングが機械的導出に置き換わっている
- [ ] ランタイム完全性テストが型レベル保証に置き換わっている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
