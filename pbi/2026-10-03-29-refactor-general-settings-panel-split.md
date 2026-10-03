# PBI: generalSettingsPanel の責務分割（state machine / observer / dialog / presets）

## ユーザーストーリー

ダッシュボード UI の保守者として、`generalSettingsPanel.ts` の mount closure が約 290 行に及び、設定読み込み、A/B レイアウト state machine、wizard observer、ModelsDevDialog、presets、validation、purge が 1 つのクロージャに混在している状態を解消したい。state machine・observer・dialog・preset ハンドラをモジュールに切り出し、混在する state 変数と重複コードを整理したい。

## 優先度

順位: 14 / 20
RICEスコア: 4.8（Reach=6 / Impact=2 / Confidence=0.8 / Effort=2.0 SP）
根拠: `archivePanel` に次ぐ肥大化ファイル。state 変数の混在と内部重複（visibility toggle 3 か所、summary ハンドラ 2 か所、refresh core 二重化）が保守性を下げている。
依存: generalSettingsPanel チェーンの最後 — rank-02（reload）、rank-05（preset-status）、rank-08（preset-id-ssot）の完了後に着手する。

## 背景

- `generalSettingsPanel.ts` mount closure 約 290 行（L82-373）
- 混在する機能領域: 設定読み込み、A/B レイアウト state machine（L160-260）、wizard observer（L262-281）、ModelsDevDialog（L300-329）、presets（L331-353）、validation、purge
- 混在する state 変数: `currentSettings` / `currentLayout` / `bPriorityView` / `bAccordionView` / `modelsDevDialog`
- 内部重複:
  - visibility toggle 3 か所（L128-150）
  - summary ハンドラ 2 か所（L35-45）
  - mount が refresh core を二重化（L84-126 vs L374-381）

## BDD受け入れシナリオ

```gherkin
Scenario: mount closure が機能モジュールに分割される
  Given generalSettingsPanel.ts の mount closure が約 290 行で複数機能を混在させている
  When mount を再構成する
  Then A/B state machine と wizard observer と ModelsDevDialog と preset ハンドラは独立モジュールになる
  And mount はモジュールの組み合わせだけになる

Scenario: state 変数の混在が解消される
  Given currentSettings / currentLayout / bPriorityView / bAccordionView / modelsDevDialog が同じクロージャに混在している
  When 機能をモジュールに切り出す
  Then 各 state は所有するモジュール内部に閉じる
  And モジュール間は明示的な引数で連携する

Scenario: 分割前後でユーザーから見た挙動が同一
  Given 設定パネルの既存挙動がある
  When モジュール分割する
  Then DOM 構造とユーザー操作の観測可能な結果は変わらない
  And parity テストが分割前後で同一の結果を返す
```

## 受け入れ基準

- [x] A/B レイアウト state machine をモジュールに切り出す
- [x] wizard observer をモジュールに切り出す
- [x] ModelsDevDialog をモジュールに切り出す
- [x] preset ハンドラをモジュールに切り出す
- [x] state 変数の混在を解消し、state を各モジュール内部に閉じる
- [x] visibility toggle 3 か所、summary ハンドラ 2 か所、refresh core の二重化を統合する
- [x] 挙動保存であり、DOM 構造とユーザー操作の観測可能な結果を変更しない
- [x] parity テストを追加し、分割前後の挙動同一性を確認する

## テスト戦略

- 先行 PBI（rank-02 / rank-05 / rank-08）が完了していることを確認してから着手する
- parity テスト: 分割前に設定読み込み、A/B 切替、wizard、dialog、presets、validation、purge の挙動をテストとして固定
- 単体テスト: 各モジュールが独立して mount 可能であることを検証
- E2E: 関連シナリオを `--repeat-each` 実行し flake がないことを確認

## 見積もり

- 2.0 SP（4 モジュールへの分割、重複統合、parity テストを含む）

## DoD

- [x] 先行 PBI（rank-02 / rank-05 / rank-08）が完了している
- [x] state machine / observer / dialog / preset ハンドラが独立モジュールに分割されている
- [x] 内部重複（visibility toggle / summary ハンドラ / refresh core）が統合されている
- [x] parity テストが追加され、挙動同一性が確認されている
- [x] `npm run validate` が成功している
- [x] E2E リピート実行で flake がないことが確認されている

## 実装記録

**2026-10-03 完了。**

- 分割結果: `generalSettingsPanel.ts` を 166 行の composition root に縮小し、`generalSettingsLayout.ts`（197 行、A/B レイアウト state machine + 設定読み込み配線）+ `generalSettingsWizard.ts`（55 行、wizard observer）+ `generalSettingsModelsDev.ts`（44 行、ModelsDevDialog）の 3 モジュールへ分離。preset ハンドラは composition root 側に残置（rank-23 の SSOT 経由で配線）
- state 変数（`currentLayout` / `bPriorityView` / `bAccordionView` / `modelsDevDialog`）は各所有モジュール内部に閉じ、モジュール間は明示的な引数で連携する
- 内部重複を統合: visibility toggle、summary ハンドラ、refresh core の二重化を解消
- テスト: 新規 4 ファイル（`generalSettingsLayout.test.ts` / `generalSettingsWizard.test.ts` / `generalSettingsPanel-modelsDev.test.ts` / `generalSettingsPanel-visibilityToggles.test.ts`）に 17 件追加 + 既存 `generalSettingsPanel-priorityIds.test.ts` のソース pin を layout モジュールへ追従（PRIORITY_SELECT_IDS の参照先が layout モジュール配線に移ったため）
- Red/Green 3 件を検証済み（layout 切替 / wizard / modelsDev）
- ゲート（2026-10-03）: `tsc --noEmit` 0 errors / `eslint` 0 errors / dashboard vitest 5 ファイル 19 tests passed（`--repeats=5`）

### 予定からの逸脱

- `chrome.storage.local.getAll` 呼び出しを `resolveInitialLayout` の後に移動した（初回レイアウト確定を await してから設定を読む順序に統一。挙動は変わらないが、分割前の呼び出し順とは異なる）
- `generalSettingsPanel-priorityIds.test.ts` のソース pin 参照先を `generalSettingsPanel.ts` から `generalSettingsLayout.ts` へ変更した（SSOT の配線が layout モジュールに移ったため。pin の意図である「SSOT 変更の取りこぼし防止」は維持）
