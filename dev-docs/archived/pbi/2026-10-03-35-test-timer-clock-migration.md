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

- [x] 残存 ~8 ファイルの生 `vi.useFakeTimers()` が `useTimerClock()` に移行されている。
- [x] 移行しない例外がある場合、当該箇所に理由のコメント文書化とレポート記載がある。
- [x] 対象テストがハング・実時間待ち追加なしに成功する。
- [x] `npm run validate` が成功している。
- [x] `no-greedy-fake-timers` の warn 対象が 0 になり、error レベル昇格の候補として記録されている。
- [x] rank-19 との統合順序（rank-19 が先行）が守られている。

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

- [x] 対象 ~8 ファイルの移行が完了している。
- [x] 例外の理由文書化（該当時）が済んでいる。
- [x] `npm run validate` が成功している。
- [x] repeats 検証が通っている。
- [x] error レベル昇格の候補記録がされている。
- [x] rank-19 との統合順序が確定している。

## 実装記録（2026-10-03 統合）

### 範囲拡大の記録

- 起票時の見積もり対象は ~8 ファイルだったが、grep 実測で生 `vi.useFakeTimers()`（オプション指定なし）は 58 ファイル / 119 箇所に及んだ。受け入れ基準が no-greedy-fake-timers の warn 0 であるため、部分的な移行では基準を満たさないとして全 119 箇所の移行に範囲を拡大して完結させた。

### 実装内容

- 58 テストファイル / 119 箇所を `useTimerClock()`（`testDir/waitPolicy.ts`）への機械的置換で移行。import 追加 + 呼び出し置換のみで、モック・アサーションの意味論変更はなし。
- 実時間待ち（`await new Promise(r => setTimeout(...))` 等）の追加は 0 件。
- 移行しない例外（理由コメント付き fake timers 維持）は 0 件。残存する `vi.useFakeTimers` 文字列は docblock（`testDir/waitPolicy.ts:14`）とルールテストの fixture 文字列のみ。`src/utils/storage/storageTransaction.ts:9` の docblock 言及は呼び出し箇所ではないため範囲外。

### 検証（統合ゲート実測）

- `npx tsc --noEmit` 0 errors / `npm run lint` 0 errors・0 warnings（no-greedy-fake-timers 119 → 0）/ `npm test` 1024 files passed | 1 skipped・15611 tests passed | 21 skipped / `npm run validate` exit 0（type-check:test baseline 469 ≤ pin 474）。
- repeats 検証: PBI 背景で挙げられた移行対象（`testDir/dashboardGateway-transport`・`withRuntimeTimeout`・`regenerateSummaryGateway`・`settingsUiHelper`）を `--repeats=20` で 27 tests 全 run green（所要 ~1s・実時間待ちなし。production タイマーが useTimerClock 経由で駆動されている実測）。

### 後続候補

- `no-greedy-fake-timers` ルールは warn 0 到達済みのため error レベルへの昇格候補。昇格時は lint スナップショットの再取得を要する。
