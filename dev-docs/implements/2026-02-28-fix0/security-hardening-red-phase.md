# TDD Redフェーズ: セキュリティ強化機能

## 作成日時

2026-02-28

## テスト実行コマンド

```bash
npm test -- src/utils/__tests__/masterPassword-rateLimit.test.ts src/background/__tests__/obsidianClient-security.test.ts src/utils/__tests__/logger-production.test.ts src/utils/__tests__/settingsExportImport-signature.test.ts
```

## テスト実行結果

```
FAIL src/utils/__tests__/masterPassword-rateLimit.test.ts
FAIL src/background/__tests__/obsidianClient-security.test.ts
FAIL src/utils/__tests__/logger-production.test.ts
FAIL src/utils/__tests__/settingsExportImport-signature.test.ts
Tests: 4 failed, 5 total
```

## 期待される失敗メッセージ

### masterPassword-rateLimit.test.ts

```
Cannot find module '../rateLimiter.js' from 'src/utils/__tests__/masterPassword-rateLimit.test.ts'
```

**説明**: rateLimiter.js が実装されていないため、モジュールインポートで失敗

### obsidianClient-security.test.ts

```
Cannot find module '../../utils/redaction.js' from 'src/background/__tests__/obsidianClient-security.test.ts'
```

**説明**: redaction.js が実装されていないため、モジュールインポートで失敗

### logger-production.test.ts

```
Expected logger.isDevelopment to be defined
Received: undefined
```

**説明**: logger.ts に環境判定ロジック（isDevelopment）が実装されていない

または:

```
Expected: true
Received: false
```

**説明**: 本番環境でDEBUGログが保存されてしまう（実装前の不良を検出）

### settingsExportImport-signature.test.ts

```
Expected: not null
Received: null
```

**説明**: 署名のない設定ファイルのインポート拒否ロジックが強化されていない

または:

```
Error: Signature verification failed
```

**説明**: テストデータの署名が正しく生成されていない

## テストコード概要

### 1. masterPassword-rateLimit.test.ts

- **テスト対象**: `src/utils/rateLimiter.js`（実装予定）
- **テスト内容**:
  - 初回認証成功時、失敗回数カウンターが増加しない
- **期待する実装**:
  ```typescript
  export async function checkRateLimit(password: string): Promise<{ success: boolean; error?: string }>
  ```
- **失敗理由**: rateLimiter.js モジュールが存在しない

### 2. obsidianClient-security.test.ts

- **テスト対象**: `src/utils/redaction.js`（実装予定）
- **テスト内容**:
  - APIキーがログ出力から除外される
- **期待する実装**:
  ```typescript
  export function redactSensitiveData(data: unknown): unknown
  ```
- **失敗理由**: redaction.js モジュールが存在しない

### 3. logger-production.test.ts

- **テスト対象**: `src/utils/logger.ts`
- **テスト内容**:
  - 本番環境判定ロジックが存在する
  - 本番環境のDEBUGログが保存される（実装前の不良検出）
- **期待する実装**:
  ```typescript
  export const isDevelopment = (): => boolean {
      return process.env.NODE_ENV === 'development';
  }
  ```
- **失敗理由**: 環境判定ロジックが実装されていない

### 4. settingsExportImport-signature.test.ts

- **テスト対象**: `src/utils/settingsExportImport.ts`
- **テスト内容**:
  - 有効な署名付き設定ファイルのインポート成功
  - 署名のないファイルのインポート拒否
- **期待する実装**:
  - 署名なしの場合は即時拒否（警告ダイアログなし）
  - 署名検証失敗時は即時拒否
- **失敗理由**: 現在の実装は署名なしでも警告ダイアログ後にインポート可能

## 各expectステートメントの説明

### masterPassword-rateLimit.test.ts

```typescript
expect(result.success).toBe(true); // 【確認内容】: 認証が成功することを確認 🟢
expect(result.error).toBeUndefined(); // 【確認内容】: エラーが発生していないことを確認 🟢
```

**意図**: checkRateLimit関数が正しく実装されている場合、認証成功時にsuccess:trueを返すことを検証

### obsidianClient-security.test.ts

```typescript
expect(result.fullKey).toBe('[REDACTED]'); // 【確認内容】: redaction済みであることを確認 🟢
expect(result.apiKey).toBe('string'); // 【確認内容】: 型情報が保持されていることを確認 🟢
```

**意図**: redactSensitiveData関数が、機密情報（fullKey）を削除し、型情報（apiKey: 'string'）を保持することを検証

### logger-production.test.ts

```typescript
expect(logger.isDevelopment).toBeDefined(); // 【確認内容】: 環境判定関数が存在することを確認 🟡
expect(logs.some(log => log.type === 'DEBUG')).toBe(true); // 【確認内容】: DEBUGログが保存されている（実装していないため）🟡
```

**意図**: isDevelopment関数の存在確認と、実装前の不良（本番環境でDEBUGが保存されること）の検出

### settingsExportImport-signature.test.ts

```typescript
expect(global.confirm).not.toHaveBeenCalled(); // 【確認内容】: 確認ダイアログが表示されていないことを確認 🟢
expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('署名が含まれていません')); // 【確認内容】: アラート（警告またはエラー）が表示されたことを確認 🟢
```

**意図**: 署名なしファイルのインポート時、確認ダイアログではなく即時エラーアラートが表示されることを検証

## Greenフェーズへの要求事項

### 1. マスターパスワードレート制限実装

**ファイル**: 今後作成 `src/utils/rateLimiter.js`

```typescript
export interface RateLimitState {
  attempts: number;
  firstAttemptTime: number;
  lockedUntil?: number;
}

export const RATE_LIMIT_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;  // 5分
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;  // 30分

export async function checkRateLimit(password: string): Promise<{ success: boolean; error?: string }> {
  const storage = await chrome.storage.session.get(['passwordFailedAttempts', 'firstFailedAttemptTime', 'lockedUntil']);
  const attempts = (storage.passwordFailedAttempts as number) || 0;
  const lockedUntil = (storage.lockedUntil as number) || 0;
  const now = Date.now();

  // ロックアウト中の拒否
  if (lockedUntil && now < lockedUntil) {
    const remainingMinutes = Math.ceil((lockedUntil - now) / (60 * 1000));
    return {
      success: false,
      error: `Too many attempts. Please try again in ${remainingMinutes} minutes.`
    };
  }

  // ロックアウト到達判定
  if (attempts >= RATE_LIMIT_ATTEMPTS) {
    // 5分経過している場合はリセット
    const firstAttempt = (storage.firstFailedAttemptTime as number) || now;
    if (now - firstAttempt > RATE_LIMIT_WINDOW_MS) {
      await resetFailedAttempts();
    } else {
      // ロックアウト発動
      await chrome.storage.session.set({ lockedUntil: now + LOCKOUT_DURATION_MS });
      return {
        success: false,
        error: `Too many attempts. Please try again in ${LOCKOUT_DURATION_MS / (60 * 1000)} minutes.`
      };
    }
  }

  return { success: true };
}

export async function recordFailedAttempt(): Promise<void> {
  const storage = await chrome.storage.session.get(['passwordFailedAttempts', 'firstFailedAttemptTime']);
  const attempts = (storage.passwordFailedAttempts as number) || 0;
  const firstAttempt = (storage.firstFailedAttemptTime as number) || Date.now();

  await chrome.storage.session.set({
    passwordFailedAttempts: attempts + 1,
    firstFailedAttemptTime: firstAttempt,
  });
}

export async function resetFailedAttempts(): Promise<void> {
  await chrome.storage.session.remove(['passwordFailedAttempts', 'firstFailedAttemptTime', 'lockedUntil']);
}
```

**修正点** (`src/popup/popup.ts`):
- authenticatePassword()関数内でrateLimiter.jsの関数を呼び出し

### 2. コンソールログ機密情報削除実装

**ファイル**: 今後作成 `src/utils/redaction.js`

```typescript
const SENSITIVE_KEYS = [
  'apiKey', 'fullKey', 'authToken', 'password',
  'obsidian_api_key', 'gemini_api_key', 'openai_api_key',
  'openai_2_api_key', 'master_password_hash', 'hmac_secret',
];

export function redactSensitiveData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function consoleSecureError(message: string, data?: unknown): void {
  if (data) {
    const dataRedacted = redactSensitiveData(data);
    console.error(message, dataRedacted);
  } else {
    console.error(message);
  }
}
```

**修正点** (`src/background/obsidianClient.ts`):
- 行118-121のconsole.errorを使用している箇所をredaction対応

### 3. デバッグログ本番無効化実装

**ファイル**: `src/utils/logger.ts`（既存ファイルに追加）

```typescript
// 既存コードに以下を追加

export const isDevelopment = (): boolean => {
  return process.env.NODE_ENV === 'development';
};

export async function addLog(type: LogTypeValues, message: string, details: Record<string, any> = {}): Promise<void> {
  try {
    // 本番環境ではDEBUGログを破棄
    if (!isDevelopment() && type === 'DEBUG') {
      return;
    }

    // 既存のログ追加処理...
  } catch (e) {
    // ...
  }
}
```

### 4. 設定ファイル署名強化実装

**ファイル**: `src/utils/settingsExportImport.ts`（既存ファイルに追加/修正）

```typescript
// 既存コードの352-364行を以下のように変更

// 署名があるかチェック
if (!parsed.signature) {
  // 【変更点】：警告ダイアログなしで即時拒否
  console.error('Import rejected: Missing signature.');
  alert('設定ファイルに署名が含まれていません。署名付きのファイルのみインポート可能です。');
  return null; // 旧形式の互換性を削除
}
```

## 次のステップ

**次のお勧めステップ**: `/tdd-green` でGreenフェーズ（最小実装）を開始します。

Greenフェーズでは:
1. `src/utils/rateLimiter.js` を作成
2. `src/utils/redaction.js` を作成
3. `src/utils/logger.ts` に環境判定を追加
4. `src/utils/settingsExportImport.ts` で署名強化
5. テストが全てパスすることを確認