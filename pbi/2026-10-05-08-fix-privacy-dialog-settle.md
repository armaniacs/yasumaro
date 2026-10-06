# PBI: privacyDialog の settle 不能経路で attemptInFlight が永久 true（自動保存が無言停止）

## ユーザーストーリー

自動保存の利用者として、プライバシー確認ダイアログの Promise を必ず settle させたい。host がページ側 DOM 操作で剥がれるとどの経路も settle せず、そのページ表示の間ずっと自動保存が無言で停止するから。

## 優先度

- 順位: 8/32
- RICE: 7.2（R3 / I3 / C0.8 / E1）
- 根拠: resolve 経路が 3 つしかなく、host 剥離時の監視が無い。呼び出し側の finally が走らない
- 依存: なし

## 背景（file:line 現状）

- `src/content/privacyDialog.ts:12-13` の Promise、`:111-114` の cleanup は `host.remove()` + `resolve(result)` のみ（host 落ちの監視なし）、`:116-120` の resolve 経路は save / cancel click と overlay click の 3 つ、`:122` の `document.body.appendChild(host)`、`:123` の focus
- `src/content/visitReporter.ts:154-162`: `report()` が `if (this.attemptInFlight) return;` → `attemptInFlight = true` → `try/finally` で解除。`:206-209` の `await confirm(...)` が settle しないと finally が走らず `attemptInFlight` が恒 true になり、以降の `reportValidVisit()` は即 return し続ける
- Escape も focus trap も無い。対照として popup 側は `src/popup/privatePageDialog.ts:41-46` と `src/popup/privacyConsentController.ts:104-105` が focusTrapManager を通す

## BDD受け入れシナリオ

```gherkin
Scenario: host が剥がれても Promise が settle する
  Given プライバシー確認ダイアログの表示中に host が DOM から除去される
  When 除去を検知する
  Then cleanup(false) で Promise が settle し、呼び出し側の finally が走る

Scenario: 通常のボタン操作は従来どおり
  Given ダイアログ表示中に save / cancel / overlay のいずれかを操作する
  When 操作する
  Then 従来どおり true / false で settle し、二重 settle は起きない

Scenario: settle 後に次の report が通る
  Given 1 回の report が完了（成功・失敗・剥離のいずれか）した
  When 次の report() が呼ばれる
  Then attemptInFlight が false に戻っており、処理が進む
```

## 受け入れ基準

- [x] settle を 1 回だけ通す `settle` ヘルパがあり、host の存在監視（`document.body.contains(host)` チェックまたは MutationObserver）で host 脱落時に `cleanup(false)` が呼ばれる
- [x] 既存の 3 つの click リスナー（`:116-120`）は同じ `cleanup` を呼ぶままで変更不要
- [x] 呼び出し側 `visitReporter.ts:154-162` の try/finally はそのまま（settle されれば finally が走る）
- [x] focus trap は content では必須要件にならないため後続に回し、本 PBI のスコープ外と明記する
- [x] 実時間待ちを使わないテストで検証する
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: host 除去時に `cleanup(false)` で settle すること、二重 settle しないこと
- 単体: settle 後に `attemptInFlight` が戻ること
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/content/privacyDialog.ts`（settled ガード付き単発 cleanup + host 脱落検知の MutationObserver。settle 時に disconnect）、新規 `src/content/__tests__/privacyDialog.test.ts`（host 外部除去で false settle + finally 実行、二重 settle 防止、従来動作の維持。`waitForMock` / `drainMacrotask` のみ）
- ゲート: 対象 5 tests green / type-check PASS / lint 0 errors
