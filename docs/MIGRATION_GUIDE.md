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

- **現在使用中のエンジン**: 今のブラウザで実際に使われているエンジン（OPFSが推奨、対応するデータベースファイル名も併記）
- **保存データ件数** / **ストレージ使用量（拡張機能全体）**: 現在のデータ量の目安
- **旧データベースからの移行**: 両方の経路が完了（または対象外）しているか
- **OPFS経路 / IDB経路**: 各経路の状態。表示される値は次のいずれか
  - **完了**: 移行済み、または元々移行対象のデータがなかった
  - **対象外（旧データなし）**: 旧データベースの実在確認の結果、移行すべきデータが存在しないことが確認できた状態。警告表示にはならない
  - **確認中**: OPFS経路のみ。旧データベースは存在するが、移行処理自体がまだ一度も実行されていない一時的な状態（後述）
  - **未完了**: 旧データベースが存在するのに移行が完了していない、本来の意味での未完了
- **旧OPFSデータベースの検出 / 旧IndexedDBデータベースの検出**: 旧データベースファイルが今のブラウザ上に実在するかどうかのライブ確認結果（あり/なし）。実在する場合はブラウザ内部の仮想パス／識別名も表示されます
- **OPFS 最終試行日時 / OPFS 完了日時 / OPFS 移行件数**: OPFS経路で移行処理が実行された場合の詳細ログ

OPFS・IndexedDB ともに、データはブラウザのストレージサンドボックス内に保存されます。そのため、Web API では OS 上の絶対ファイルパスを取得できません（ブラウザの仕様による意図的な制限です）。診断パネルに表示される「OPFS経路」「IDB経路」の値は、取得可能な範囲で最も具体的なブラウザ内部の識別情報です。

### 「確認中」「未完了」が表示される場合

「対象外（旧データなし）」と表示される場合、旧データベースの実在確認により対象データがないことが確定しているため、心配は不要です。

「確認中」（OPFS経路のみ）または本当の「未完了」が続く場合の対処法:

1. **拡張機能を再起動する**: ブラウザを閉じて再度開き、拡張機能が読み込まれるのを待ちます
2. **ダッシュボードを開く**: ダッシュボードを開くことで移行処理がトリガーされる場合があります
3. **ブラウザを更新する**: 最新版のChrome/Edgeを使用していることを確認してください

「保存データ件数」が0でないのに「確認中」が続く場合は、移行処理（専用Worker／別スレッドで動作）から `chrome.storage.local` へのアクセスが制限されている可能性があります。この場合も保存済みデータには影響しません。診断パネルの当該行にヒントが表示されます。

### 移行に関する注意事項

- 移行中はデータの一時的な利用が制限される場合があります
- 移行が失敗した場合、フォールバックモードが継続し、データは保持されます
- 設定（Obsidian接続情報、AIプロバイダ設定等）は移行対象外です

### よくある質問

**Q. 移行中にデータは失われますか？**

A. いいえ。移行はコピー操作であり、元のデータは移行完了後に削除されます。移行が失敗した場合でも、元のデータは保持されます。

**Q. 移行は手動でも実行できますか？**

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

- **Current engine**: The engine actually in use in this browser right now (OPFS is recommended; the corresponding database filename is shown alongside)
- **Saved record count** / **Storage used (whole extension)**: A rough indicator of current data volume
- **Legacy DB Migration**: Whether both paths are complete (or not applicable)
- **OPFS path / IDB path**: Status of each path. The value shown is one of:
  - **Done**: Either migrated, or there was never any legacy data to migrate
  - **Not applicable (no legacy data)**: A live existence check confirmed there is no legacy database to migrate. Not shown as a warning
  - **Checking...** (OPFS path only): A legacy database exists, but the migration routine has not run yet — a transient state (see below)
  - **Pending**: A legacy database exists but migration genuinely has not completed
- **OPFS legacy DB detected / IDB legacy DB detected**: A live check of whether the legacy database file actually exists in this browser right now (Yes/No). When present, the browser-internal virtual path / identifier is also shown
- **OPFS last attempted / OPFS completed at / OPFS records migrated**: Detailed log fields for when the OPFS migration routine has run

Neither OPFS nor IndexedDB exposes an OS-level absolute file path via any Web API — both live inside the browser's storage sandbox, and this is an intentional browser restriction, not a limitation of this extension. The "OPFS path" / "IDB path" values shown in the diagnostics panel are the most specific browser-internal identifiers available.

### When "Checking..." or "Not Completed" Is Shown

If you see "Not applicable (no legacy data)", the live existence check has already confirmed there is nothing to migrate — no action needed.

Steps to resolve a genuine "Checking..." (OPFS path only) or "Pending" state:

1. **Restart the extension**: Close and reopen the browser, then wait for the extension to load
2. **Open the dashboard**: Opening the dashboard may trigger the migration process
3. **Update your browser**: Make sure you are using the latest version of Chrome/Edge

If "Saved record count" already shows data but "Checking..." persists, the dedicated Worker (a thread created via the `Worker()` constructor) running the OPFS migration routine may be unable to access `chrome.storage.local`. This does not affect your saved data. A hint is shown inline in the diagnostics panel in this case.

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
