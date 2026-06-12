# ストレージモードについて / About Storage Modes

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaroは、ブラウジング履歴をデバイス上に永続保存するために **OPFS (Origin Private File System)** 上のSQLiteデータベースを使用しています。

OPFSはChromeが提供するプライベートなファイルシステムで、大容量のデータを高速に保存できます。ただし、**一部のモバイルChromeや古いブラウザではOPFSが利用できない**場合があります。

そのような環境でもブラウジング履歴を保存できるよう、Yasumaroは自動的に**簡易ストレージモード**に切り替わります。

### 2つのストレージモード

| | 通常モード（OPFS） | 簡易ストレージモード（フォールバック） |
|---|---|---|
| **対象環境** | デスクトップChromeなど、OPFS対応ブラウザ | モバイルChromeなど、OPFS未対応ブラウザ |
| **保存場所** | OPFS上のSQLiteデータベース | chrome.storage.local |
| **保存容量** | 無制限 | 約5MB（Chromeの制限） |
| **検索速度** | 高速（SQLite FTS5全文検索） | やや遅い（線形探索） |
| **保存件数の目安** | 制限なし | 数百件程度 |

### 簡易ストレージモードの警告バナー

簡易ストレージモードで動作中の場合、ダッシュボードの上部に黄色い警告バナーが表示されます。

```
⚠ 簡易ストレージモードで動作中です。お使いの環境ではOPFSが利用できないため、
  chrome.storage.localを使用しています。検索機能が制限されます。
```

このバナーは、簡易ストレージモードの間だけ表示されます。通常モードに切り替わると自動的に非表示になります。

### ブラウザアップデートでOPFSが使えるようになった場合

ブラウザのアップデートによりOPFSが利用可能になると、**自動的にデータが移行**されます。

1. 簡易ストレージに保存された履歴をすべてSQLiteにコピー
2. コピー完了後、簡易ストレージのデータを削除
3. 以降は通常モード（OPFS）で動作

この移行はバックグラウンドで自動で行われるため、ユーザーが何か操作する必要はありません。

### よくある質問

**Q. 簡易ストレージモードでもすべての機能が使えますか？**

A. 基本的な記録・閲覧・検索機能は使えます。ただし、保存件数が数百件に制限されることと、全文検索の速度が通常モードより遅くなります。

**Q. データが失われることはありますか？**

A. いいえ。簡易ストレージモードで保存されたデータは、OPFSが使えるようになったときに自動的に移行されます。移行が失敗した場合でも、簡易ストレージモードが継続して使われるためデータは保持されます。

**Q. 自分の環境がどちらのモードか確認するには？**

A. ダッシュボードを開いてください。簡易ストレージモードの場合は上部に黄色い警告バナーが表示されます。バナーが表示されない場合は通常モードで動作しています。

---

## English

### Overview

Yasumaro uses a **SQLite database on OPFS (Origin Private File System)** to persistently store browsing history on your device.

OPFS is a private file system provided by Chrome that enables fast, large-capacity data storage. However, **some mobile Chrome versions and older browsers do not support OPFS**.

In such environments, Yasumaro automatically switches to **Fallback Storage Mode** so that browsing history can still be saved.

### Two Storage Modes

| | Normal Mode (OPFS) | Fallback Storage Mode |
|---|---|---|
| **Target Environment** | Desktop Chrome and other OPFS-capable browsers | Mobile Chrome and other non-OPFS browsers |
| **Storage Location** | SQLite database on OPFS | chrome.storage.local |
| **Storage Capacity** | Unlimited | Approximately 5MB (Chrome limit) |
| **Search Speed** | Fast (SQLite FTS5 full-text search) | Slower (linear scan) |
| **Approximate Record Limit** | No limit | Several hundred records |

### Fallback Storage Mode Warning Banner

When running in Fallback Storage Mode, a yellow warning banner appears at the top of the dashboard.

```
⚠ Running in fallback storage mode. OPFS is not available in your environment,
  using chrome.storage.local. Search functionality is limited.
```

This banner is only displayed while in Fallback Storage Mode. It automatically disappears when the extension switches back to Normal Mode.

### When OPFS Becomes Available After a Browser Update

When a browser update enables OPFS support, **your data is automatically migrated**.

1. All history stored in fallback storage is copied to SQLite
2. After the copy completes, the fallback storage data is deleted
3. From that point on, the extension operates in Normal Mode (OPFS)

This migration happens automatically in the background — no user action is required.

### Frequently Asked Questions

**Q. Can I use all features in Fallback Storage Mode?**

A. Basic recording, viewing, and search features work. However, the number of records is limited to several hundred, and full-text search is slower than in Normal Mode.

**Q. Will my data be lost?**

A. No. Data saved in Fallback Storage Mode is automatically migrated when OPFS becomes available. If migration fails, Fallback Storage Mode continues to be used, so your data is preserved.

**Q. How can I check which mode my environment is using?**

A. Open the dashboard. If you are in Fallback Storage Mode, a yellow warning banner will appear at the top. If no banner is displayed, you are running in Normal Mode.
