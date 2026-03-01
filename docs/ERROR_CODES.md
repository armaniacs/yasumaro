# Error Codes

Obsidian Weaveで使用するエラーコードの定義と使用ガイドラインです。

## エラーコード命名規則

エラーコードは以下の形式で定義されます：
```
[カテゴリ]_[種別]_[通番]
```

- **カテゴリ**: 機能領域を3文字略語で表現（例: STRG = Storage）
- **種別**: エラー種別を2文字略語で表現（例: RD = Read）
- **通番**: 3桁の連番（001〜999）

## エラーコード一覧

### ストレージ関連 (STRG_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `STRG_RD_001` | STORAGE_READ_FAILURE | ストレージからの読み取り失敗 | High |
| `STRG_WR_001` | STORAGE_WRITE_FAILURE | ストレージへの書き込み失敗 | High |
| `STRG_NF_001` | STORAGE_KEY_NOT_FOUND | 指定されたストレージキーが存在しない | Medium |
| `STRG_MIG_001` | STORAGE_MIGRATION_FAILURE | ストレージマイグレーション失敗 | Critical |

### 暗号化関連 (CRPT_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `CRPT_DEC_001` | CRYPTO_DECRYPTION_FAILURE | 復号化失敗 | High |
| `CRPT_ENC_001` | CRYPTO_ENCRYPTION_FAILURE | 暗号化失敗 | High |
| `CRPT_KEY_001` | CRYPTO_KEY_DERIVE_FAILURE | キー派生失敗 | High |
| `CRPT_HSH_001` | CRYPTO_HASH_FAILURE | ハッシュ計算失敗 | Medium |
| `CRPT_HMAC_001` | CRYPTO_HMAC_FAILURE | HMAC計算失敗 | High |

### API通信関連 (API_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `API_REQ_001` | API_REQUEST_FAILURE | APIリクエスト失敗 | High |
| `API_TIM_001` | API_TIMEOUT | APIタイムアウト | Medium |
| `API_RL_001` | API_RATE_LIMIT | APIレート制限超過 | Medium |
| `API_AUTH_001` | API_AUTH_FAILURE | API認証失敗 | High |

### Obsidian通信関連 (OBS_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `OBS_CONN_001` | OBSIDIAN_CONNECT_FAILURE | Obsidian接続失敗 | High |
| `OBS_SEND_001` | OBSIDIAN_SEND_FAILURE | Obsidianへの送信失敗 | High |
| `OBS_PARSE_001` | OBSIDIAN_RESPONSE_PARSE_FAILURE | Obsidianレスポンス解析失敗 | Medium |

### コンテンツ抽出関連 (CONT_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `CONT_EXT_001` | CONTENT_EXTRACTION_FAILURE | コンテンツ抽出失敗 | Low |
| `CONT_TRUNC_001` | CONTENT_TRUNCATION | コンテンツが最大文字数超過で切り詰められた | Low |

### PII/プライバシー関連 (PII_, PRIV_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `PII_DET_001` | PII_DETECTION_FAILURE | PII検出失敗 | Medium |
| `PII_RED_001` | PII_REDACTION_FAILURE | PIIマスキング失敗 | High |
| `PRIV_VIOL_001` | PRIVACY_MODE_VIOLATION | プライバシーモード違反 | Critical |

### 入力検証関連 (VAL_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `VAL_INP_001` | INVALID_INPUT | 無効な入力 | Medium |
| `VAL_REQ_001` | MISSING_REQUIRED_FIELD | 必須フィールドが欠落 | Medium |

### 設定管理関連 (SET_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `SET_IMP_001` | SETTINGS_IMPORT_FAILURE | 設定インポート失敗 | High |
| `SET_EXP_001` | SETTINGS_EXPORT_FAILURE | 設定エクスポート失敗 | High |
| `SET_SIG_001` | SETTINGS_SIGNATURE_FAILURE | 設定署名検証失敗 | High |
| `SET_AK_EXCL_001` | API_KEY_EXCLUDED | APIキー除外通知（情報） | Low |
| `SET_AK_MRG_001` | API_KEY_MERGE_CONFLICT | APIキーマージ警告 | Low |

### 汎用エラー (UNKN_, INT_)

| コード | 名称 | 説明 | 重要度 |
|--------|------|------|--------|
| `UNKN_001` | UNKNOWN_ERROR | 不明なエラー | Low |
| `INT_001` | INTERNAL_ERROR | 内部エラー | Critical |

## 使用例

### TypeScript

```typescript
import { logError, ErrorCode } from './utils/logger.js';

// エラーハンドリング
try {
    await someOperation();
} catch (error) {
    await logError(
        'Failed to save settings',
        { operation: 'saveSettings', error: error.message },
        ErrorCode.STORAGE_WRITE_FAILURE,
        'storage.ts'
    );
}

// 情報ログ
await logInfo(
    'Settings imported successfully',
    { recordCount: 10, excludedApiKeys: true },
    'settingsExportImport.ts'
);

// 警告ログ
await logWarn(
    'API rate limit approaching',
    { remainingRequests: 12, threshold: 10 },
    ErrorCode.API_RATE_LIMIT,
    'aiClient.ts'
);
```

## 重要度レベル

| レベル | 定義 | 対応 |
|:------:|------|------|
| **Critical** | システム機能停止、データ損失、セキュリティ違反 | 即時対応必須 |
| **High** | 重要機能の障害 | 優先的に対応 |
| **Medium** | 機能制限、非最適状態 | 時期を決めて対応 |
| **Low** | 情報報告、最適化提案 | 随時対応 |

## エラーコード追加ガイド

新しいエラーコードを追加する際の手順：

1. **カテゴリ決定**: 該当するカテゴリを選択または新規作成
2. **コード定義**: `src/utils/logger.ts` の `ErrorCode` オブジェクトに追加
3. **ドキュメント更新**: 本ファイルにコードの説明を追加
4. **使用実装**: 適切な箇所で `logError()` / `logWarn()` 等で使用

## ログ出力元（source）の命名規則

ログ出力元モジュール名は以下の規則に従います：
- エントリポイント: `main.ts`, `popup.ts`, `dashboard.ts`, `service-worker.ts`
- ユーティリティ: ファイル名（例: `logger.ts`, `storage.ts`）
- 機能モジュール: 機能名（例: `aiClient`, `obsidianClient`）

## 履歴

- 2026-03-01: エラーコードシステムの定義と初期セット（SRE/Logging改善 #8）