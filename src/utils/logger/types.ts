/**
 * logger/types.ts
 * Error codes and log entry type definitions shared by logger/core.ts and logger/api.ts.
 */

// エラーコード定義（SRE/Logging改善 #8）
export const ErrorCode = {
    // ストレージ関連
    STORAGE_READ_FAILURE: 'STRG_RD_001',
    STORAGE_WRITE_FAILURE: 'STRG_WR_001',
    STORAGE_KEY_NOT_FOUND: 'STRG_NF_001',
    STORAGE_MIGRATION_FAILURE: 'STRG_MIG_001',
    STORAGE_QUOTA_EXCEEDED: 'STRG_QUOTA_001',
    MIGRATION_ROLLBACK_FAILED: 'STRG_ROLLBACK_001',

    // 暗号化関連
    CRYPTO_DECRYPTION_FAILURE: 'CRPT_DEC_001',
    CRYPTO_ENCRYPTION_FAILURE: 'CRPT_ENC_001',
    CRYPTO_KEY_DERIVE_FAILURE: 'CRPT_KEY_001',
    CRYPTO_HASH_FAILURE: 'CRPT_HSH_001',
    CRYPTO_HMAC_FAILURE: 'CRPT_HMAC_001',

    // API通信関連
    API_REQUEST_FAILURE: 'API_REQ_001',
    API_TIMEOUT: 'API_TIM_001',
    API_RATE_LIMIT: 'API_RL_001',
    API_AUTH_FAILURE: 'API_AUTH_001',

    // Obsidian通信関連
    OBSIDIAN_CONNECT_FAILURE: 'OBS_CONN_001',
    OBSIDIAN_SEND_FAILURE: 'OBS_SEND_001',
    OBSIDIAN_RESPONSE_PARSE_FAILURE: 'OBS_PARSE_001',

    // コンテンツ抽出関連
    CONTENT_EXTRACTION_FAILURE: 'CONT_EXT_001',
    CONTENT_TRUNCATION: 'CONT_TRUNC_001',

    // PII/プライバシー関連
    PII_DETECTION_FAILURE: 'PII_DET_001',
    PII_REDACTION_FAILURE: 'PII_RED_001',
    PRIVACY_MODE_VIOLATION: 'PRIV_VIOL_001',

    // 入力検証関連
    INVALID_INPUT: 'VAL_INP_001',
    MISSING_REQUIRED_FIELD: 'VAL_REQ_001',

    // 設定管理関連
    SETTINGS_IMPORT_FAILURE: 'SET_IMP_001',
    SETTINGS_EXPORT_FAILURE: 'SET_EXP_001',
    SETTINGS_SIGNATURE_FAILURE: 'SET_SIG_001',

    // APIキー管理関連
    API_KEY_EXCLUDED: 'SET_AK_EXCL_001',
    API_KEY_MERGE_CONFLICT: 'SET_AK_MRG_001',

    // Trust Database関連（Phase 1）
    TRUST_DB_INIT_FAILED: 'TRUST_INIT_001',
    TRUST_DB_NOT_INITIALIZED: 'TRUST_NOT_INIT_001',
    TRUST_DB_MIGRATION_FAILED: 'TRUST_MIG_001',
    TRANCO_FETCH_FAILED: 'TRANCO_FETCH_001',
    TRANCO_PARSE_FAILED: 'TRANCO_PARSE_001',
    BLOOM_FILTER_ERROR: 'BLM_FLT_001',

    // CSP/AIプロバイダー関連
    UNKNOWN_AI_PROVIDER: 'CSP_AI_001',

    // 汎用エラー
    UNKNOWN_ERROR: 'UNKN_001',
    INTERNAL_ERROR: 'INT_001',

    // UI/Badge関連
    BADGE_UPDATE_FAILED: 'UI_BADGE_001',

    // Permission Manager関連（P0）
    PERMISSION_REQUIRED: 'PERM_REQ_001'
} as const;

export type ErrorCodeValues = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Template literal type documenting the structured error code pattern.
 * Most error codes follow the format: PREFIX_SUFFIX_NUMBER (e.g., STRG_RD_001).
 * Note: TypeScript template literal matching has limitations with multiple
 * underscore segments, so this serves as documentation and future constraint
 * for new error codes rather than a strict compile-time check on all existing values.
 */
export type ErrorCodePattern = `${string}_${string}_${number}`;

export const LogType = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    SANITIZE: 'SANITIZE',
    DEBUG: 'DEBUG'
} as const;

export type LogTypeValues = typeof LogType[keyof typeof LogType];

export interface LogEntry {
    id: string;
    timestamp: number;
    type: LogTypeValues;
    message: string;
    errorCode?: ErrorCodeValues;
    details?: Record<string, unknown>;
    source?: string; // ログ出力元モジュール
    userId?: string; // ユーザー識別子（匿名化済み）
}
