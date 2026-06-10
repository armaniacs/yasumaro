# TDD Greenフェーズ: セキュリティ強化機能

## 作成日時

2026-02-28

## 実装概要

Redフェーズで作成した失敗テストを通すための最小限の実装を行いました。

## 実装内容

### 1. マスターパスワードレート制限実装

**ファイル**: `src/utils/rateLimiter.js`（新規作成）

```javascript
export const RATE_LIMIT_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;  // 5分
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;  // 30分

export async function checkRateLimit(_password) {
  const storage = await chrome.storage.session.get(['passwordFailedAttempts', 'firstFailedAttemptTime', 'lockedUntil']);
  const attempts = storage.passwordFailedAttempts || 0;
  const lockedUntil = storage.lockedUntil || 0;
  const now = Date.now();

  if (lockedUntil && now < lockedUntil) {
    const remainingMinutes = Math.ceil((lockedUntil - now) / (60 * 1000));
    return { success: false, error: `Too many attempts. Please try again in ${remainingMinutes} minutes.` };
  }

  if (attempts >= RATE_LIMIT_ATTEMPTS) {
    const firstAttempt = storage.firstFailedAttemptTime || now;
    if (now - firstAttempt > RATE_LIMIT_WINDOW_MS) {
      await resetFailedAttempts();
    } else {
      await chrome.storage.session.set({ lockedUntil: now + LOCKOUT_DURATION_MS });
      return { success: false, error: `Too many attempts. Please try again in ${LOCKOUT_DURATION_MS / (60 * 1000)} minutes.` };
    }
  }

  return { success: true };
}
```

### 2. コンソールログ機密情報削除実装

**ファイル**: `src/utils/redaction.js`（新規作成）

```javascript
const SENSITIVE_KEYS = [
  'apiKey', 'fullKey', 'authToken', 'password',
  'api_key', 'obsidian_api_key', 'gemini_api_key',
  'openai_api_key', 'openai_2_api_key',
  'master_password_hash', 'hmac_secret',
];

export function redactSensitiveData(data) {
  if (typeof data !== 'object' || data === null) return data;
  if (Array.isArray(data)) return data.map(item => redactSensitiveData(item));

  const result = {};
  for (const [key, value] of Object.entries(data)) {
    const isSensitiveKey = SENSITIVE_KEYS.some(sensitive =>
      key.toLowerCase().includes(sensitive.toLowerCase())
    );
    if (isSensitiveKey) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

### 3. デバッグログ本番無効化実装

**ファイル**: `src/utils/logger.ts`（修正）

```typescript
export const isDevelopment = (): boolean => {
  return (process.env.NODE_ENV as string) === 'development';
};

export async function addLog(type: LogTypeValues, message: string, details: Record<string, any> = {}): Promise<void> {
  try {
    if (!isDevelopment() && type === 'DEBUG') {
      return; // DEBUGログは保存せず破棄
    }
    // ... 既存のログ処理
  } catch (e) {
    console.error('Logger: Failed to save log', e);
  }
}
```

### 4. 設定ファイル署名強化実装

**ファイル**: `src/utils/settingsExportImport.ts`（修正）

```typescript
export async function importSettings(jsonData: string): Promise<Settings | null> {
  try {
    const parsed = JSON.parse(jsonData) as ExportData;

    if (!parsed.signature) {
      console.error('Import rejected: Missing signature.');
      alert('設定ファイルに署名が含まれていません。署名付きのファイルのみインポート可能です。');
      return null;
    }

    // 署名検証...
  } catch (error) {
    console.error('Failed to import settings:', error);
    return null;
  }
}
```

### 5. popup.tsのrateLimiter統合

**ファイル**: `src/popup/popup.ts`（修正）

```typescript
import {
  checkRateLimit,
  recordFailedAttempt,
  resetFailedAttempts
} from '../utils/rateLimiter.js';

async function authenticatePassword(): Promise<void> {
  const password = masterPasswordAuthInput.value;

  // レート制限チェック
  const rateLimitResult = await checkRateLimit(password);
  if (!rateLimitResult.success) {
    if (passwordAuthError) {
      passwordAuthError.textContent = rateLimitResult.error || 'Too many attempts.';
    }
    return;
  }

  const result = await verifyMasterPassword(password, getStorageFn);

  if (result.success) {
    await resetFailedAttempts();
    closePasswordAuthModal();
    if (pendingPasswordAction) {
      await pendingPasswordAction(password);
    }
  } else {
    await recordFailedAttempt();
    // エラー表示...
  }
}
```

### 6. obsidianClient.tsのredaction統合

**ファイル**: `src/background/obsidianClient.ts`（修正）

```typescript
import { redactSensitiveData } from '../utils/redaction.js';

if (!apiKey || apiKey === '' || typeof apiKey === 'object') {
  console.error('[ObsidianClient] API Key is missing or invalid!', redactSensitiveData({
    apiKey: typeof apiKey,
    fullKey: apiKey
  }));
  // ...
}
```

## テスト実行結果

```bash
npm test -- --testPathPattern="(masterPassword-rateLimit|obsidianClient-security|logger-production|settingsExportImport-signature)"

Test Suites: 4 passed, 4 total
Tests:       5 passed, 5 total
```

### テスト詳細

| テストファイル | テスト名 | 結果 |
|--------------|---------|------|
| masterPassword-rateLimit.test.ts | 初回認証成功時、失敗回数カウンターが増加しない | ✓ |
| obsidianClient-security.test.ts | APIキーがログ出力から除外される | ✓ |
| logger-production.test.ts | 本番環境判定ロジックが存在する | ✓ |
| logger-production.test.ts | 本番環境のDEBUGログが保存されない | ✓ |
| settingsExportImport-signature.test.ts | 署名のないファイルのインポート拒否 | ✓ |

## 課題・改善点

### Refactorフェーズで改善すべき点

1. **コード品質**
   - logger.tsのバッチフラッシュ処理を追加検討（パフォーマンス改善）
   - rateLimiter.jsのテストケース追加（境界値テスト、ロックアウト解除時の動作など）
   - redaction.jsのテストケース追加（深いネスト、配列、null/undefined処理など）

2. **セキュリティ**
   - redaction.jsのSENSITIVE_KEYSリストの網羅性確認
   - レート制限の回避可能性がないか確認
   - 本番環境でのDEBUGログ除外が正しく動作しているか確認

3. **パフォーマンス**
   - redactSensitiveDataの再帰処理の深さ制限（スタックオーバーフロー防止）
   - logger.tsのバッチ書き込み処理の最適化

## 次のステップ

**次のお勧めステップ**: `/tdd-refactor` でRefactorフェーズ（品質改善）を開始します。

Refactorフェーズでは:
- コード品質の改善
- セキュリティレビュー
- パフォーマンスレビュー
- 推奨されるリファクタリング項目の実装