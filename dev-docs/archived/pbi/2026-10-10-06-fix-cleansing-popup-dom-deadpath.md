# PBI: aiSummaryCleansingSettingsV2 の popup DOM デッドパスを除去する

- 種別: fix
- RICE: 5.0（R5 × I1.5 × C1.0 / E1.5）
- 依存: なし
- バッチ: W2

## ユーザーストーリー

保守担当者として、dashboard モジュールの DOM 契約が実在する要素だけを語っていてほしい。なぜなら本番に存在しない popup 専用 id への照会・書き込みが null ガードで静かに隠され、テストが DOM を手作りしてデッドパスを「緑」に保っているから。

## 背景（現状）

- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:243-250` — `popup-body-protection-enabled` / `popup-body-protection-threshold` / `popup-body-protection-threshold-value` を `getElementById` で照会（mount 時のミラー更新）
- `:365-370` — apply/get 関数内でも同一 id を照会・書き込み
- `:482` — `'popup-body-protection-enabled'` リテラル参照
- `entrypoints/options/index.html` と `entrypoints/popup/index.html` のいずれにもこれらの id は不在（rg で全 HTML ゼロ一致を裏取り済み）
- テストだけが DOM を手作りしてパス（`src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2.test.ts:102-104,385-387`、`aiSummaryCleansingSettings-extra.test.ts:221-225,457-577`）

設定 UI の dashboard 集約（popup 側 DOM 消滅）後も null ガードがデッドパスを隠している。locality 違反（dashboard モジュールが popup の DOM 契約を保持）。

## BDD 受け入れシナリオ

```gherkin
Scenario: モジュールが実在しない DOM id を参照しない
  Given aiSummaryCleansingSettingsV2 がデッドパス除去済みである
  When モジュールを検査する
  Then popup-body-protection-* への参照は 0 件である

Scenario: 既存の AI クレンジング設定 UI は変更前と同一に動く
  Given options ページの AI クレンジング設定パネル
  When 設定を表示・保存する
  Then ai-summary-cleansing-* の挙動は変更前と同一である
```

## 受け入れ基準

- [x] `:243-250` / `:365-370` / `:482` の popup id ブロック（宣言・照会・書き込み・null ガード分岐）を削除する
- [x] テストの手作り popup DOM（input/span 3 要素）と当該 assertion を削除・更新する
- [x] popup-body-protection への参照がリポジトリで 0 件（rg 確認）
- [x] 既存の AI クレンジング設定テストが green（挙動不変）
- [x] popup-body-protection-* に対応する storage キー・設定が他から読まれていないことを確認（設定値自体は残す、UI 接線のみ除去）

## テスト戦略

- unit: `src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2.test.ts` / `aiSummaryCleansingSettings-extra.test.ts` — popup DOM fixture と当該 assertion を削除、残りは green
- 挙動不変: ai-summary-cleansing-* の保存・読込は変更しない

## 見積もり

1.5 SP

## 技術的考慮事項

- 57 箇所の素 `getElementById` の resolveDom() 化は本 PBI のスコープ外（台帳送り G16）
- プライバシー保証: 変更なし（デッドパス除去のみ）

## 実装者向け注記

### 実装手順

1. `aiSummaryCleansingSettingsV2.ts` の popup id ブロック 3 箇所を削除（変数宣言 + null ガード分岐ごと）
2. テストの popup DOM fixture と assertion を削除
3. `rg -n "popup-body-protection" src/ entrypoints/` で 0 件確認
4. `npx vitest run src/dashboard/settings` で検証

### 落とし穴

- :243-250 のミラー更新ブロックは他の変数宣言と混ざっている可能性 — 削除対象を popup id 3 つに限定する
- popup-body-protection 設定値の storage キーは削除しない（別機能が読む可能性を確認）

## Definition of Done

- [x] popup-body-protection-* 参照が 0 件
- [x] `npx vitest run src/dashboard/settings` が green
- [x] 挙動不変（ai-summary-cleansing-* は不変）
- [x] ロールバック不要（デッドパス除去）
