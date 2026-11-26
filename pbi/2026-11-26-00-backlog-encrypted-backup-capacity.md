# 台帳: 2026-11-26 暗号化バックアップ大容量対応 (3件)

## 概要

暗号化バックアップの調査 (2026-11-26) で、分割形式 (PBI 2026-11-23-01/02) の導入後も
復元ホップに隠れた実効上限 (restore_db の 10M 文字 cap ≒ DB 実体 7.5MB) が残ることを
確認した。作成できるサイズと復元できるサイズの不一致、およびユーザーガイドの
陳腐化をあわせて閉じるラウンド。

- ブランチ: fix/encrypted-backup-large-capacity
- なぜなぜ分析 30 回 x 3: 各 PBI の「技術的考慮事項」に要約を記録
  (スクラッチパッド whywhy/encrypted-backup-restore-chunked.md、
  whywhy/split-gate-parity.md、whywhy/encrypted-backup-guide-drift.md)
- 計画: dev-docs/plans/2026-11-26-pbi01-restore-chunked-transport-plan.md

## RICE 採点 (降順が実行順)

| PBI | R | I | C | RICE | 依存 | 順序 |
|---|---:|---:|---:|---:|---|---|
| 01 復元ホップ分割輸送 | 6 | 3 | 0.8 | 14.4 | なし | 1 (土台) |
| 02 作成/復元ゲート整合 | 5 | 1 | 1.0 | 5.0 | 01 と直列 (panel 文言共有) | 2 |
| 03 ユーザーガイド更新 | 8 | 0.5 | 1.0 | 4.0 | 01 完了後 (実効上限の記述が変わる) | 3 |

## 実証記録 (file:line)

- 復元呼び出しの dashboard 側起点: src/dashboard/encryptedBackupService.ts:199
- 1 発送信の restore_db: src/dashboard/dashboardSqliteService.ts:347
- ワイヤバリデータ 10M cap: src/messaging/validators.ts:624-629 (MAX_RESTORE_DB_BYTES、src/utils/limits.ts:28)
- handler 側 150MB (到達不能): src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts:204
- offscreen 単発 restore: src/offscreen/OpfsWorkerBackend.ts:303 -> src/offscreen/opfsWorker.ts:271 (RESTORE)
- archive staging 前例: archivePrepareIncoming / archive_incoming_<uuid>.db 検証 / archiveExport offset/length
- 分割結合ゲート (復元側のみ): src/dashboard/encryptedBackupSplitCodec.ts:582
- 試験の隠れ蓑: 大容量往復試験は restoreDb をモック (src/dashboard/__tests__/encryptedBackupService-backupCap.test.ts:73、encryptedBackupService.test.ts:387)
- ガイドの陳腐化箇所: docs/ENCRYPTED_BACKUP_USER_GUIDE.md:15,65,79,129

## PBI 一覧

| NN | PBI | 種別 | RICE | SP | 状態 |
|---|---|---|---:|---:|---|
| 01 | [2026-11-26-01-fix-encrypted-backup-restore-chunked.md](2026-11-26-01-fix-encrypted-backup-restore-chunked.md) | 🔧非機能追加 | 14.4 | 8 | ✅ 実装完了 (staging チャンク転送、旧 restore_db 削除) |
| 02 | [2026-11-26-02-fix-encrypted-backup-split-gate-parity.md](2026-11-26-02-fix-encrypted-backup-split-gate-parity.md) | 🔧非機能追加 | 5.0 | 3 | ✅ 実装完了 (createSplitBackup 結合長ゲート + 専用文言) |
| 03 | [2026-11-26-03-doc-encrypted-backup-guide-split.md](2026-11-26-03-doc-encrypted-backup-guide-split.md) | 🔧非機能追加 (docs) | 4.0 | 1 | ✅ 実装完了 (ガイド ja/en 分割形式対応、FAQ 同期) |

## 検証記録

- PBI 01 完了時: `npm run validate` 全緑 (19,339 件、type-check / lint / 全静的ゲート)
- PBI 02/03 完了後の最終統合: `npm run validate` 全緑 (19,346 件、check-privacy 含む全静的ゲート)
- レビューラウンド (checking-team 2026-11-26、レポート plans/2026-11-26-0757-review-fix-encrypted-backup-large-capacity.md) 後の Phase 5 修正:
  restore_commit の退避/ロールバック付き swap (SRE High)、restore_begin/commit に
  セッション全体上限 MAX_RESTORE_SESSION_BYTES (API Contract ほか 5 観点)、
  append の offset 進行検証と totalChunks 照合 (Data Integrity ほか)、
  構造化ログ (SRE)、multiple 属性追加 (UI/Docs High)

## 後続候補 (レビューで起案、未着手)

- staging レジストリ共通化: src/offscreen/opfsWorker/restoreStaging.ts が
  archiveStaging.ts のレジストリ機構 (状態 Map、名前発行、fail-closed 検証、
  sweep、テストシーム) を ~100 行複製。opfsWorker/stagingRegistry.ts に
  パラメータ化して共通化する (名前生成方式とレコード型を注入、archive 側は
  複数プレフィックス、restore 側は単一)。Maintainability 指摘
- 単発 restore 輸送の 7 層削除: dashboard 側呼び出し元消失後も残留する実装。
  削除範囲: sqliteWireTable.ts の 'restore' 行、sqliteMessages.ts の
  SQLITE_RESTORE、transportRetryPolicy.ts の対応行、payloadGuard.ts の
  SQLITE_RESTORE case (MAX_RESTORE_BYTES 100MB)、sqliteMessageHandlers.ts の
  handleRestore、recordsRepo.ts + dbMaintenance.ts、backend 実装 x3
  (OpfsWorkerBackend / IdbVfsBackend / FallbackStorageAdapter) +
  MAX_RESTORE_BYTES。System Architect 指摘
- JSON エクスポートの stringify 2 回最適化: exportJson (署名用 + 出力用) と
  importLogsService の検証用再シリアライズ。ゲート規模 (30 MiB 級) の
  peak RSS / 所要時間を bench:micro に追加し、次回上限引き上げの前提条件に
  する。Tuning Expert + Edge & Mobile 指摘

## 再発防止の運用メモ (なぜなぜ分析 3 より)

- ユーザーに見える挙動 (操作フロー・上限) が変わる PBI では、DoD に
  「docs 更新の要否判定」を明記する (本ラウンドの 3 件は記録済み)
- 大きさの制約を跨ぐ変更では、end-to-end の大きさ制約を pin する試験を
  併設する (単層の cap 試験だけでは non-surface な不一致が残る)
