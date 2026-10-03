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

- [ ] A/B レイアウト state machine をモジュールに切り出す
- [ ] wizard observer をモジュールに切り出す
- [ ] ModelsDevDialog をモジュールに切り出す
- [ ] preset ハンドラをモジュールに切り出す
- [ ] state 変数の混在を解消し、state を各モジュール内部に閉じる
- [ ] visibility toggle 3 か所、summary ハンドラ 2 か所、refresh core の二重化を統合する
- [ ] 挙動保存であり、DOM 構造とユーザー操作の観測可能な結果を変更しない
- [ ] parity テストを追加し、分割前後の挙動同一性を確認する

## テスト戦略

- 先行 PBI（rank-02 / rank-05 / rank-08）が完了していることを確認してから着手する
- parity テスト: 分割前に設定読み込み、A/B 切替、wizard、dialog、presets、validation、purge の挙動をテストとして固定
- 単体テスト: 各モジュールが独立して mount 可能であることを検証
- E2E: 関連シナリオを `--repeat-each` 実行し flake がないことを確認

## 見積もり

- 2.0 SP（4 モジュールへの分割、重複統合、parity テストを含む）

## DoD

- [ ] 先行 PBI（rank-02 / rank-05 / rank-08）が完了している
- [ ] state machine / observer / dialog / preset ハンドラが独立モジュールに分割されている
- [ ] 内部重複（visibility toggle / summary ハンドラ / refresh core）が統合されている
- [ ] parity テストが追加され、挙動同一性が確認されている
- [ ] `npm run validate` が成功している
- [ ] E2E リピート実行で flake がないことが確認されている
