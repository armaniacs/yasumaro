# PBI: logCritical から通知 seam を分離（CriticalAlertSink adapter）

**作成日**: 2026-08-12
**調査日**: 2026-08-12
**優先度**: 🟡中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微
**種別**: 🔧非機能追加（refactor）

---

## 背景

`src/utils/logger/api.ts` の `logCritical`（218行）は「記録 + 即時 flush + console.error
+ chrome.notifications.create + クールダウン管理」を同一 interface に抱え、通知という
別関心事が logger module に漏出している。ロギング層は「記録」に留まり、UI 通知は
別 seam として分離すべき。

graphify god node 分析の「ロギングがビジネスロジックに漏出」の一例。本 PBI は
PBI-1（core 分割）と並行して進められる。

## 調査結果：なぜなぜ分析（12回）

1. **Why 1**: なぜ logCritical から通知を分離するのか → 記録+即時flush+console+notifications+クールダウンが同一 interface にあり、通知が漏出しているため。
2. **Why 2**: なぜ通知漏出が問題か → 通知の表示ルール（i18n/アイコン/priority/requireInteraction/クールダウン）を変えたい時に logger を触る必要があり locality が損なわれる。
3. **Why 3**: なぜ logCritical は通知まで担当するのか → 重大エラー時に確実に気づかせる要件を満たすためだが、実装が logger 内部に直書きされた。
4. **Why 4**: 実利用は何箇所か → 調査で判明: 実利用は `sqliteAlert.ts:44` の 1 箇所のみ（他はテスト）。通知発火の起点は sqliteAlert であり logger は単なる実行者。
5. **Why 5**: 分離の形は「logger から通知削除、sqliteAlert が直接通知」か → それだと将来 logCritical 利用箇所が増えた時に通知忘れが起きる。
6. **Why 6**: では「logCritical は記録のみ、通知は adapter 経由で発火」か → そう。logCritical は onCriticalLog コールバック（または CriticalAlertSink adapter）を受け、記録後にそれを呼ぶ。
7. **Why 7**: コールバック注入はどこか → logger は chrome ランタイムに依存しない純粋な記録层にしたい。initializeLogger({ criticalSink }) の初期化 seam で注入、または logCritical の引数に sink を受ける。
8. **Why 8**: 引数に sink を受けると 159箇所の addLog には影響するか → しない。logCritical の呼び出し側（sqliteAlert）のみ変わるが実利用 1 箇所のみで影響小。
9. **Why 9**: 二重クールダウンにならないか → logCritical 内のクールダウンを削除し、通知のクールダウンは sink 側（sqliteAlert または CriticalAlertSink）が責任を持つ。
10. **Why 10**: テストは → 通知のテスト（クールダウン/i18n）が logger から分離され fake sink で検証可能。logCritical 自体は「記録+sink 呼び出し」のみをテスト。
11. **Why 11**: 削除テストに通るか → CriticalAlertSink を削除すると「重大エラー時のユーザー通知」複雑さが呼び出し側に再出現（集中）→ 価値あり。adapter 化は正当（real seam: 本番通知/テスト fake）。
12. **Why 12**: 結論 → logCritical は「記録+即時 flush」のみに留め、通知発火を CriticalAlertSink adapter（依存注入、デフォルトは既存通知ロジック）に分離。クールダウンは sink 側へ移動。

## 実装内容

1. 新規 `src/utils/logger/criticalAlertSink.ts` — `CriticalAlertSink` interface + `ChromeNotificationCriticalSink`（既存の notifications.create + クールダウン実装を移動）
2. `api.ts` の `logCritical` から `chrome.notifications` 発火・クールダウン管理を削除し、「記録 + flushLogs(true)」のみにする
3. `logCritical` は `CriticalAlertSink` を引数または `initializeLogger` 経由で受け取り、記録後に sink を呼ぶ
4. `sqliteAlert.ts` は `ChromeNotificationCriticalSink` を組み立てて logCritical に渡す（または composition root で initializeLogger に注入）
5. デフォルト sink（通知なし / console のみ）をテスト・非 Chrome 環境用に用意

## 受け入れ基準

- [ ] `logCritical` の外部 interface（message, details, errorCode, source）が維持されている
- [ ] `logCritical` 内部から `chrome.notifications` の直接呼び出しが削除されている
- [ ] 通知発火が `CriticalAlertSink` adapter 経由になり、sqliteAlert.ts で組み立てられている
- [ ] クールダウン管理が sink 側に移動し、logCritical には残っていない
- [ ] 既存の `logger-enhanced.test.ts` の logCritical テストが fake sink で通る
- [ ] 重大エラー時のユーザー通知動作が現状と等価（sqliteAlert の閾値・通知内容が変わらない）

## テスト戦略

- `criticalAlertSink.test.ts` で `ChromeNotificationCriticalSink` のクールダウン・i18n メッセージ生成を fake で検証
- `api.ts` の logCritical テストを「記録 + sink 呼び出し」に絞る
- sqliteAlert の統合テストで実際の通知発火パスを確認

## 非スコープ

- logger の記録機能自体の変更（PBI-1 で扱う）
- 通知の UI デザイン変更
- errorMessage() の統合（PBI-4 で扱う）
- resolveLogSource の削除（PBI-3 で扱う）
