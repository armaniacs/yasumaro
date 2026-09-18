# PBI: reviewSummaryAlarm デッドコードの削除（refactor）

優先度: 台帳 RICE 8.0（Reach 4 / Impact 1 / Confidence 1.0 / Effort 0.5pt）
backlog: [2026-09-18-00-backlog-holistic-0918b.md](2026-09-18-00-backlog-holistic-0918b.md)（台帳、候補 C3）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、production から到達不能な旧アラーム経路を削除してほしい、なぜなら同じアラーム名への第2の install 経路と schedule helper の複製が残っており、誤って再配線されるリスクと読む側の混乱があるから。

## 背景（現状と課題）

alarmRegistry 移行（PBI 2026-09-15-15）後、`src/background/reviewSummaryAlarm.ts`（103行）の production import はゼロである（実測: `grep -rn reviewSummaryAlarm src testDir` は自ファイルとテストのみを指す）。以下が残存する:

1. `reviewSummaryAlarm.ts` — `initializeReviewSummaryAlarms` / `setupReviewSummaryAlarmListener` が `alarmRegistry.ts` の `installReviewSummary` と同じ weekly/monthly アラームを clear/create する第2経路。`getNextMondayAt` / `getNextMonthFirstDayAt` も byte-identical で複製（reviewSummaryAlarm.ts 75-103行目付近 対 alarmRegistry.ts 102-120行目付近）
2. `src/background/__tests__/reviewSummaryAlarm.test.ts` — 死モジュール専用テスト（約133行）
3. `src/background/__tests__/service-worker.test.ts` — 防御的 mock（`mockReviewSummaryAlarm` 定義・`vi.mock`）と、`expect(mockReviewSummaryAlarm).toBeDefined()` のみを行う形骸テスト（'shares one review summary generator between the alarm and message paths'）。実 wiring は alarmRegistry.test.ts が pin 済み

削除テスト: 3ファイルを削除すると、複製された install ロジック・schedule helper・二重経路が消え、production 挙動は不変（production import が存在しないため）。

## BDD受け入れシナリオ

```gherkin
Scenario: デッドモジュール削除後も production が同一に動く
  Given reviewSummaryAlarm.ts を削除した状態
  When service worker を起動し installAll を呼ぶ
  Then review weekly/monthly アラームは alarmRegistry 経由で従来どおり作成される

Scenario: 形骸テストの除去後も generator 共有は pin され続ける
  Given service-worker.test.ts から形骸テストと mock を除去した状態
  When alarmRegistry.test.ts を実行する
  Then generator 共有の wiring は同テストにより pin され続けている
```

## 受け入れ基準

- [x] `src/background/reviewSummaryAlarm.ts` が削除されている
- [x] `src/background/__tests__/reviewSummaryAlarm.test.ts` が削除されている
- [x] `service-worker.test.ts` の `mockReviewSummaryAlarm` 定義・`vi.mock`・形骸テストが除去されている
- [x] production の import 文がどこにも壊れていない（type-check green）
- [x] `getNextMondayAt` / `getNextMonthFirstDayAt` の複製が alarmRegistry.ts の1コピーのみになる
- [x] 関連 vitest（service-worker.test.ts・alarmRegistry 系・reviewSummaryGenerator 系）が green

## テスト戦略

- 削除後、`service-worker.test.ts`・`alarmRegistry.test.ts`・`reviewSummaryGenerator*.test.ts` を実行して挙動不変を確認する
- 型検査で残留参照がないことを機械的に確認する

## 見積もり

0.5pt（3ファイル削除 + テストの mock 除去。新規コードなし）。

## 実装ガイド

- 着手時点での確認ポイント: `grep -rn "reviewSummaryAlarm"` で参照ゼロを再確認してから削除する（本 PBI 作成時に実測済みだが行番号はズレる）
- `sessionAlarmsManager.ts` は別物（compat shim として compositionManifest が使用中）— 触れないこと
- git mv による pbi アーカイブ・INDEX 編集は統合側が行う
