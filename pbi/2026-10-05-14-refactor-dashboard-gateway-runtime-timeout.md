# PBI: `dashboardGateway` だけ共有 `withRuntimeTimeout` を使わず手書き race でタイマー漏れと未処理リジェクションを生む

## ユーザーストーリー

メッセージング層の保守担当者として、`dashboardGateway` を共有 seam に載せたい。「runtime.sendMessage とタイマーの race＋cleanup＋安全な reject 所有」を肩にする seam が既にあるのに、ここだけが手書きで同じ 2 つの欠陥を再発させているから。

## 優先度

- 順位: 15/32
- RICE: 4.0（R4 / I1 / C1.0 / E1）
- 根拠: 共有 seam が実在し、良い利用例が 2 つある。置換は機械的
- 依存: なし

## 背景（file:line 現状）

- 共有 seam `src/messaging/withRuntimeTimeout.ts:14-36`: `:21` で handled 追跡、`:31-35` の finally で timer clear。コメントが「timeout 後の rejection の未処理化」と「timer 残留」を防ぐ意図を明示
- 良い利用例: `src/messaging/pendingRecordGateway.ts:59-73`、`src/messaging/regenerateSummaryGateway.ts:35-48`
- 違反 `src/messaging/dashboardGateway.ts:60-70`: 素の `Promise.race` + `setTimeout` が cleanup なし、op 未 handled → (a) タイマーが常に 10 秒残る (b) timeout が先に reject した後に送信 promise が reject すると**未処理リジェクション**になる
- 既存の try/catch は `callDashboard` の `:153-165` にある

## BDD受け入れシナリオ

```gherkin
Scenario: タイムアウト後にタイマーが残らない
  Given ダッシュボード送信がタイムアウトする
  When sendDashboardRaw が withRuntimeTimeout 経由で実行される
  Then timer が clear され、10 秒の残留が起きない

Scenario: タイムアウト後の送信失敗が未処理にならない
  Given timeout が先に reject した後に送信 promise が reject する
  When 実行する
  Then 未処理リジェクションにならず、handled として所有される

Scenario: 挙動が不変である
  Given 正常系・タイムアウト系の既存入力
  When 実行する
  Then タイムアウト値（10秒）・retries:0・エラー文言が従来と同一である
```

## 受け入れ基準

- [x] `sendDashboardRaw` が `withRuntimeTimeout` に載っている
- [x] 挙動（10秒、retries:0、エラー文言）が不変である
- [x] 既存の try/catch は `callDashboard` の `:153-165` にそのまま残る
- [x] タイマー残留と未処理リジェクションの回帰テストがある
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: タイムアウト時の timer clear と handled 所有のテスト（fake timer または注入時計。実時間待ちは使わない）
- 既存テストが green

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/messaging/dashboardGateway.ts`（seam への置換）、`src/messaging/__tests__/dashboardGateway-transport.test.ts`（回帰 2 件追加。fake timer のみ）
- ゲート: 対象 4 ファイル 34 tests green / type-check PASS / lint 0 errors
