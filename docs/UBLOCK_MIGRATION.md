# uBlockフィルター データマイグレーションガイド / uBlock Filter Data Migration Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

バージョン 2.2.5 以降、uBlockフィルターのストレージ形式が変更されました。

### 変更内容

#### 旧形式 (v2.2.4以前)

```json
{
  "blockRules": [
    { "domain": "example.com", "pattern": "example.com", "options": {} }
  ],
  "exceptionRules": [
    { "domain": "safe.com", "pattern": "safe.com", "options": {} }
  ],
  "metadata": { ... }
}
```

#### 新形式 (v2.2.5以降)

```json
{
  "blockDomains": ["example.com", "test.com"],
  "exceptionDomains": ["safe.com"],
  "metadata": { ... }
}
```

### 自動マイグレーション

v2.2.4以前のデータを持っているユーザーは、初回起動時に自動的に新形式へマイグレーションされます。

- マイグレーションは拡張機能のバックグラウンド（設定読み込み時）に自動実行されます
- 既存のルールはすべて保持されます
- マイグレーションは一度だけ実行されます

### メリット

- ストレージ使用量の大幅な削減（約70%削減）
- マッチング処理の高速化
- 大規模なフィルターリストでのパフォーマンス向上

### 注意点

- マイグレーションは不可逆です（新形式から旧形式へは戻れません）
- マイグレーション処理はバックグラウンドで自動的に完了します。完了後、ルールが正しく反映されていることを確認してください。
- マイグレーション前のデータは自動的に上書きされます

---

## English

### Overview

From version 2.2.5 onwards, the storage format for uBlock filters has changed.

### Changes

#### Old Format (v2.2.4 and earlier)

```json
{
  "blockRules": [
    { "domain": "example.com", "pattern": "example.com", "options": {} }
  ],
  "exceptionRules": [
    { "domain": "safe.com", "pattern": "safe.com", "options": {} }
  ],
  "metadata": { ... }
}
```

#### New Format (v2.2.5 and later)

```json
{
  "blockDomains": ["example.com", "test.com"],
  "exceptionDomains": ["safe.com"],
  "metadata": { ... }
}
```

### Automatic Migration

Users with data from v2.2.4 or earlier will be automatically migrated to the new format on first launch.

- Migration runs automatically in the background (during settings loading)
- All existing rules are preserved
- Migration runs only once

### Benefits

- Significant reduction in storage usage (~70% reduction)
- Faster matching process
- Improved performance with large filter lists

### Notes

- Migration is irreversible (you cannot revert from new format to old format)
- Migration processing completes automatically in the background. Please verify that rules are correctly reflected after completion.
- Pre-migration data is automatically overwritten