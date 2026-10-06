# PBI: customPrompt 一覧と trustSettings 動的行の配線を region スコープに寄せる

## ユーザーストーリー

設定 UI の保守担当者として、一覧行の配線所有を集約したい。描画後に `document` 直結で拾い直し、追跡なしで付けるため、多重マウント・再描画時の誤配線・解除漏れの温床になるから。

## 優先度

- 順位: 19/23
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: 描画 HTML は不変。destroy 契約は変えない
- 依存: NN16（同一ファイル群の render 整理後。併せると効果が上がるが独立適用可）

## 背景（file:line 現状）

- `src/dashboard/settings/customPromptManager.ts:106-173`（renderPromptList。`:127` で一括描画後、`:130-140` / `:143-151` / `:154-172` の 3 ループで直結＋addEventListener）
- `:578-594`（init は保存/取消 2 件のみ配線）、`:605-610`（destroy は同 2 件のみ解除し一覧行に触れない）
- `src/dashboard/settings/trustSettings.ts:115-123`（共通 `listen` ヘルパーあり）対 `:200-202,260-266,647-653,655-662`（動的行の直結は teardown 未登録）
- 対照: `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:505-507`（`queryById(root,id)`）、`:649-721`（region スコープで描画＋配線を一括）

## BDD受け入れシナリオ

```gherkin
Scenario: 一覧配線が region スコープになる
  Given 一覧の再描画時
  When 配線する
  Then promptList の querySelectorAll スコープまたは data-action 委譲になり、誤配線・解除漏れが起きない
```

## 受け入れ基準

- [x] 一覧配線が region スコープ（querySelectorAll または data-action 委譲）に寄っている
- [x] 描画 HTML（`:181-262`）は不変
- [x] destroy 契約は変えず、追跡対象を一覧 region の一括クリアに合わせている
- [x] trustSettings 側の動的行が `listen` 経由またはコンテナ委譲に寄っている（既存 destroy 範囲は広げない）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 customPrompt / trustSettings テストが green
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `customPromptManager.ts`（wirePromptListButtons に集約。preset-backed 行の二重配線も解消）、`trustSettings.ts`（コンテナ委譲。jpAnchor/sensitive は NN16 済みのため不変）
- ゲート: colocated 7 ファイル 220 tests green / type-check PASS / lint 0 errors
