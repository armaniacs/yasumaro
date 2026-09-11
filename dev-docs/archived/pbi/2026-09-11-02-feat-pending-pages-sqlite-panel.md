# PBI 02: 【PBI-P】pending pages セクションを SQLite 履歴パネルへ移設し Export ボタンの新居を決める

## ユーザーストーリー

プライベートページの記録を管理する利用者として、SQLite 履歴パネルだけで pending pages の閲覧・記録・削除が完結し、ページを開き直すことなくライブ更新が反映されてほしい。なぜなら pending UI が legacy panel-history にしか存在せず、legacy 撤去（PBI 16）の前に機能の新しい居場所が必要だから。

## 優先度

- 順位: 02 / 10
- RICE スコア: 16.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.3 人週）
- 根拠（2026-09-11 round 5 診断で全量スコープ確定）: pending セクションは `historyPendingPanel.ts`（298 行）のみに存在し、sqlite パネル（`panels/asyncData/sqlite*`）には pending/onChanged 相关コードがゼロ。`chrome.storage.onChanged` 購読も `historyPanel.ts:106-136` のみ。Record 契約は `MANUAL_RECORD` + `skipAi` の 1 タイプ（専用タイプ無し）。i18n キーは ja/en 既存（新規キー不要・check-i18n で確認済み）。whitelist 操作は popup 専属のため本 PBI のスコープ外。

## BDD 受け入れシナリオ

```gherkin
Scenario: SQLite パネルで pending pages を閲覧・記録できる
  Given pending_pages に 2 件のページがある
  When SQLite 履歴パネルを開く
  Then pending セクションに 2 件が表示される
  When 「記録」を押す
  Then MANUAL_RECORD（content:'', force:true, skipAi はボタン毎）が送信され
  And その行は一覧から消える

Scenario: pending pages のライブ更新が反映される
  Given SQLite 履歴パネルを開いている
  When background が pending_pages を更新する
  Then chrome.storage.onChanged 経由でセクションが再描画される
  And パネル破棄時に購読が解除される

Scenario: Export all as Markdown が新しい居場所で動く
  Given legacy セクションの export ボタンが移設されている
  When Export Logs パネルでボタンを押す
  Then handleHistoryExportLocalMarkdown が実行される（dashboard.ts:88 の wiring は新居を指す）
```

## 受け入れ基準

- [x] `sqliteHistoryPanelView.ts` に pending セクション（一覧 + Record / Record without AI / Delete forever + ページング）を新設、`SQLITE_HISTORY_IDS` に id 追加
- [x] `sqliteHistoryPanel.ts` に panel-local pending 状態（`getPendingPages` 読み込み、`pending_pages` の onChanged 購読、`destroy()` での解除 — `historyPanel.ts:176-180` と同一後始末）
- [x] Record は `MANUAL_RECORD` + `sendMessageWithTimeout` 相当（20s timeout + PING フォールバック、`historyUtils.ts:36-56` のセマンティクス）を inline 化
- [x] Export ボタンを Export Logs パネルへ移設し `dashboard.ts:88` の wiring を再指す（`localMarkdownExport.ts` 無変更・既存テスト green 維持）
- [x] 新規 i18n キーは追加しない（既存キー再利用・check-i18n PASS）
- [x] 新規テスト: セクション描画 / record 成功で行削除 / onChanged 再描画 / destroy 解除
- [x] legacy 側は無変更（PBI 16 が削除を担う）

## テスト戦略

新規単体テスト（fake storage + fake sendMessage）。既存 sqlite パネルテスト・dashboard-handlers の export テスト green。

## 見積もり

M（0.3 人週）。種別: feat（機能移設・parity 回復）。

## 実装アプローチ

1. view に pending セクション + ids、panel に状態/購読/destroy、record アクション
2. export ボタン移設 + wiring 再指定
3. テスト + check-i18n

## 実装メモ（2026-09-11 round 5）

- View に `renderPendingRegion`（region-scoped render entry・PBI 23 の region パターンに準拠）+ `SQLITE_HISTORY_IDS.pendingRegion` + 1 ページ 10 件 + `pendingMoreCount` キー（ja/en 新規）を追加。
- Panel に panel-local pending 状態（model 状態と分離）+ `chrome.storage.onChanged`（pending_pages）購読 + destroy で解除。record は `MANUAL_RECORD` + 20s timeout（`recordRequestTimedOut` キー新設）+ 成功で removePendingPages → 再読込。delete も同経路。
- Export all as Markdown ボタンを Export Logs パネルへ移設（新 id `historyExportAllMarkdownBtn`/`historyExportAllMarkdownStatus`・`handleHistoryExportLocalMarkdown` の target ids を更新・dashboard.ts wiring 更新）。legacy セクション内の旧ボタンは PBI 09 で削除。
- 新規テスト `sqliteHistoryPanel-pending.test.ts` 7 件（描画/record/skipAi/delete/onChanged/destroy 解除/行内エラー）。
