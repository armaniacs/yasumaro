/**
 * sensitiveDataMask.ts
 * 機密データマスキングの統一モジュール。
 * redaction.ts と logMasker.ts の二つの並列システムを統合し、
 * 単一ソースオブトゥルースを提供する。
 */

// 依存の無い正規の一覧から読む。settingsMigration を経由すると
// logger/sanitize → sensitiveDataMask → settingsMigration → logger/api の
// 静的循環が成立し、読み込み順によっては API_KEY_FIELDS の TDZ 参照で
// logger 全体が初期化に失敗する。
import { API_KEY_FIELD_NAMES } from './storage/apiKeyFields.js';

// ─── Field lists ───────────────────────────────────────────────────────

/**
 * LEVEL1: APIキー・トークン・パスワード等。完全マスキング対象。
 * redaction.ts の SENSITIVE_KEYS + logMasker.ts の LEVEL1_FIELDS を統合。
 */
const LEVEL1_FIELDS = [
  // API キー系（storage/apiKeyFields.ts の正規一覧）
  ...API_KEY_FIELD_NAMES,
  // From redaction.ts (ADDITIONAL_SENSITIVE_KEYS)
  'apiKey',
  'fullKey',
  'authToken',
  'auth',
  'password',
  'token',
  'master_password_hash',
  'hmac_secret',
  // From logMasker.ts (LEVEL1_FIELDS)
  'api_key',
  'API_KEY',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'passwd',
  'private_key',
  'privateKey',
  'client_secret',
  'clientSecret',
] as const;

/**
 * LEVEL2: ユーザー識別情報。部分マスキング対象（メールアドレス等）。
 * logMasker.ts の LEVEL2_FIELDS から導出。
 */
const LEVEL2_FIELDS = [
  'user_id',
  'userId',
  'email',
  'ip',
  'ipAddress',
  'session_id',
  'sessionId',
] as const;

// Pre-lowercase for efficient matching (computed once at module load)
const LOWERCASE_LEVEL1 = LEVEL1_FIELDS.map(k => k.toLowerCase());
const LOWERCASE_LEVEL2 = LEVEL2_FIELDS.map(k => k.toLowerCase());

// 'partial' 戦略（ログ出力）が使う Level 1 の置換文字列。
const LEVEL1_PARTIAL_MASK = '***';

// ─── Masking strategies ────────────────────────────────────────────────

export type MaskStrategy = 'full' | 'partial';

/**
 * Level 1 相当のキー名かどうか（小文字化済みのキーを渡す）。
 * 部分一致は既存の共有実装と同じで、`github_pat` は `githubPersonalAccessToken`
 * にも効く。呼び出し側ごとに一致規則を分けず、ここを単一判定点にする。
 */
function isLevel1Key(lowerKey: string): boolean {
  return LOWERCASE_LEVEL1.some(k => lowerKey.includes(k));
}

/**
 * メールアドレスの部分マスキング。
 * "user@example.com" → "u***@example.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

/**
 * 個別値のマスキング。
 *
 * 戦略による動作の違い:
 * - 'full' (redaction): 機密キーは値の型に関わらずマスキング（null/undefinedも対象）
 * - 'partial' (logMasker): 文字列値のみマスキング（数値/null/undefinedはスキップ）
 *
 * @param key - フィールド名
 * @param value - マスキング対象の値
 * @param strategy - 'full' なら [REDACTED]、'partial' なら ***
 */
function maskValue(key: string, value: unknown, strategy: MaskStrategy): unknown {
  const lowerKey = key.toLowerCase();
  const replacement = strategy === 'full' ? '[REDACTED]' : LEVEL1_PARTIAL_MASK;

  // LEVEL1: 完全マスキング
  if (isLevel1Key(lowerKey)) {
    // 'full' 戦略: 値の型に関わらずマスキング
    // 'partial' 戦略: 文字列のみマスキング（数値/null/undefinedはスキップ）
    if (strategy === 'full' || typeof value === 'string') {
      return replacement;
    }
  }

  // LEVEL2: 部分マスキング（文字列のみ）
  if (typeof value === 'string' && LOWERCASE_LEVEL2.some(k => lowerKey.includes(k))) {
    if (lowerKey === 'email') {
      return strategy === 'full' ? '[REDACTED]' : maskEmail(value);
    }
    return replacement;
  }

  return value;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * キー名のみで値を秘匿マスキングする。Level 1 は値の型に関わらず `***` になる。
 *
 * ログサニタイザーは「キー名による秘匿マスキング → PII 正規表現」の順を
 * 固定したうえで合成するため、1 値ずつ適用できるこの形を公开する。
 * Level 2 は既存の PII サニタイザが担当するため、ここでは対象外。
 *
 * @param key - フィールド名
 * @param value - マスキング対象の値
 * @returns Level 1 キーなら `***`、そうでなければ `value` を同一参照で返す
 */
export function maskSecretValueByKey(key: string, value: unknown): unknown {
  return isLevel1Key(key.toLowerCase()) ? LEVEL1_PARTIAL_MASK : value;
}

/**
 * オブジェクト内の機密フィールドを再帰的にマスキングする。
 * @param data - マスキング対象のデータ
 * @param strategy - 'full' なら [REDACTED]、'partial' なら ***
 * @param depth - 再帰深度（内部使用）
 */
export function maskSensitiveData(
  data: unknown,
  strategy: MaskStrategy = 'full',
  depth = 0,
): unknown {
  if (depth > 100) {
    return strategy === 'full' ? '[REDACTED: too deep]' : '***';
  }

  if (data === null || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => maskSensitiveData(item, strategy, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = maskSensitiveData(value, strategy, depth + 1);
    } else {
      result[key] = maskValue(key, value, strategy);
    }
  }

  return result;
}

/**
 * ヘッダー値のマスキング（redaction.ts 互換）。
 */
export const SENSITIVE_HEADER_REASONS = ['authorization'] as const;
export type SensitiveHeaderReason = typeof SENSITIVE_HEADER_REASONS[number];

export function redactHeaderValue(headerValue: string, reason: string): string {
  if ((SENSITIVE_HEADER_REASONS as readonly string[]).includes(reason)) {
    return '[REDACTED]';
  }
  return headerValue;
}

/**
 * セキュアなエラーログ出力（redaction.ts 互換）。
 */
export function consoleSecureError(message: string, data?: unknown): void {
  if (data !== undefined && data !== null) {
    const dataRedacted = maskSensitiveData(data, 'full');
    console.error(message, dataRedacted);
  } else {
    console.error(message);
  }
}
