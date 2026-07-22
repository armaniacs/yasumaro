# 監査ログガイド / Audit Log Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は、AI要約の生成リクエストを送信するたびに、いつ・どのAIプロバイダーに・どのページの内容を送信したかを記録します。この記録を「監査ログ」と呼びます。あとから「このページの内容は本当にAIに送信されたのか」「どのプロバイダーが使われたのか」を確認できます。

### 記録される情報

| 項目 | 内容 |
|------|------|
| **プロバイダー** | 要約生成に使用したAIプロバイダー名（例: gemini） |
| **URL** | 要約対象となったページの完全なURL |
| **記録日時** | ログが記録されたタイムスタンプ |

**重要**: ページの本文や生成された要約の内容そのものは記録されません。監査ログに保存されるのは「プロバイダー・URL・日時」の3項目のみで、要約が成功したか失敗したかも記録対象外です。プライバシーに配慮し、必要最小限のメタデータのみを記録する設計になっています。

### 確認方法

ダッシュボードの **ログをエクスポート** パネルの「監査ログ TSV ダウンロード」から、直近100,000件の記録を TSV ファイルとしてダウンロードできます。ファイル名は `yasumaro-audit-log-YYYY-MM-DD.tsv` で、`created_at`（ISO 8601形式）・プロバイダー名・URL の3カラムが含まれます。

### 保持期間

監査ログには自動削除機能がなく、無期限に蓄積されます（保存先はローカルの SQLite データベースです）。蓄積量が気になる場合は、SQLite の定期的なメンテナンス（PURGE）と併せてご利用ください。

### 想定される使い方

- どのAIプロバイダーが実際に使われているかを確認したい場合
- 特定のページの内容がAIに送信された事実を後から確認したい場合
- 複数のAIプロバイダーを優先度設定で使い分けている際に、実際にどのプロバイダーが呼ばれたかを追跡したい場合（[AI自動要約ガイド](AI_SUMMARY_GUIDE.md) の優先度フォールバックを参照）
- 監査ログのTSVファイルを表計算ソフトで開いてフィルタリング・集計したい場合

---

## English

### Overview

Every time Yasumaro sends an AI summarization request, it records when, to which AI provider, and for which page's content the request was sent. This record is called the "audit log." It lets you later verify whether a given page's content was actually sent to an AI, and which provider was used.

### What Gets Recorded

| Field | Description |
|-------|-------------|
| **Provider** | The AI provider used for summarization (e.g., gemini) |
| **URL** | The full URL of the page that was summarized |
| **Timestamp** | When the log entry was recorded |

**Important**: The page's body text and the generated summary content are never recorded. Only "provider, URL, and timestamp" are stored — success or failure of the summarization is not tracked either. The design intentionally records the minimum metadata necessary, out of privacy consideration.

### Viewing the Log

From the dashboard's **Export Logs** panel, use the "Audit Log TSV Download" section to download the most recent 100,000 entries as a TSV file. The filename follows the pattern `yasumaro-audit-log-YYYY-MM-DD.tsv` and contains three columns: `created_at` (ISO 8601), provider name, and URL.

### Retention

Audit log entries are never automatically deleted; they accumulate indefinitely (stored in the local SQLite database). If storage size becomes a concern, periodic SQLite maintenance (PURGE) can help manage it.

### Typical Use Cases

- Confirming which AI provider is actually being used
- Verifying after the fact that a specific page's content was sent to an AI
- Tracking which provider was actually invoked when using priority-ranked fallback across multiple providers (see the priority fallback section in the [AI Summarization Guide](AI_SUMMARY_GUIDE.md))
- Opening the audit log TSV in a spreadsheet for filtering and aggregation

---
