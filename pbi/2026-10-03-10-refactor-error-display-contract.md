# PBI: popup エラー表示契約の統一（generic 固定 vs error オブジェクト派生）

## ユーザーストーリー

popup の失敗表示を見るユーザーとして、どの失敗経路でも同じ契約（generic 固定か error オブジェクト派生か）で表示されてほしい。3 つの失敗経路が異なる契約で表示され、同じ失敗でも伝わり方が揺れるから。

## 優先度

- 順位: 10/15
- RICE: 2.25（R5 / I0.5 / C0.9 / E1.0）
- 根拠: 同一失敗でも表示契約が 3 経路で発散し、内部不整合も同梱（R5）。ただし発生頻度は低く UX 悪化の程度は軽微（I0.5）。契約裁定 1 点の横展開で小さい（C0.9・E1.0）
- 依存: rank-01（popup data-loss）PBI の完了後に着手 — `src/popup/pendingPages.ts` に触るため

## 現状（証拠）

- `src/popup/statusPanel.ts:130` — `getMessageOr('errorGeneric', 'An error occurred.')` の固定 generic
- `src/popup/privatePageDialog.ts:130` — 同じ固定 generic（内部不整合: 同ファイル `:112` は `saveError: detail` の派生表示を使う）
- `src/popup/pendingPages.ts:20` — `showError(statusDiv, error)` が error オブジェクトから表示を派生（`src/popup/errorUtils.ts:231` 〜）
- 3 つの失敗経路が異なる表示契約を持つ

## BDD受け入れシナリオ

```gherkin
Scenario: 単一契約の裁定がコードで pin される
  Given popup の失敗表示契約として generic 固定または派生のいずれかが裁定される
  When 3 つの失敗経路（statusPanel / privatePageDialog / pendingPages）を確認する
  Then すべての経路が裁定後の単一契約に従い、テストで pin される

Scenario: 内部不整合が解消される
  Given privatePageDialog の保存失敗が発生する
  When ステータス表示を確認する
  Then `:112` と `:130` が同一契約に従い、同一経路内で表示形式が揺れない
```

## 受け入れ基準

- [ ] 表示契約（generic 固定 vs error オブジェクト派生）の裁定と rationale が実装記録に 1 行残されている
- [ ] `src/popup/statusPanel.ts:130` が裁定後の単一契約に従う
- [ ] `src/popup/privatePageDialog.ts:130` が裁定後の単一契約に従い、`:112` との内部不整合が解消されている
- [ ] `src/popup/pendingPages.ts:20`（`showError` 経路、`src/popup/errorUtils.ts:231` 〜）が裁定後の単一契約に従う
- [ ] 3 経路の契約一致を pin するテストが存在する

## テスト戦略

- 単体: 3 経路の失敗表示を同一 error 注入で確認し、契約一致を pin
- 単体: privatePageDialog の `:112` / `:130` 整合テスト
- 既存テスト green 維持 + `npm run validate` が通ること

## 見積もり

1.0 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
