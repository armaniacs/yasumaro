# ストレージアーキテクチャについて / About Storage Architecture

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaroは、ブラウジング履歴をデバイス上に永続保存するために **OPFS (Origin Private File System)** 上のSQLiteデータベースを優先的に使用します。OPFSが利用できない環境では、自動的にフォールバック先に切り替わります。

### 3層のストレージバックエンド

Yasumaroはパフォーマンスの高い順に3つのバックエンドを試行し、利用可能なものを自動選択します。

| 優先度 | バックエンド | 保存場所 | 特徴 |
|--------|------------|---------|------|
| **第1** | OPFS Worker（通常モード） | OPFS上のSQLite | 高速・容量無制限・FTS5全文検索対応 |
| **第2** | IndexedDB VFS（フォールバック1） | IndexedDB上のSQLite | OPFS非対応環境でもSQLiteを維持 |
| **第3** | FallbackStorage（フォールバック2） | chrome.storage.local | 最終手段。容量制限(約5MB)・検索低速 |

**第1（OPFS）**: デスクトップChromeなど、OPFS対応ブラウザで使用します。最も高速で、保存件数に事実上の制限はありません。SQLite FTS5による高度な全文検索が利用できます。

**第2（IndexedDB VFS）**: 一部のモバイルChromeなどOPFS非対応だがIndexedDBが利用可能な環境で使用します。SQLiteの機能は維持される（全文検索含む）ため、ユーザー体験への影響は軽微です。

**第3（FallbackStorage）**: OPFSもIndexedDBも利用できない環境（非常に古いブラウザ等）で使用します。保存容量は約5MBに制限され、検索速度も低下します。

### 通常モード（OPFS）の警告

ダッシュボード上部に黄色い警告バナーが表示された場合、フォールバックモードで動作しています。

### バックエンド移行

ブラウザのアップデート等により、より上位のバックエンドが利用可能になると、自動的にデータが移行されます。この移行はバックグラウンドで行われ、ユーザーの操作は不要です。

### Version注記

- v6.5.26〜: OPFS Worker + IndexedDB VFS + FallbackStorage の3層構成
- v6.5.34〜: IndexedDB VFSを `@subframe7536/sqlite-wasm` に移行、旧 wa-sqlite からの自動移行対応

### よくある質問

**Q. フォールバックモードでもすべての機能が使えますか？**

A. 基本的な記録・閲覧・検索機能は使えます。ただし、保存件数が制限されることと、全文検索の速度が通常モードより遅くなります。

**Q. データが失われることはありますか？**

A. いいえ。フォールバックモードで保存されたデータは、上位のバックエンドが使えるようになったときに自動的に移行されます。移行が失敗した場合でも、フォールバックモードが継続して使われるためデータは保持されます。

**Q. 自分の環境がどちらのモードか確認するには？**

A. ダッシュボードを開いてください。フォールバックモードの場合は上部に黄色い警告バナーが表示されます。バナーが表示されない場合は通常モードで動作しています。

---

## English

### Overview

Yasumaro uses a **SQLite database on OPFS (Origin Private File System)** as its primary storage for browsing history. When OPFS is unavailable, it automatically falls back through two alternative backends.

### Three-Layer Storage Backend

| Priority | Backend | Storage Location | Characteristics |
|----------|---------|-----------------|-----------------|
| **1st** | OPFS Worker (Normal Mode) | SQLite on OPFS | Fast, unlimited capacity, FTS5 full-text search |
| **2nd** | IndexedDB VFS (Fallback 1) | SQLite on IndexedDB | Maintains SQLite even without OPFS |
| **3rd** | FallbackStorage (Fallback 2) | chrome.storage.local | Last resort, ~5MB cap, slower search |

**1st (OPFS)**: Used on desktop Chrome and other OPFS-capable browsers. Offers the best performance with no practical record limit and SQLite FTS5 full-text search.

**2nd (IndexedDB VFS)**: Used when OPFS is unavailable but IndexedDB is available (e.g., some mobile Chrome builds). SQLite features including full-text search are maintained, so the user experience impact is minimal.

**3rd (FallbackStorage)**: Used when neither OPFS nor IndexedDB is available (very old browsers, edge cases). Storage capacity is limited to approximately 5MB, and search is slower.

### Warning Banner

If a yellow warning banner appears at the top of the dashboard, the extension is running in a fallback storage mode.

### Backend Migration

When a higher-priority backend becomes available (e.g., after a browser update), data is automatically migrated in the background — no user action required.

### Version Notes

- v6.5.26+: Three-layer architecture (OPFS Worker + IndexedDB VFS + FallbackStorage)
- v6.5.34+: IndexedDB VFS migrated to `@subframe7536/sqlite-wasm` with automatic migration from legacy wa-sqlite

### Frequently Asked Questions

**Q. Can I use all features in Fallback Mode?**

A. Basic recording, viewing, and search features work. However, record counts are limited and full-text search is slower than in Normal Mode.

**Q. Will my data be lost?**

A. No. Data saved in Fallback Mode is automatically migrated when a higher-priority backend becomes available. If migration fails, Fallback Mode continues to be used, so your data is preserved.

**Q. How can I check which mode my environment is using?**

A. Open the dashboard. If you are in a Fallback Mode, a yellow warning banner will appear at the top. If no banner is displayed, you are running in Normal Mode.
