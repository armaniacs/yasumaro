# PBI: `saveDashboardSettings` が 8 つの関心を 1 関数に持ち、数値 coercion が 4 連で複製され、同一パスで `getAll()` が二重読まれる

## ユーザーストーリー

設定保存の保守担当者として、保存パイプラインの関心を分割したい。165 行の 1 関数に追加の確認や検証が積まれ続け、5 つ目の保持キーが増えたときに coercion の付け忘れが起きる構造だから。

## 優先度

- 順位: 26/32
- RICE: 2.0（R5 / I1 / C0.8 / E2）
- 根拠: 分割単位の設計判断が残る。NN07 の検証 SSOT 1 本化の後が安全
- 依存: NN07

## 背景（file:line 現状）

すべて `src/dashboard/settingsPipeline.ts`（:92 関数開始、165 行）:

- :100-102 の位置依存の `getElement(0)/(2)`、:111 の検証、:115-135 の HTTP 確認ダイアログ、:140 の `getAll()` 1 回目、:147-152 の収集 try/catch、:153-193 の B レイアウト検証＋警告 DOM 生成（生成は :159-192）、:201-203 / :204-206 / :209-211 / :212-214 の coercion 4 連（`''|undefined → null / else Number()` の同一式）、:216 の `getAll()` 2 回目、:223-237 の空値ガード、:243-246 の origin 確認ダイアログ、:252 の永続化
- 読み込み側の二重取得: `src/dashboard/panels/staticForm/generalSettingsPanel.ts:69-71`（`getAll()` → `loadSettingsToInputs` → `loadGeneralSettings()`）+ `src/dashboard/generalSettings/settingsForm.ts:85-86`（内部で再び `getAll()`）。1 回の reload で同一スナップショットを 2 回フェッチする
- 同一の「checkbox → 可視化」ルール 2 実装: `generalSettingsPanel.ts:87-99`（変更リスナ）と `settingsForm.ts:107-126`（読み込み時適用）の 3 ルール分
- B レイアウトの警告 div 生成・削除を保存関数が DOM 構築まで担い、保存ロジックの単体テストが DOM 必須になっている

## BDD受け入れシナリオ

```gherkin
Scenario: 保持キーの追加が表の 1 行で済む
  Given 5 つ目の保持キーを追加する
  When NUMERIC_TO_NULL の表に 1 行足す
  Then coercion が適用され、付け忘れが起きない

Scenario: 可視化ルールが 1 ループで適用される
  Given checkbox の変更時と読み込み時
  When VISIBLE_WHEN の表で適用する
  Then 3 ルールとも両タイミングで同一結果になる

Scenario: 保存時のフェッチ回数が減る
  Given 保存処理の実行
  When getAll の呼び出し回数を数える
  Then layout 取得と空値ガード用で 2 回読まず、スナップショットを使い回す
```

## 受け入れ基準

- [x] 数値 coercion が `NUMERIC_TO_NULL` の表-driven になっている
- [x] 可視化ルールが `VISIBLE_WHEN` の表-driven になり、`applyVisibilityToggles` / `setupVisibilityToggles` に集約されている
- [x] `loadGeneralSettings(repo)` がスナップショットを受け取る形になり、`generalSettingsPanel` 側の `getAll` を流用して二重取得が解消されている
- [x] B 警告 DOM 生成が `renderBPriorityWarnings(...)` へ切り出され、`saveDashboardSettings` は validate → render → return の順だけ残る
- [x] 挙動・エラー文言・null ガードは移設で不変（`validateAllFields()` 周辺は NN07 着地後の整理と整合する）
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: coercion 表の境界値テスト、可視化ルールの両タイミング一致テスト
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/settingsPipeline.ts`（NUMERIC_TO_NULL 表 + renderBPriorityWarnings 抽出、getAll を 1 スナップショットに集約）、`src/dashboard/generalSettings/settingsForm.ts`（VISIBLE_WHEN 表 + スナップショット受取対応。既存呼び出しは互換維持）、`src/dashboard/panels/staticForm/generalSettingsPanel.ts`（ローカル配線を削除し setupVisibilityToggles に置換）
- テスト: settingsPipeline / settingsForm 4 ファイル 39 tests + 関連 6 ファイル 62 tests green
- ゲート: type-check PASS / lint 0 errors
