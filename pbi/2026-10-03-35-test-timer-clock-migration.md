# PBI: 残存 vi.useFakeTimers() の useTimerClock() 移行

## ユーザーストーリー

テストの保守者として、生の `vi.useFakeTimers()` を使う残り ~8 ファイルを `useTimerClock()`（または理由を文書化した fake timers）へ移行したい。デフォルトの fakeTimers は `queueMicrotask` もフェイクになり動的 import をハングさせるため、AGENTS.md の待機ポリシーに沿った制御されたタイマー差し替えに統一したいからだ。

## 優先度

- 種別: test
- 順位: 20 / 20
- RICEスコア: 1.8（Reach=4 / Impact=0.5 / Confidence=0.9 / Effort=1.0）
- 根拠: `no-greedy-fake-timers` は warn レベルで本移行が「別回移行」として先送りされた残課題。対象は ~8 ファイルと限定的。
- 依存: rank-19 logger factory の後。同移行が広範なテストファイルに触るため競合回避の観点で後続とする。

## 背景

- 生 `vi.useFakeTimers()`（オプション指定なし）が ~8 ファイルに残存:
  - `testDir/dashboardGateway-transport.test.ts:53`
  - `testDir/withRuntimeTimeout.test.ts:5`
  - `testDir/regenerateSummaryGateway.test.ts` ほか
- `no-greedy-fake-timers` ルールは warn レベルで稼働中。本移行完了後、error レベルへの昇格候補とする。
- 修正方針: `useTimerClock()`（`testDir/waitPolicy.ts`）への移行を原則とし、テストが本来タイミング計測を目的とする等の正当理由がある場合は理由をコメントで文書化して fake timers を維持する。

## BDD受け入れシナリオ

```gherkin
Scenario: 生 fakeTimers を useTimerClock に置き換えてもテストが通る
  Given ~8 ファイルがオプションなし vi.useFakeTimers() を呼んでいる
  When useTimerClock() へ移行する
  Then 対象テストが queueMicrotask ハングなしに成功する
  And no-greedy-fake-timers の warn が対象ファイルで消える

Scenario: 移行しない場合は理由を文書化する
  Given あるテストがタイミング計測を目的とする
  When fake timers を維持する判断をする
  Then その理由が当該行にコメントとして文書化されている
  And レポートに例外の理由が記録される
```

## 受け入れ基準

- [ ] 残存 ~8 ファイルの生 `vi.useFakeTimers()` が `useTimerClock()` に移行されている。
- [ ] 移行しない例外がある場合、当該箇所に理由のコメント文書化とレポート記載がある。
- [ ] 対象テストがハング・実時間待ち追加なしに成功する。
- [ ] `npm run validate` が成功している。
- [ ] `no-greedy-fake-timers` の warn 対象が 0 になり、error レベル昇格の候補として記録されている。
- [ ] rank-19 との統合順序（rank-19 が先行）が守られている。

## テスト戦略

### 単体テスト

- 移行対象テストを `--repeats=20` で回し、全 run が通ることを確認する。
- `useTimerClock()` 経由で production タイマーが駆動され、実時間を待たないことを確認する。

### 統合テスト

- `npm run validate` をゲートとする。
- `grep -rn "vi.useFakeTimers" testDir/ src/ --include="*.ts"` で残存箇所を列挙し、移行対象を確定する。

## 見積もり

**1.0 SP**

~8 ファイルのタイマー差し替え。gateway 系テストの非同期構造理解が前提。

## Definition of Done

- [ ] 対象 ~8 ファイルの移行が完了している。
- [ ] 例外の理由文書化（該当時）が済んでいる。
- [ ] `npm run validate` が成功している。
- [ ] repeats 検証が通っている。
- [ ] error レベル昇格の候補記録がされている。
- [ ] rank-19 との統合順序が確定している。
