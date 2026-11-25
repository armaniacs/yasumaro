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
| 01 | [2026-11-26-01-fix-encrypted-backup-restore-chunked.md](2026-11-26-01-fix-encrypted-backup-restore-chunked.md) | 🔧非機能追加 | 14.4 | 8 | ⬜ |
| 02 | [2026-11-26-02-fix-encrypted-backup-split-gate-parity.md](2026-11-26-02-fix-encrypted-backup-split-gate-parity.md) | 🔧非機能追加 | 5.0 | 3 | ⬜ |
| 03 | [2026-11-26-03-doc-encrypted-backup-guide-split.md](2026-11-26-03-doc-encrypted-backup-guide-split.md) | 🔧非機能追加 (docs) | 4.0 | 1 | ⬜ |

## 再発防止の運用メモ (なぜなぜ分析 3 より)

- ユーザーに見える挙動 (操作フロー・上限) が変わる PBI では、DoD に
  「docs 更新の要否判定」を明記する (本ラウンドの 3 件は記録済み)
- 大きさの制約を跨ぐ変更では、end-to-end の大きさ制約を pin する試験を
  併設する (単層の cap 試験だけでは non-surface な不一致が残る)
