# PBI 01: models-dev-dialog の二重 Esc 解消と keydown leak 除去、dead HTML twin 削除

## ユーザーストーリー

models.dev ダイアログを使う利用者・開発者として、Esc でダイアログが確実に一度だけ閉じ、dialog を開くたびに document listener が蓄積しない状態を望む。なぜなら現状 Esc が 2 系統（focusTrap closeCallback + document keydown）で hide() を二重発火し、document keydown listener は instance 毎の guard で attach されたまま永遠に除去されないから。

## 優先度

- 順位: 01 / 7
- RICE スコア: 18.0（Reach=2 / Impact=1 / Confidence=90% / Effort=0.1 人週）
- 根拠（2026-09-11 round 7 直接検証）:
  - `models-dev-dialog.ts:70` — `focusTrapManager.trap(dialog, () => this.hide())` が Esc を処理
  - `:258-262` — `document.addEventListener('keydown', ... Escape → this.hide())` が重複
  - keydown listener は `attachEventListeners`（:206-214）の `eventListenersAttached`（instance フィールド）guard で attach され、remove される経路が無い
  - `entrypoints/options/models-dev-dialog.html`（13 行 stub・dashboard 全体を読む・未参照）と `src/dashboard/models-dev-dialog.html`（78 行の静的コピー・TS class は自前 DOM 構築のため未使用・非 module script）の twin が drift 済み（searchPlaceholder vs providerSearchPlaceholder ほか 5 件）

## BDD 受け入れシナリオ

```gherkin
Scenario: Esc で hide が 1 回だけ呼ばれる
  Given dialog が開いている
  When Escape キーが押される
  Then hide は 1 回だけ呼ばれ、onCancel は 1 回だけ発火する

Scenario: dialog を複数回開いても document listener が蓄積しない
  Given ModelsDevDialog instance を 3 回生成して open/close する
  When document の keydown listener 数を数える
  Then 0 である（focusTrap のみが Esc を処理）
```

## 受け入れ基準

- [x] 手動 document keydown Esc listener を削除（focusTrap closeCallback に一本化）
- [x] `hide()` を idempotent 化（既に hidden なら no-op）
- [x] `entrypoints/options/models-dev-dialog.html` と `src/dashboard/models-dev-dialog.html` の削除（未参照を grep で確認済み）
- [x] 関連テスト green

## テスト戦略

単体: Esc 二重発火防止・listener 数。回帰: dashboard-built-in-ai e2e。

## 見積もり

S（0.1 人週）。種別: fix。

## 実装メモ（2026-09-11 round 7）

- 手動 document keydown Esc listener を削除（focusTrap closeCallback に一本化）+ `hide()` を idempotent 化（trapId null check で二重発火を構造的に遮断）。
- **追加発見**: 静的 HTML twin は TS 実装が満たしていなかった a11y 仕様（aria-live ×2 / aria-busy / aria-required）を持っていた — twin を「a11y spec」として扱い、TS 実装を twin 水準に合わせてから twin 2 件（entrypoints/options/models-dev-dialog.html の orphan entrypoint + src/dashboard/models-dev-dialog.html の静的コピー）を削除し、a11y テストを TS 構築 DOM に向け直し（実装メモ: 旧テストは drift した静的コピーへの文字列一致で false assurance だった）。build 確認済み（models-dev-dialog.css は options/index.html から読まれ続ける）。
- 新規テスト: a11y テストを shipped DOM 対応に全面書き換え（13 tests・Esc 二重発火防止 pin 含む）。
