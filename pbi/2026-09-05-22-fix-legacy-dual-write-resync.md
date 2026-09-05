# PBI: LEGACY_DUAL_WRITE 再有効化時の SQLite→レガシー再同期を実装

## ユーザーストーリー
拡張機能の運用者として、LEGACY_DUAL_WRITE を false 運用後に true へ戻したときにレガシー側へ自動再同期してほしい、なぜなら無効期間中にSQLiteだけに蓄積された記録がレガシー参照経路（旧UI・移行前機能）から見えず、欠損に見えるから

## 優先度
- 順位: 17 / 26
- RICEスコア: 600（Reach=1000 / Impact=2 / Confidence=0.6 / Effort=2.0日）
- 根拠: データ欠損に見える互換性不具合でImpact=2。ただし再有効化自体が稀な操作のためConfidence=0.6。再同期の設計・冪等性・進捗管理が必要でEffort=2.0。

## BDD受け入れシナリオ
```gherkin
Scenario: 無効期間中の記録が再有効化でレガシーに復元される
  Given LEGACY_DUAL_WRITE=false で N 件記録し、その後 true に戻した状態
  When  再同期ジョブが実行される
  Then  無効期間中の N 件が savedUrlsWithTimestamps 側に存在する

Scenario: 再同期の再実行が安全である
  Given 再同期が1回完了した状態
  When  再同期をもう一度実行する
  Then  重複エントリが発生せず、件数・内容が変わらない（冪等）

Scenario: 再同期中の新規記録が失われない
  Given 再同期の実行中に新規記録が発生する状態
  When  両方の書き込みが完了する
  Then  新規記録もレガシー側に存在し、競合で上書き消失しない
```

## 受け入れ基準
- [ ] false期間中のSQLite蓄積分が `savedUrlsWithTimestamps` へ復元される
- [ ] 再同期が冪等である（2回実行で差分なし）
- [ ] 再同期中の新規記録と競合しない（`pendingChromeStorageQueue` の metadataPatch 経路と整合）
- [ ] 再同期の進捗・失敗がログ/診断パネル等で確認できる
- [ ] 既存の dual-write テスト（`saveMetadataStep.test.ts` の enabled/disabled 系）がパスする

## テスト戦略
- 単体: 無効期間分の差分抽出（SQLite→レガシー差分）とマージの冪等テスト
- 統合: false→記録→true→再同期の一連フローで `savedUrlsWithTimestamps` の復元を検証
- 回帰: `saveMetadataStep.test.ts`（`LEGACY_DUAL_WRITE_ENABLED: false` 系）＋移行系スイート

## 実装アプローチ
`saveMetadataStep` の early-return（無効時はレガシー書き込みを捨てる）を前提に、再有効化時の差分再同期ジョブを新設する。SQLiteを正として無効期間中の差分を抽出し、`saveSavedUrlEntryMetadata` と同じ `toMetadataPatch` 経路でレガシー側へ追記する。既存の `pendingChromeStorageQueue`（metadataPatch リトライ）・`backfillMetadata`（診断パネルの補完ボタン）との重なりを整理し、どちらに寄せるかを実装時に決定する。差分範囲の特定方法（タイムスタンプ境界 vs 全件比較）は Effort 内の設計事項。

## 見積もり
5ポイント（2.0日相当：差分設計＋再同期ジョブ＋冪等/競合テストが中心）

## 技術的考慮事項
- 互換性に関わる設計変更のため、メジャーバージョンアップまたはリリースノートでの明記が必要（backlog #17・#18 の依存関係節の指定どおり）。特に再同期の自動/手動・実行タイミング（設定変更検知で自動起動か、診断パネルの手動ボタンか）はユーザー可視の挙動であり、決定内容をリリースノートに記載する
- ADR `2026-07-07-sqlite-chrome-storage-dual-write.md`（終了条件フラグの導入経緯）と ADR `2026-07-27-legacy-dual-write-savedurls-dependency-audit.md`（デフォルト false 化の見送り）の2件に影響する。再同期方針の決定内容をいずれかへ追記する
- 既存の片方向 backfill（chrome.storage→SQLite の `backfillMetadata`）とは逆方向の新規ジョブである点に注意。両者を1つの双方向同期と誤って統合しないこと

## 実装者向け注記
- 確認済み現状: `src/background/pipeline/steps/saveMetadataStep.ts:22-26` が `LEGACY_DUAL_WRITE_ENABLED !== false` で early-return し、無効期間中のレガシー書き込みは捨てられる（キューイングなし）。再有効化時の再同期処理は存在しないことを確認: `rg -ni "resync|re-sync" src/background/pipeline/ src/utils/storage/ src/background/migration/` で該当なし
- フラグ定義: `rg -n "LEGACY_DUAL_WRITE" src/utils/storage/types.ts src/utils/storage/defaults.ts` — `types.ts:271,474`（キー定義）・`defaults.ts:173`（デフォルト `true`）
- 設計文書: `rg -n "LEGACY_DUAL_WRITE" dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md dev-docs/ADR/2026-07-27-legacy-dual-write-savedurls-dependency-audit.md` — 前者が終了条件フラグの設計、後者がデフォルト false 化見送りの監査記録
- 類似機構（参考・逆方向）: `rg -n "backfillMetadata" src/dashboard/dashboardSqliteService.ts src/background/migrationService.ts` — `dashboardSqliteService.ts:296`・`migrationService.ts:52`。こちらは chrome.storage→SQLite 方向の補完であり、本PBI（SQLite→レガシー）とは逆。流用ではなく対称設計として参照すること
- リトライキュー: `rg -n "metadataPatch" src/background/pendingChromeStorageQueue.ts src/background/pipeline/steps/saveMetadataStep.ts` — 書き込み失敗時の退避経路。再同期ジョブとの二重書き込み競合に注意
- スコープ補正: backlog表題は「再同期を実装」だが、トリガー方式（設定変更の自動検知 vs 診断パネルの手動実行）が未定。自動・手動のいずれかに決めることを本PBIの受け入れに含め、両方作ることはしない

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（ADR追記＋リリースノート明記）

## 実装メモ（2026-09-05、ブランチ 0905c）

### トリガー方式の決定: MANUAL-ONLY

PBI 本文で未定だった自動/手動を **手動のみ** に決定。理由: (1) アップグレード時に自動でレガシーストレージへ書き戻すのはリスクが高い（dual-write フラグは現在デフォルト OFF 運用）。(2) 再有効化自体が稀な明示的操作であり、診断パネルの明示ボタンが実行タイミングを利用者に可視化できる。起動時・設定変更検知の自動実行は一切行わない。

### 実装内容

- 新規 `src/background/migration/legacyResync.ts`: `resyncLegacyFromSqlite(sqliteClient, { maxRecords })`（既定 1000 件・上限 5000 件・`created_at` DESC）。`mapSqliteRecordToLegacyPatch` は `mapLegacyEntryToRecord` の完全な逆写像（`backfillMetadata` とは逆方向・統合なし）。タグ列は `a, b` 形式と `#a #b` 形式の両方を解釈。`recordType`・`aiSummaryCleansedElements/Reason(s)` は SQLite 側に列がなく復元不能のため省略（発明しない）。`maskedCount` は `toMetadataPatch` 同様に正値のみ格納。`cleansedReason` はレガシー側の narrow union に一致するリテラルのみ復元。
- 冪等性: URL キーで `saveSavedUrlEntryMetadata`（`refreshTimestamp: false`・`timestamp: created_at`・`mergeTags: true`）にマージするため、再実行で重複もタイムスタンプ変動もなし。
- 競合安全性: 同じ `withOptimisticLock` CAS 規律（`storageFallback.mutate` の前例と同一）のため、再同期中の新規記録と直列化され消失なし。
- フラグ非参照: 関数は `LEGACY_DUAL_WRITE` を読まない。明示トリガーがゲートであり、`saveMetadataStep` の無効時 early-return（既定動作）は不変。
- 配線: `MigrationService.resyncLegacyStore()` ファサード＋ `resync_legacy` サブタイプを診断パネルまで end-to-end（`sqliteOperationSecurity` では token-required のまま＝confirmToken ハンドシェイク必須）。診断パネルに「Resync legacy history from SQLite」ボタン（`diagResyncBtn`、日英 i18n 追加、非破壊・冪等マージのため確認ダイアログなし）。進捗・失敗は `addLog`（LegacyResync: starting/completed）＋ボタン結果表示（`written/examined skipped total`）で確認可能。
- テスト: `legacyResync.test.ts` 新規 12 件（復元・冪等・上限・上限クランプ・フラグ OFF でも実行・並行記録の非消失・URL 欠損スキップ・クエリ失敗送出・マッピング 4 件）＋ハンドラ/サービス/UI/検証の wiring テスト。全 11658 件パス、`type-check`・`lint`（0 errors）クリア。
