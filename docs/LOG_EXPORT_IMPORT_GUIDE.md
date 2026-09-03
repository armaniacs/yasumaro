# ログのエクスポート・インポートガイド / Log Export & Import Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

ダッシュボードの **「ログをエクスポート」** パネルから、蓄積した閲覧履歴を複数の形式でエクスポート・インポートできます。バックアップや他の環境への移行、他ツールでの分析に使えます。

> 本ガイドは閲覧履歴データのエクスポート/インポートについて説明します。設定（APIキー等）の移行はダッシュボードの「設定のエクスポート/インポート」機能を使用してください。API キーは設定エクスポートに含まれません。

### エクスポート形式

| 形式 | ボタン | 用途 | 署名 |
|------|--------|------|------|
| JSON (.json) | 「JSON としてエクスポート」 | バックアップ・他環境への移行（再インポート可能） | ○ HMAC-SHA256 署名付き（`version: 2`） |
| CSV (.csv) | 「CSV としてエクスポート」 | スプレッドシートでの分析 | − |
| Markdown (.md) | 「Markdown としてエクスポート」 | 手動エクスポート（日付範囲指定） | − |
| SQLite (.db) | 「データベースとしてエクスポート」 | 完全バックアップ（生データ） | − |

JSON エクスポートには v6.7.99 以降、改竄検出のための **HMAC-SHA256 署名** が付与されます。署名鍵は拡張機能内で自動生成され、ユーザーが管理する必要はありません。

### インポート

「JSON からログをインポート」ボタンから、エクスポートした JSON ファイルを取り込みます。

- インポート時に **HMAC 署名が検証されます**。署名が一致しないファイル（改竄されたファイル）は拒否されます
- **旧バージョン（v6.7.98 以前）でエクスポートした署名なしの JSON は再インポートできません。** 必要な場合は、最新バージョンでデータを保持している間に再エクスポートしてください
- `.db` 形式のエクスポートは署名の対象外です

### 暗号化バックアップ

パスワードで保護されたバックアップが必要な場合は、「暗号化バックアップを作成」を使用します。ファイルは AES-GCM で暗号化され、パスワードなしでは復号できません。復元するときは「暗号化バックアップから復元」を使います。マスターパスワードとは別の仕組みです。

### トラブルシューティング

**「古い形式のログファイルはインポートできません」と表示される**

v6.7.98 以前でエクスポートした署名なしの JSON です。旧ファイルのデータがまだ拡張機能内に残っている場合は、最新バージョンで再エクスポートしてからインポートしてください。`.db` エクスポートからの復元も可能です。

**インポートしたレコードが重複する**

インポートは既存レコードとの重複チェックを行います。同一 URL・同一訪問時刻のレコードはスキップされます。それでも重複が表示される場合は、インポート先の環境に既に同時刻の記録が存在しないか History タブで確認してください。

---

## English

### Overview

The **Export Logs** panel in the dashboard lets you export and import your accumulated browsing history in multiple formats — for backups, migration to another environment, or analysis in other tools.

> This guide covers browsing-history data. To migrate settings (API keys, etc.), use the dashboard's **Export/Import Settings** feature instead. API keys are never included in settings exports.

### Export Formats

| Format | Button | Use case | Signed |
|--------|--------|----------|--------|
| JSON (.json) | "Export as JSON" | Backup & migration (re-importable) | ✓ HMAC-SHA256 signature (`version: 2`) |
| CSV (.csv) | "Export as CSV" | Spreadsheet analysis | − |
| Markdown (.md) | "Export as Markdown" | Manual export with date range | − |
| SQLite (.db) | "Export as Database" | Full raw backup | − |

Since v6.7.99, JSON exports carry an **HMAC-SHA256 signature** for tamper detection. The signing key is generated automatically inside the extension and requires no user management.

### Import

Use the "Import Logs from JSON" button to import a previously exported JSON file.

- The **HMAC signature is verified on import**. Files whose signature does not match (tampered files) are rejected
- **Unsigned JSON exported by older versions (≤ v6.7.98) can no longer be re-imported.** If needed, re-export while your data is still present in the latest version
- `.db` exports are not affected by signing

### Encrypted Backup

For password-protected backups, use "Create Encrypted Backup". The file is encrypted with AES-GCM and cannot be decrypted without the password. Restore with "Restore from Encrypted Backup". This feature is independent of the master password feature.

### Troubleshooting

**"Older-format log files cannot be imported" is shown**

The JSON was exported by v6.7.98 or earlier without a signature. If the old data is still in the extension, re-export it from the latest version and import that file instead. Restoring from a `.db` export also works.

**Imported records appear duplicated**

Import skips records that already exist (same URL and visit timestamp). If you still see duplicates, check the History tab for pre-existing records with the same timestamps in the target environment.
