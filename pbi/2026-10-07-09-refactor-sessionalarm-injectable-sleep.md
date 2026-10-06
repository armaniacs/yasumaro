# PBI: SessionAlarmService のリトライ待ちを注入可能にする

## ユーザーストーリー

セッションアラームの保守担当者として、VULN-017 リトライ経路が fake clock で駆動できてほしい。生 setTimeout が注入不可で、リトライ経路がモジュール唯一の未テストパスになっているから。

## 優先度

- 順位: 9/17
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: AGENTS.md の注入可能 promise（「must be injectable (SleepFn, StepDelayFn, a sleep option)」）との乖離。モジュール自身のテスト容易性宣言とも矛盾
- 依存: なし

## 背景（file:line 現状）

- 生待ち: `src/background/SessionAlarmService.ts:169` — `await new Promise((resolve) => setTimeout(resolve, LOCK_NOTIFICATION_RETRY_DELAY_MS))`（100ms × 最大 3 リトライ）
- canonical seam: `src/background/pipeline/stepExecutor.ts:19-22` の `StepDelayFn`（「Injectable clock seam for the retry backoff」）
- モジュール doc は注入を宣言: `SessionAlarmService.ts:4-6`（AlarmPort / Clock / StoragePort を注入）
- テストの隙間: `src/background/__tests__/SessionAlarmService.test.ts` に SESSION_LOCK_REQUEST ケースなし（リトライ経路が未テスト）

## BDD受け入れシナリオ

```gherkin
Scenario: リトライ経路が fake clock で駆動できる
  Given 注入可能な delay を受けた SessionAlarmService
  When SESSION_LOCK_REQUEST が 2 回失敗して 3 回目に成功する
  Then 3-attempt ceiling まで fake clock で駆動され実時間を待たない

Scenario: 本番の既定 delay は不変
  Given delay を注入しない場合
  When lock 通知のリトライが発生する
  Then LOCK_NOTIFICATION_RETRY_DELAY_MS（100ms）が既定として使われる
```

## 受け入れ基準

- [ ] constructor に注入可能 delay（既定 = 実 timer）を追加（StepDelayFn 流儀）
- [ ] 生 setTimeout のリトライ待ちを注入 seam 経由に置き換える
- [ ] SESSION_LOCK_REQUEST のリトライ経路テストを追加（3-attempt ceiling を fake clock で assert）
- [ ] 既存テストが green のまま（挙動不変）
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/background/__tests__/SessionAlarmService.test.ts` にリトライケース追加、`useTimerClock()` または注入 fake で駆動
- 実時間待ちは使わない（AGENTS.md 実時間待ちの禁止）

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
