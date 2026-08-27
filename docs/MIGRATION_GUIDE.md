# 旧データベースからの移行ガイド / Legacy Database Migration Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は v6.5.34 以降、旧データベース（wa-sqlite 製）から新しいデータベース（@subframe7536/sqlite-wasm）へ自動的にデータを移行します。移行はバックグラウンドで行われ、ユーザーの操作は基本的に不要です。

### 移行の仕組み

2種類の移行が存在します:

| 経路 | 旧エンジン | 新エンジン | 概要 |
|------|-----------|-----------|------|
| **OPFS経路** | wa-sqlite AccessHandlePoolVFS | @subframe7536 OPFSCoopSyncVFS | OPFSが利用可能な環境向け |
| **IDB経路** | wa-sqlite IDBBatchAtomicVFS | @subframe7536 IDB VFS | IndexedDBのみが利用可能な環境向け |

移行は拡張機能の起動時に自動実行されます。移行完了後、旧データベースのデータは新しいデータベースにコピーされ、フラグが保存されます。

### 移行状態の確認方法

1. ダッシュボードを開く
2. サイドバーから「診断」タブを選択
3. 「旧データベース移行」セクションを確認

表示される情報:

- **旧データベースからの移行**: 両方の経路が完了しているか
- **OPFS経路**: OPFS経路の移行完了状態
- **IDB経路**: IDB経路の移行完了状態

### 移行が完了しない場合

拡張機能をインストールしたばかりの新規ユーザーの場合、「未完了」と表示されることがあります。これは正常です。旧データベースにデータが存在しないため、移行の対象外となります。

移行が完了しない場合の対処法:

1. **拡張機能を再起動する**: ブラウザを閉じて再度開き、拡張機能が読み込まれるのを待ちます
2. **ダッシュボードを開く**: ダッシュボードを開くことで移行処理がトリガーされる場合があります
3. **ブラウザを更新する**: 最新版のChrome/Edgeを使用していることを確認してください

### 移行に関する注意事項

- 移行中はデータの一時的な利用が制限される場合があります
- 移行が失敗した場合、フォールバックモードが継続し、データは保持されます
- 設定（Obsidian接続情報、AIプロバイダ設定等）は移行対象外です

### よくある質問

**Q. 移行中にデータは失われますか？**

A. いいえ。移行はコピー操作であり、元のデータは移行完了後に削除されます。移行が失敗した場合でも、元のデータは保持されます。

**Q. 移行を手動で実行することはできますか？**

A. 移行は拡張機能の起動時に自動実行されます。手動でのトリガーはできませんが、ダッシュボードを開くことで移行処理が開始される場合があります。

**Q. 移行後、設定は変わりますか？**

A. いいえ。設定（Obsidian接続情報、AIプロバイダ設定、プライバシー設定等）は移行対象外です。移行後も同じ設定が維持されます。

**Q. 複数デバイスで使っている場合、各デバイスで移行は行われますか？**

A. はい。各デバイスのブラウザで拡張機能が起動されるたびに、そのデバイスのデータに対して移行が実行されます。

---

## English

### Overview

Since v6.5.34, Yasumaro automatically migrates data from the legacy database (wa-sqlite) to the new database (@subframe7536/sqlite-wasm). Migration runs in the background and requires no user action.

### How Migration Works

Two types of migration exist:

| Path | Old Engine | New Engine | Description |
|------|-----------|-----------|-------------|
| **OPFS path** | wa-sqlite AccessHandlePoolVFS | @subframe7536 OPFSCoopSyncVFS | For OPFS-capable environments |
| **IDB path** | wa-sqlite IDBBatchAtomicVFS | @subframe7536 IDB VFS | For IndexedDB-only environments |

Migration runs automatically when the extension starts. After completion, data from the legacy database is copied to the new database and a flag is saved.

### How to Check Migration Status

1. Open the dashboard
2. Select the "Diagnostics" tab from the sidebar
3. Check the "Legacy DB Migration" section

Displayed information:

- **Legacy DB Migration**: Whether both paths are complete
- **OPFS path**: OPFS migration completion status
- **IDB path**: IDB migration completion status

### When Migration Is Not Complete

If you are a new user who just installed the extension, "not completed" may be displayed. This is normal. There is no legacy data to migrate.

Steps to resolve incomplete migration:

1. **Restart the extension**: Close and reopen the browser, then wait for the extension to load
2. **Open the dashboard**: Opening the dashboard may trigger the migration process
3. **Update your browser**: Make sure you are using the latest version of Chrome/Edge

### Migration Notes

- During migration, data access may be temporarily limited
- If migration fails, fallback mode continues and data is preserved
- Settings (Obsidian connection info, AI provider settings, etc.) are not migrated

### Frequently Asked Questions

**Q. Will my data be lost during migration?**

A. No. Migration is a copy operation; the original data is deleted only after migration completes. If migration fails, the original data is preserved.

**Q. Can I manually trigger migration?**

A. Migration runs automatically when the extension starts. You cannot trigger it manually, but opening the dashboard may start the migration process.

**Q. Will my settings change after migration?**

A. No. Settings (Obsidian connection info, AI provider settings, privacy settings, etc.) are not part of migration. The same settings are maintained after migration.

**Q. If I use multiple devices, does migration run on each device?**

A. Yes. Migration is executed for the data on each device when the extension starts in that device's browser.
