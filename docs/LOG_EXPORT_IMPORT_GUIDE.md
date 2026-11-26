# ログのエクスポート・インポートガイド / Log Export & Import Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

ダッシュボードの **「ログをエクスポート」パネル** から、蓄積した閲覧履歴を複数の形式でエクスポート・インポートできます。バックアップや他の環境への移行、他ツールでの分析に使えます。（「初期設定」のローカル Markdown 書き出しは日次ファイルを自動生成する別機能で、本ガイドの上限の対象外です。）

> 本ガイドは閲覧履歴データのエクスポート/インポートについて説明します。設定（APIキー等）の移行はダッシュボードの「設定のエクスポート/インポート」機能を使用してください。API キーは設定エクスポートに含まれません。

### 上限の整理

| 項目 | 上限 |
|---|---|
| エクスポートできる件数（JSON・CSV・Markdown） | 最大 100,000 件（超えると案内が出て、`.db` エクスポート（OPFSストレージ使用時）で全件を取得） |
| インポートできるファイルの大きさ | 30 MiB まで（超えると案内が出る） |
| インポートできる行数 | 合計 100,000 行まで |

- JSON・CSV・Markdown は 100,000 件までを扱える可搬形式、`.db` エクスポート（OPFSストレージ使用時のみ）と暗号化バックアップは全件を保存する完全スナップショット、という役割分担です
- 上限値は実装の `src/utils/limits.ts`（`MAX_EXPORT_ROWS` / `MAX_IMPORT_TEXT_BYTES` / `IMPORT_TOTAL_ROW_CAP`）が源泉です

### エクスポート形式

| 形式 | ボタン | 用途 | 署名 |
|------|--------|------|------|
| JSON (.json) | 「JSON としてエクスポート」 | バックアップ・他環境への移行（再インポート可能） | ○ HMAC-SHA256 署名付き（`version: 2`） |
| CSV (.csv) | 「CSV としてエクスポート」 | スプレッドシートでの分析 | − |
| Markdown (.md) | 「Markdown としてエクスポート」 | 手動エクスポート（日付範囲指定） | − |
| SQLite (.db) | 「データベースとしてエクスポート」 | 完全バックアップ（生データ、OPFSストレージ使用時のみ利用可能） | − |

JSON エクスポートには v6.7.99 以降、改竄検出のための **HMAC-SHA256 署名** が付与されます。署名鍵は拡張機能内で自動生成され、ユーザーが管理する必要はありません。

> JSON・CSV・Markdown のエクスポートは最大 **100,000件** までに制限されています。保存件数が100,000件を超える場合、エクスポートはエラーとなり、`.db` エクスポート（OPFSストレージ使用時）で全件を取得するよう案内されます。

### エクスポート列定義

CSV のヘッダ行は次の 7 列で固定です（Excel 互換の UTF-8 BOM 付き）。

`url`・`title`・`summary`・`tags`・`created_at`・`domain`・`is_starred`

JSON の各レコードは閲覧履歴の全項目を持ち、HMAC-SHA256 署名付きの envelope（`version: 2`）で包まれます。集中バックアップ経路の列射影は `EXPORT_COLUMNS` の 13 列（`id`・`url`・`title`・`summary`・`tags`・`created_at`・`domain`・`visit_duration`・`scroll_ratio`・`is_starred`・`is_deleted`・`obsidian_synced`・`gist_synced`）で固定されており、export shape は stable contract のため列追加は互換方針の見直しとセットです。

### インポート

「JSON からログをインポート」ボタンから、エクスポートした JSON ファイルを取り込みます。エクスポートしたものはインポートできます（往復）。上限の小さい方に揃え、**100,000 件以内**ならエクスポート → インポートの往復ができます。

- インポート時に **HMAC 署名が検証されます**。署名が一致しないファイル（改竄されたファイル）は拒否されます
- **旧バージョン（v6.7.98 以前）でエクスポートした署名なしの JSON は再インポートできません。** 必要な場合は、最新バージョンでデータを保持している間に再エクスポートしてください
- 形式の異なる行があっても有効な行は取り込まれます。取り込めない行は理由と件数で報告されます。同じファイルの再取込は重複しません（同一 URL・同一訪問時刻は既存優先）
- 取り込めない行がある場合は AI 修復の案内が表示されます。修正案を確認して選んだ行だけ取り込めます
- `.db` 形式のエクスポートは署名の対象外です

### 暗号化バックアップ

パスワードで保護されたバックアップが必要な場合は、「暗号化バックアップを作成」を使用します。ファイルは AES-GCM で暗号化され、パスワードなしでは復号できません。復元するときは「暗号化バックアップから復元」を使います。マスターパスワードとは別の仕組みです。暗号化バックアップは内部でデータベース全体のエクスポートを使用するため、OPFSストレージ使用時のみ利用可能です。

### トラブルシューティング

**「古い形式のログファイルはインポートできません」と表示される**

v6.7.98 以前でエクスポートした署名なしの JSON です。旧ファイルのデータがまだ拡張機能内に残っている場合は、最新バージョンで再エクスポートしてからインポートしてください。`.db` エクスポートからの復元も可能です（OPFSストレージ使用時のみ）。

**「エクスポートが100,000件の上限を超えています」と表示される**

JSON・CSV・Markdown のエクスポートは最大100,000件までです。`.db` エクスポート（OPFSストレージ使用時のみ）で全件を取得してください。

**「Import file is too large (limit: 30 MiB)」と表示される / 大量のレコードが取り込めない**

インポートにはファイル全体で **30 MiB** の上限と、合計 **100,000行** の上限があります。これらを超えるファイルは受け付けられません。分割して取り込むか、`.db` 形式での移行を検討してください。

**インポートしたレコードが重複する**

インポートは既存レコードとの重複チェックを行います。同一 URL・同一訪問時刻のレコードはスキップされます。それでも重複が表示される場合は、インポート先の環境に既に同時刻の記録が存在しないか SQLite History パネルで確認してください。

---

## English

### Overview

The **Export Logs** panel in the dashboard lets you export and import your accumulated browsing history in multiple formats ― for backups, migration to another environment, or analysis in other tools. (Local Markdown Export under "Initial Setup" is a separate feature that writes daily files automatically and is outside the scope of the limits in this guide.)

> This guide covers browsing-history data. To migrate settings (API keys, etc.), use the dashboard's **Export/Import Settings** feature instead. API keys are never included in settings exports.

### Limits at a Glance

| Item | Limit |
|---|---|
| Records per export (JSON, CSV, Markdown) | Up to 100,000 (a message guides you to the `.db` export (OPFS storage) to capture everything beyond it) |
| Import file size | Up to 30 MiB (a message appears when exceeded) |
| Import row count | Up to 100,000 rows in total |

- JSON, CSV, and Markdown are portable formats for up to 100,000 records; the `.db` export (OPFS storage only) and Encrypted Backup are full snapshots of everything
- These values mirror the implementation constants in `src/utils/limits.ts` (`MAX_EXPORT_ROWS` / `MAX_IMPORT_TEXT_BYTES` / `IMPORT_TOTAL_ROW_CAP`)

### Export Formats

| Format | Button | Use case | Signed |
|--------|--------|----------|--------|
| JSON (.json) | "Export as JSON" | Backup & migration (re-importable) | ✓ HMAC-SHA256 signature (`version: 2`) |
| CSV (.csv) | "Export as CSV" | Spreadsheet analysis | − |
| Markdown (.md) | "Export as Markdown" | Manual export with date range | − |
| SQLite (.db) | "Export as Database" | Full raw backup (available only when using OPFS storage) | − |

Since v6.7.99, JSON exports carry an **HMAC-SHA256 signature** for tamper detection. The signing key is generated automatically inside the extension and requires no user management.

> JSON, CSV, and Markdown exports are limited to a maximum of **100,000 records**. If more than 100,000 records are stored, the export fails with an error directing you to the `.db` export (OPFS storage only) to capture the full history.

### Export column definitions

The CSV header row carries a fixed 7 columns (with a UTF-8 BOM for Excel compatibility).

`url`・`title`・`summary`・`tags`・`created_at`・`domain`・`is_starred`

Each JSON record carries the full browsing-log fields inside an HMAC-SHA256-signed envelope (`version: 2`). The centralized backup path projects a fixed 13 columns (`EXPORT_COLUMNS`: `id`・`url`・`title`・`summary`・`tags`・`created_at`・`domain`・`visit_duration`・`scroll_ratio`・`is_starred`・`is_deleted`・`obsidian_synced`・`gist_synced`); the export shape is a stable contract, so adding a column requires a compatibility-policy review.

### Import

Use the "Import Logs from JSON" button to import a previously exported JSON file. What you export can be imported (round trip). The smaller cap applies, so anything within **100,000 records** can round-trip via JSON.

- The **HMAC signature is verified on import**. Files whose signature does not match (tampered files) are rejected
- **Unsigned JSON exported by older versions (≦ v6.7.98) can no longer be re-imported.** If needed, re-export while your data is still present in the latest version
- Rows with a different shape do not block the import. Valid rows are imported and rejected rows are reported with reasons and counts. Re-importing the same file creates no duplicates (same URL and visit timestamp keeps the existing record)
- When rows cannot be imported, AI repair guidance is shown. Review the proposals and import only the rows you select
- `.db` exports are not affected by signing

### Encrypted Backup

For password-protected backups, use "Create Encrypted Backup". The file is encrypted with AES-GCM and cannot be decrypted without the password. Restore with "Restore from Encrypted Backup". This feature is independent of the master password feature. Encrypted backup uses a full database export internally, so it is available only when using OPFS storage.

### Troubleshooting

**"Older-format log files cannot be imported" is shown**

The JSON was exported by v6.7.98 or earlier without a signature. If the old data is still in the extension, re-export it from the latest version and import that file instead. Restoring from a `.db` export also works (OPFS storage only).

**"Export exceeds the 100,000-record limit" is shown**

JSON, CSV, and Markdown exports support at most 100,000 records. Use the `.db` export (OPFS storage only) to capture the full history.

**"Import file is too large (limit: 30 MiB)" is shown / a large import is rejected**

Imports are capped at **30 MiB** for the whole file and **100,000 rows** in total. Files exceeding either cap are rejected. Split the file or consider migrating via the `.db` format instead.

**Imported records appear duplicated**

Import skips records that already exist (same URL and visit timestamp). If you still see duplicates, check the SQLite History panel for pre-existing records with the same timestamps in the target environment.
