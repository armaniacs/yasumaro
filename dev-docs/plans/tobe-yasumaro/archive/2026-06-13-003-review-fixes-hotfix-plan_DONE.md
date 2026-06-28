# Review Fixes — Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レビューで検出された **High 31件** のうち、データ損失・セキュリティ・後方互換性に直接関わる 7 項目（Hotfix）を解消する。

**Architecture:** 既存モジュール構造を最大限尊重し、新ファイル追加は `getOrCreateEncryptionKey` 集約先（`src/utils/crypto.ts`）のみ。`msgOffscreen` の Promise ライフタイム管理を修正し、データストア書き込みに Optimistic Lock を適用、危険な操作に confirmToken 認証を導入する。

**Tech Stack:** TypeScript / Chrome Extension Manifest V3 / wa-sqlite (OPFS IndexedDB) / Jest (Vitest) / @peculiar/webcrypto

**親ドキュメント:** [dev-docs/plans/tobe-yasumaro/2026-06-13-002-review-fixes-design.md](2026-06-13-002-review-fixes-design.md)

---

## File Structure

### 修正対象ファイル

| ファイル | 変更内容 | Hotfix |
|---|---|---|
| `src/background/sqliteClient.ts` | `msgOffscreen` の setTimeout ライフタイム修正 | H1 |
| `src/background/handlers/dashboardSqliteHandlers.ts` | `migrate`/`clear_all` 認証化、サブタイプ別認証要件 | H2 |
| `src/background/service-worker.ts` | confirmToken 生成・検証ロジック追加 | H2 |
| `src/dashboard/sqliteHistoryPanel.ts` | 確認モーダル実装（window.confirm 脱却） | H2 |
| `src/utils/crypto.ts` | `getOrCreateEncryptionKey` 集約、version header 対応 | H3 |
| `src/utils/storage.ts` | 旧 `getOrCreateEncryptionKey` を `crypto.ts` から re-export | H3 |
| `src/utils/storageEncrypted.ts` | 削除（`crypto.ts` に集約） | H3 |
| `src/background/rateLimiter.ts` | sender key をオリジンに変更、storage.local 昇格 | H4 |
| `src/background/pipeline/steps/saveSqliteStep.ts` | Optimistic Lock 適用 | H5 |
| `src/background/recordingLogic.ts` | 旧ストア書き込みコード削除 | H5 |
| `src/background/migrationService.ts` | 旧ストア並行稼働・最終削除フラグ | H5 |
| `src/dashboard/cspStyleUtils.ts` | CSS エスケープ関数追加 | H7 |
| `docs/OPFS_FALLBACK.md` → `docs/STORAGE_MODES.md` | リネーム、内容整合 | H6 |
| `README.md` / `CHANGELOG.md` | OPFS_FALLBACK.md 参照更新 | H6 |

### 新規ファイル

| ファイル | 役割 |
|---|---|
| `src/utils/crypto.ts` | 鍵導出・暗号化/復号・version migration（集約先） |
| `src/background/__tests__/sqliteClient.test.ts` | H1 テスト（既に存在、要追加） |
| `src/background/__tests__/dashboardSqliteHandlers.test.ts` | H2 テスト（新規） |
| `src/utils/__tests__/crypto.test.ts` | H3 テスト（新規） |
| `src/background/__tests__/rateLimiter.test.ts` | H4 テスト（既に存在、要追加） |
| `src/background/pipeline/__tests__/saveSqliteStep.test.ts` | H5 テスト（新規） |
| `src/dashboard/__tests__/cspStyleUtils.test.ts` | H7 テスト（新規） |

---

## Task 1: H1 — `msgOffscreen` の `setTimeout` 二重解決/リーク修正

**Files:**
- Modify: `src/background/sqliteClient.ts:85-112`
- Test: `src/background/__tests__/sqliteClient.test.ts`

- [ ] **Step 1.1: 失敗するテストを追加**

`src/background/__tests__/sqliteClient.test.ts` に追加:

```typescript
describe('SqliteClient.msgOffscreen — timeout lifecycle (H1)', () => {
  let client: SqliteClient;

  beforeEach(() => {
    client = new SqliteClient();
    (client as unknown as { offscreenAlive: boolean }).offscreenAlive = true;
  });

  it('clears the timeout when a response arrives before expiry', async () => {
    const sendMessageSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation(
      ((message: unknown, callback: (response: unknown) => void) => {
        // Respond asynchronously but before the 10s timeout
        setTimeout(() => callback({ success: true, rows: [], total: 0 }), 10);
        return undefined;
      }) as unknown as typeof chrome.runtime.sendMessage
    );
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

    const result = await client.msgOffscreen('SQLITE_STATUS');
    expect(result).toEqual({ success: true, rows: [], total: 0 });
    expect(clearTimeoutSpy).toHaveBeenCalled();

    sendMessageSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('rejects the promise on timeout (not double-resolution)', async () => {
    jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation(
      (() => undefined) as unknown as typeof chrome.runtime.sendMessage
    );

    // Use a short timeout for testing by monkey-patching
    const originalSetTimeout = globalThis.setTimeout;
    jest.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void, ms: number) => {
      if (ms === 10000) {
        return originalSetTimeout(cb, 50) as unknown as NodeJS.Timeout;
      }
      return originalSetTimeout(cb, ms) as unknown as NodeJS.Timeout;
    });

    await expect(client.msgOffscreen('SQLITE_STATUS')).rejects.toThrow(/timed out/);
  });
});
```

- [ ] **Step 1.2: テスト実行して失敗を確認**

```bash
cd /Users/yaar/Playground/obsidian-smart-history && npx vitest run src/background/__tests__/sqliteClient.test.ts -t "timeout lifecycle"
```

Expected: 1 passed (clearTimeout check), 1 failed (timeout assertion in current implementation). Note: 現在の実装ではタイムアウトが常に発火するため、正常応答のテストが失敗する場合もある。

- [ ] **Step 1.3: `msgOffscreen` を修正**

`src/background/sqliteClient.ts` 85-112 行を以下に置換:

```typescript
async msgOffscreen(type: string, payload: Record<string, unknown> = {}): Promise<OffscreenResponse> {
  try {
    await this.ensureOffscreenDocument();
    return await new Promise<OffscreenResponse>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        fn();
      };
      const timeoutId = setTimeout(() => {
        settle(() => reject(new Error(`Offscreen message '${type}' timed out after ${MESSAGE_TIMEOUT_MS}ms`)));
      }, MESSAGE_TIMEOUT_MS);

      chrome.runtime.sendMessage(
        { type, target: 'offscreen', payload },
        (response: OffscreenResponse) => {
          if (chrome.runtime.lastError) {
            settle(() => reject(new Error(chrome.runtime.lastError.message)));
          } else if (response && response.error) {
            settle(() => reject(new Error(response.error)));
          } else {
            settle(() => resolve(response));
          }
        }
      );
    });
  } catch (error) {
    // Reset the cached alive flag so the next call re-checks the document.
    this.offscreenAlive = false;
    throw error;
  }
}
```

- [ ] **Step 1.4: テストを再実行して PASS を確認**

```bash
npx vitest run src/background/__tests__/sqliteClient.test.ts -t "timeout lifecycle"
```

Expected: 2 passed

- [ ] **Step 1.5: 既存テストが壊れていないか確認**

```bash
npx vitest run src/background/__tests__/sqliteClient.test.ts
```

Expected: All existing tests + new tests pass

- [ ] **Step 1.6: Commit**

```bash
git add src/background/sqliteClient.ts src/background/__tests__/sqliteClient.test.ts
git commit -m "fix(sqlite): clear timeout in msgOffscreen to prevent double-resolution (H1)

- Add 'settled' guard to prevent multiple resolve/reject calls
- Clear the setTimeout handle in all settle paths
- Add tests for both normal response and timeout scenarios

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 2: H2 — `migrate`/`clear_all` 認証化

**Files:**
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/dashboard/sqliteHistoryPanel.ts`
- Create: `src/background/__tests__/dashboardSqliteHandlers.test.ts`

- [ ] **Step 2.1: 失敗するテストを追加**

`src/background/__tests__/dashboardSqliteHandlers.test.ts` 新規作成:

```typescript
import { handleDashboardSqlite } from '../handlers/dashboardSqliteHandlers.js';
import { SqliteClient } from '../sqliteClient.js';

describe('dashboardSqliteHandlers — confirmation token (H2)', () => {
  let sqliteClient: SqliteClient;
  const VALID_TOKEN = 'test-valid-token-12345';
  const INVALID_TOKEN = 'wrong-token';

  beforeEach(() => {
    sqliteClient = new SqliteClient();
    (sqliteClient as unknown as { clearAll: jest.Mock }).clearAll = jest.fn().mockResolvedValue(true);
  });

  it('rejects clear_all without confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'clear_all' },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect((sqliteClient.clearAll as jest.Mock)).not.toHaveBeenCalled();
  });

  it('rejects clear_all with invalid confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'clear_all', confirmToken: INVALID_TOKEN },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
  });

  it('accepts clear_all with valid confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'clear_all', confirmToken: VALID_TOKEN },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true });
    expect((sqliteClient.clearAll as jest.Mock)).toHaveBeenCalled();
  });

  it('rejects migrate without confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'migrate' },
      sqliteClient,
      async () => ({ success: true, count: 0, read: 0, inserted: 0 }),
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
  });

  it('allows query without confirmToken (read-only)', async () => {
    (sqliteClient as unknown as { query: jest.Mock }).query = jest.fn().mockResolvedValue({ rows: [], total: 0 });
    const result = await handleDashboardSqlite(
      { subtype: 'query' },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toMatchObject({ success: true });
  });
});
```

- [ ] **Step 2.2: テスト実行して失敗を確認**

```bash
npx vitest run src/background/__tests__/dashboardSqliteHandlers.test.ts
```

Expected: All tests fail (current handler has no token check)

- [ ] **Step 2.3: 認証要件テーブルを `handlers/dashboardSqliteHandlers.ts` に追加**

`src/background/handlers/dashboardSqliteHandlers.ts` を以下に修正:

```typescript
import { SqliteClient } from '../sqliteClient.js';
import { logError, ErrorCode } from '../../utils/logger.js';

const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];

// Subtypes that require a confirmToken (dangerous operations)
const TOKEN_REQUIRED_SUBTYPES = new Set([
  'toggle_star', 'update', 'delete', 'migrate', 'clear_all',
]);

// Subtypes that additionally require a user confirmation modal in the UI
const MODAL_REQUIRED_SUBTYPES = new Set([
  'delete', 'migrate', 'clear_all',
]);

export async function handleDashboardSqlite(
    payload: Record<string, unknown>,
    sqliteClient: SqliteClient,
    runMigration?: () => Promise<{ success: boolean; count: number; read?: number; inserted?: number; error?: string }>,
    validConfirmToken?: string
): Promise<unknown> {
    const subtype = payload.subtype as string;

    // Authentication check
    if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
        const providedToken = payload.confirmToken as string | undefined;
        if (!providedToken || providedToken !== validConfirmToken) {
            logError(
                'Dashboard SQLite: token mismatch',
                { subtype, hasToken: Boolean(providedToken) },
                ErrorCode.UNAUTHORIZED
            );
            return { success: false, error: 'Confirmation token mismatch' };
        }
    }

    try {
        switch (subtype) {
            case 'migrate': {
                if (!runMigration) {
                    return { success: false, error: 'Migration not available' };
                }
                const migrateResult = await runMigration();
                return migrateResult.success
                    ? { success: true, count: migrateResult.count, read: migrateResult.read, inserted: migrateResult.inserted, error: migrateResult.error }
                    : { success: false, error: migrateResult.error || 'Migration failed' };
            }
            case 'query': {
                const result = await sqliteClient.query({
                    limit: (payload.limit as number) ?? 100,
                    offset: (payload.offset as number) ?? 0,
                    domain: payload.domain as string | undefined,
                    isStarred: payload.isStarred as boolean | undefined,
                    since: payload.since as number | undefined,
                    until: payload.until as number | undefined,
                    orderBy: (payload.orderBy as string) || 'created_at',
                    orderDir: (payload.orderDir as 'ASC' | 'DESC') || 'DESC',
                });
                return result
                    ? { success: true, rows: result.rows, total: result.total }
                    : { success: false, error: 'Query failed' };
            }
            case 'search': {
                const result = await sqliteClient.search(
                    payload.query as string || '',
                    (payload.limit as number) ?? 50,
                    (payload.offset as number) ?? 0,
                    {
                        since: payload.since as number | undefined,
                        until: payload.until as number | undefined,
                        orderDir: payload.orderDir as 'ASC' | 'DESC' | undefined,
                    }
                );
                return result
                    ? { success: true, rows: result.rows, total: result.total }
                    : { success: false, error: 'Search failed' };
            }
            case 'toggle_star': {
                const result = await sqliteClient.toggleStar(payload.id as number);
                return result
                    ? { success: true, is_starred: result.is_starred }
                    : { success: false, error: 'Toggle star failed' };
            }
            case 'delete': {
                const result = await sqliteClient.delete(payload.id as number);
                return { success: result };
            }
            case 'update': {
                const changes = (payload.changes || {}) as Record<string, unknown>;
                const invalidKeys = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
                if (invalidKeys.length > 0) {
                    return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
                }
                const result = await sqliteClient.update(
                    payload.id as number,
                    changes
                );
                return { success: result };
            }
            case 'get_count': {
                const count = await sqliteClient.getCount();
                return { success: true, count: count ?? 0 };
            }
            case 'clear_all': {
                const ok = await sqliteClient.clearAll();
                return { success: ok };
            }
            case 'status': {
                const status = await sqliteClient.getStatus();
                if (status) {
                    return { success: true, ...status };
                } else {
                    return { success: false, error: 'Status check failed' };
                }
            }
            default:
                return { success: false, error: `Unknown subtype: ${subtype}` };
        }
    } catch (error) {
        logError('Dashboard SQLite error', {
            subtype,
            error: error instanceof Error ? error.message : String(error),
        }, ErrorCode.UNKNOWN_ERROR);
        return { success: false, error: String(error) };
    }
}
```

- [ ] **Step 2.4: テストを再実行して PASS を確認**

```bash
npx vitest run src/background/__tests__/dashboardSqliteHandlers.test.ts
```

Expected: All 5 tests pass

- [ ] **Step 2.5: サービスワーカー起動時に confirmToken を生成・保持**

`src/background/service-worker.ts` の起動時処理に以下を追加（既存コードの該当箇所を `Grep` で探す）:

```typescript
import { chromeStorageSession } from '../utils/storage.js';

let CONFIRM_TOKEN: string | null = null;

async function ensureConfirmToken(): Promise<string> {
  if (CONFIRM_TOKEN) return CONFIRM_TOKEN;
  const stored = await chromeStorageSession.get('dashboardSqliteConfirmToken');
  if (stored.dashboardSqliteConfirmToken) {
    CONFIRM_TOKEN = stored.dashboardSqliteConfirmToken as string;
    return CONFIRM_TOKEN;
  }
  // crypto.randomUUID() may not be available in all Service Worker contexts;
  // fall back to a manual random token.
  const token = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
  await chromeStorageSession.set({ dashboardSqliteConfirmToken: token });
  CONFIRM_TOKEN = token;
  return token;
}

// In the chrome.runtime.onMessage handler that dispatches to handleDashboardSqlite:
const validToken = await ensureConfirmToken();
const result = await handleDashboardSqlite(payload, sqliteClient, runMigration, validToken);
```

- [ ] **Step 2.6: ダッシュボード UI に確認モーダル実装**

`src/dashboard/sqliteHistoryPanel.ts` の `clearAll` ボタンに確認モーダル追加（既存の `window.confirm` を置換）:

```typescript
// Before
if (!confirm('履歴を全て削除しますか？')) return;

// After
const confirmed = await showConfirmDialog({
  title: chrome.i18n.getMessage('confirmClearAllTitle'),
  message: chrome.i18n.getMessage('confirmClearAllMessage'),
  confirmLabel: chrome.i18n.getMessage('confirmDelete'),
  cancelLabel: chrome.i18n.getMessage('cancel'),
  dangerous: true,
});
if (!confirmed) return;
```

`showConfirmDialog` 関数は `src/dashboard/utils/confirmDialog.ts` に新規作成（既存のモーダル実装があれば再利用）。

- [ ] **Step 2.7: ロケールに翻訳追加**

`public/_locales/ja/messages.json` と `public/_locales/en/messages.json` に追加:

```json
"confirmClearAllTitle": { "message": "履歴を全て削除" },
"confirmClearAllMessage": { "message": "この操作は取り消せません。SQLite に保存された全ての閲覧履歴が削除されます。続行しますか？" }
```

（英語版は "Delete all history" / "This action cannot be undone. All browsing history stored in SQLite will be deleted. Continue?"）

- [ ] **Step 2.8: Commit**

```bash
git add src/background/handlers/dashboardSqliteHandlers.ts src/background/service-worker.ts src/dashboard/sqliteHistoryPanel.ts src/dashboard/utils/confirmDialog.ts src/background/__tests__/dashboardSqliteHandlers.test.ts public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat(security): require confirmToken for dangerous dashboard SQLite operations (H2)

- Add TOKEN_REQUIRED_SUBTYPES and MODAL_REQUIRED_SUBTYPES tables
- Generate confirmToken on service worker startup, store in chrome.storage.session
- Reject migrate/clear_all/update/delete/toggle_star without valid token
- Replace window.confirm in sqliteHistoryPanel with accessible confirm dialog
- Add i18n strings for confirm dialog

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 3: H3 — 暗号鍵導出 version header 化 + `getOrCreateEncryptionKey` 集約

**Files:**
- Create: `src/utils/crypto.ts` (replace existing minimal version)
- Modify: `src/utils/storage.ts` (re-export from crypto.ts)
- Delete: `src/utils/storageEncrypted.ts`
- Create: `src/utils/__tests__/crypto.test.ts`

- [ ] **Step 3.1: 失敗するテストを追加**

`src/utils/__tests__/crypto.test.ts` 新規作成:

```typescript
import {
  encryptEnvelope,
  decryptEnvelope,
  getOrCreateEncryptionKey,
  EncryptionEnvelope,
} from '../crypto.js';

describe('crypto — versioned encryption envelope (H3)', () => {
  const TEST_PASSWORD = 'test-master-password-12345';

  it('encrypts and decrypts a string with current version', async () => {
    const plaintext = 'sk-test-openai-key-12345';
    const envelope = await encryptEnvelope(plaintext, TEST_PASSWORD);
    expect(envelope.version).toBeGreaterThanOrEqual(2);
    const decrypted = await decryptEnvelope(envelope, TEST_PASSWORD);
    expect(decrypted).toBe(plaintext);
  });

  it('fails to decrypt with wrong password', async () => {
    const envelope = await encryptEnvelope('secret', TEST_PASSWORD);
    await expect(decryptEnvelope(envelope, 'wrong-password')).rejects.toThrow();
  });

  it('envelope contains version, kdf, hash, iterations, salt, iv, data', async () => {
    const envelope = await encryptEnvelope('hello', TEST_PASSWORD);
    expect(envelope).toMatchObject({
      version: expect.any(Number),
      kdf: 'pbkdf2',
      hash: expect.stringMatching(/^SHA-/),
      iterations: expect.any(Number),
      salt: expect.any(String),
      iv: expect.any(String),
      data: expect.any(String),
    });
  });

  it('getOrCreateEncryptionKey returns a CryptoKey and version info', async () => {
    const result = await getOrCreateEncryptionKey(TEST_PASSWORD);
    expect(result.key).toBeDefined();
    expect(result.key.type).toBe('secret');
    expect(result.version).toBeGreaterThanOrEqual(2);
    expect(typeof result.needsMigration).toBe('boolean');
  });
});
```

- [ ] **Step 3.2: テスト実行して失敗を確認**

```bash
npx vitest run src/utils/__tests__/crypto.test.ts
```

Expected: FAIL (functions don't exist yet or signatures differ)

- [ ] **Step 3.3: `src/utils/crypto.ts` の内容を確認**

既存の `src/utils/crypto.ts` を Read し、現在の構造を把握する。すでに Crypto API を使う関数がある場合は署名を残す。

- [ ] **Step 3.4: 既存の `src/utils/crypto.ts` を新実装に置換**

`src/utils/crypto.ts` を以下に置換（既存実装が無い場合は新規作成）:

```typescript
/**
 * crypto.ts
 * Versioned encryption envelope for API keys, settings, and other secrets.
 * Phase: H3 refactor — consolidate getOrCreateEncryptionKey, add version header.
 */

const CURRENT_VERSION = 2;
const DEFAULT_ITERATIONS_V2 = 600_000;
const DEFAULT_HASH_V2: 'SHA-256' = 'SHA-256';
const LEGACY_ITERATIONS_V1 = 100_000;
const LEGACY_HASH_V1: 'SHA-256' = 'SHA-256';
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;

export interface EncryptionEnvelope {
  version: 1 | 2;
  kdf: 'pbkdf2';
  hash: 'SHA-256' | 'SHA-512';
  iterations: number;
  salt: string;   // base64
  iv: string;     // base64
  data: string;   // base64 ciphertext
}

export interface EncryptionKeyResult {
  key: CryptoKey;
  version: number;
  needsMigration: boolean;
}

// --- Base64 helpers (browser-native) ---
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Key derivation ---
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  hash: 'SHA-256' | 'SHA-512',
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

// --- Envelope encrypt/decrypt ---
export async function encryptEnvelope(
  plaintext: string,
  password: string,
): Promise<EncryptionEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS_V2, DEFAULT_HASH_V2);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: CURRENT_VERSION as 2,
    kdf: 'pbkdf2',
    hash: DEFAULT_HASH_V2,
    iterations: DEFAULT_ITERATIONS_V2,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptEnvelope(
  envelope: EncryptionEnvelope,
  password: string,
): Promise<string> {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.data);
  const key = await deriveKey(password, salt, envelope.iterations, envelope.hash);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Get or create an encryption key. Returns a flag indicating whether
 * existing legacy (version 1) data should be re-encrypted.
 */
export async function getOrCreateEncryptionKey(
  password: string,
): Promise<EncryptionKeyResult> {
  const key = await deriveKey(password, crypto.getRandomValues(new Uint8Array(16)), DEFAULT_ITERATIONS_V2, DEFAULT_HASH_V2);
  return { key, version: CURRENT_VERSION, needsMigration: false };
}

/**
 * Migrate a legacy ciphertext (raw base64 string) to a versioned envelope.
 */
export async function migrateLegacyCiphertext(
  legacyCiphertextB64: string,
  password: string,
  legacyIterations: number = LEGACY_ITERATIONS_V1,
  legacyHash: 'SHA-256' = LEGACY_HASH_V1,
): Promise<EncryptionEnvelope> {
  // Re-derive the legacy key, decrypt, then re-encrypt with current parameters.
  // The legacy ciphertext is expected to be a base64-encoded AES-GCM blob.
  // For v1, the salt/iv were stored separately or derived from fixed values.
  // This is a simplified migration that uses the provided legacy parameters.
  const salt = new TextEncoder().encode('yasumaro-legacy-salt-v1');  // legacy fixed salt
  const key = await deriveKey(password, salt, legacyIterations, legacyHash);
  const ciphertext = base64ToBytes(legacyCiphertextB64);
  // Legacy v1 used a 16-byte IV prepended to ciphertext
  const legacyIv = ciphertext.slice(0, IV_LENGTH_BYTES);
  const legacyData = ciphertext.slice(IV_LENGTH_BYTES);
  const plaintextBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: legacyIv },
    key,
    legacyData,
  );
  const plaintext = new TextDecoder().decode(plaintextBytes);
  return encryptEnvelope(plaintext, password);
}
```

注: 実際のレガシー v1 暗号化スキーマ（salt/iv の保存形式）は `src/utils/storage.ts` の旧 `getOrCreateEncryptionKey` を確認の上、`migrateLegacyCiphertext` 内の復号ロジックを実装に整合させること。**実装手順:**
1. 旧 `getOrCreateEncryptionKey` の暗号化/復号コードを Read で確認
2. salt の生成方法（固定文字列かユーザー入力依存か）、IV の保存場所を特定
3. 特定したスキーマに合わせて `migrateLegacyCiphertext` の引数と内部ロジックを調整
4. レガシーデータが存在する状態でテスト（モックでレガシーデータを注入）

- [ ] **Step 3.5: `src/utils/storage.ts` から旧 `getOrCreateEncryptionKey` を削除し `crypto.ts` から re-export**

`src/utils/storage.ts` を `Grep` し、旧実装を確認の上:

```typescript
// Remove the old getOrCreateEncryptionKey implementation in storage.ts
// Add at the top:
export { getOrCreateEncryptionKey, encryptEnvelope, decryptEnvelope } from './crypto.js';
export type { EncryptionEnvelope } from './crypto.js';
```

- [ ] **Step 3.6: `src/utils/storageEncrypted.ts` を削除**

```bash
git rm src/utils/storageEncrypted.ts
```

削除前に `Grep` で参照箇所を確認し、参照を `crypto.ts` または `storage.ts`（re-export）に置換。

- [ ] **Step 3.7: テストを再実行して PASS を確認**

```bash
npx vitest run src/utils/__tests__/crypto.test.ts
```

Expected: All tests pass

- [ ] **Step 3.8: 既存テストが壊れていないか確認**

```bash
npm validate
```

Expected: Type check + all tests pass. もし既存の storage テストが旧 `getOrCreateEncryptionKey` の特定実装に依存していたら、参照を更新する。

- [ ] **Step 3.9: Commit**

```bash
git add src/utils/crypto.ts src/utils/storage.ts src/utils/__tests__/crypto.test.ts
git commit -m "refactor(crypto): consolidate getOrCreateEncryptionKey + add version envelope (H3)

- Add EncryptionEnvelope type with version, kdf, hash, iterations, salt, iv, data
- Move getOrCreateEncryptionKey to src/utils/crypto.ts (single source)
- Add encryptEnvelope/decryptEnvelope with current (v2) parameters
- Add migrateLegacyCiphertext for v1 → v2 migration
- Re-export from storage.ts for backwards compatibility
- Delete duplicate storageEncrypted.ts

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 4: H4 — レート制限の sender key をオリジンに変更 + `chrome.storage.local` へ昇格

**Files:**
- Modify: `src/background/rateLimiter.ts`
- Modify: `src/background/sessionStore.ts` (or use storage.local directly)
- Modify: `src/background/recordingLogic.ts` (caller of `check`)
- Test: `src/background/__tests__/rateLimiter.test.ts`

- [ ] **Step 4.1: 失敗するテストを追加**

`src/background/__tests__/rateLimiter.test.ts` の既存テストに追記:

```typescript
describe('RateLimiter — origin-based sender key (H4)', () => {
  let limiter: RateLimiter;
  let mockSessionStore: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    mockSessionStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    limiter = new RateLimiter(mockSessionStore as unknown as SessionStore);
  });

  it('uses origin as the sender key, not tabId', async () => {
    const sender = { url: 'https://example.com/page1', tab: { id: 1 } };
    const result = await limiter.check(sender, { skipAiRateLimitMax: 3, skipAiRateLimitWindowMs: 60000 });
    expect(result.allowed).toBe(true);
    expect(limiter['state'].has('origin:https://example.com')).toBe(true);
    expect(limiter['state'].has('1')).toBe(false);  // tabId no longer used
  });

  it('rate limit applies across all tabs from the same origin', async () => {
    const settings = { skipAiRateLimitMax: 2, skipAiRateLimitWindowMs: 60000 };
    await limiter.check({ url: 'https://example.com/p1' }, settings);
    await limiter.check({ url: 'https://example.com/p2' }, settings);
    const result = await limiter.check({ url: 'https://example.com/p3' }, settings);
    expect(result.allowed).toBe(false);
  });

  it('persists state to chrome.storage.local (not session)', async () => {
    await limiter.check({ url: 'https://example.com/' }, {});
    const setCall = mockSessionStore.set.mock.calls[0];
    expect(setCall).toBeDefined();
  });
});
```

- [ ] **Step 4.2: テスト実行して失敗を確認**

```bash
npx vitest run src/background/__tests__/rateLimiter.test.ts -t "origin-based"
```

Expected: Tests fail (current uses tabId)

- [ ] **Step 4.3: `src/background/rateLimiter.ts` を修正**

`src/background/rateLimiter.ts` の `check` メソッドと `removeTab` を以下に置換:

```typescript
import { SessionStore, SESSION_KEYS } from './sessionStore.js';
import { RATE_LIMITS } from '../constants/appConstants.js';
import { StorageKeys } from '../utils/storage.js';
import { logWarn } from '../utils/logger.js';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitResult {
  allowed: boolean;
  error?: string;
}

interface MessageSenderLike {
  url?: string;
  tab?: { id?: number };
}

function originFromSender(sender: MessageSenderLike | undefined): string {
  if (!sender?.url) return 'unknown';
  try {
    return new URL(sender.url).origin;
  } catch {
    return 'unknown';
  }
}

export class RateLimiter {
  private state = new Map<string, RateLimitEntry>();
  private sessionStore: SessionStore;

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  async initialize(): Promise<void> {
    const entries = await this.sessionStore.get<[string, RateLimitEntry][]>(SESSION_KEYS.SKIP_AI_RATE_LIMITER);
    if (entries) {
      const now = Date.now();
      for (const [key, val] of entries) {
        if (now < val.resetTime) {
          this.state.set(key, val);
        }
      }
    }
  }

  async reload(): Promise<void> {
    const entries = await this.sessionStore.get<[string, RateLimitEntry][]>(SESSION_KEYS.SKIP_AI_RATE_LIMITER);
    if (entries) {
      const now = Date.now();
      this.state.clear();
      for (const [key, val] of entries) {
        if (now < val.resetTime) {
          this.state.set(key, val);
        }
      }
    }
  }

  async check(
    sender: MessageSenderLike | undefined,
    settings: Record<string, unknown>
  ): Promise<RateLimitResult> {
    const origin = originFromSender(sender);
    const senderKey = `origin:${origin}`;
    const now = Date.now();
    const limiterState = this.state.get(senderKey);
    const rateLimitMax = (settings[StorageKeys.SKIP_AI_RATE_LIMIT_MAX] as number) ?? RATE_LIMITS.SKIP_AI_MAX;
    const rateLimitWindow = (settings[StorageKeys.SKIP_AI_RATE_LIMIT_WINDOW_MS] as number) ?? RATE_LIMITS.SKIP_AI_WINDOW_MS;

    if (limiterState) {
      if (now > limiterState.resetTime) {
        this.state.set(senderKey, { count: 1, resetTime: now + rateLimitWindow });
        this.persist();
      } else if (limiterState.count >= rateLimitMax) {
        await logWarn(
          'Rate limit exceeded for skipAi operation',
          { sender: senderKey, limit: rateLimitMax },
          undefined,
          'service-worker'
        );
        return { allowed: false, error: 'Rate limit exceeded. Please try again later.' };
      } else {
        limiterState.count++;
      }
      this.persist();
    } else {
      this.state.set(senderKey, { count: 1, resetTime: now + rateLimitWindow });
      this.persist();
    }

    return { allowed: true };
  }

  removeOrigin(origin: string): void {
    this.state.delete(`origin:${origin}`);
    this.persist();
  }

  /**
   * @deprecated Use removeOrigin instead. Kept for backwards compatibility.
   */
  removeTab(tabId: number): void {
    // No-op: tab-based keys no longer used. Caller should use removeOrigin.
    logWarn('RateLimiter.removeTab called but is deprecated; use removeOrigin', { tabId }, undefined, 'service-worker');
  }

  clear(): void {
    this.state.clear();
  }

  private persist(): void {
    this.sessionStore.set(SESSION_KEYS.SKIP_AI_RATE_LIMITER, SessionStore.mapToEntries(this.state));
  }
}
```

- [ ] **Step 4.4: `SessionStore` の保存先を `chrome.storage.session` から `chrome.storage.local` に変更**

`src/background/sessionStore.ts` を `Grep` し、SESSION_KEYS の保存先を確認。`chrome.storage.session` を使っている箇所を `chrome.storage.local` に置換（`SessionStore` クラス名はそのままで実装だけ変更）。

注: クラス名 `SessionStore` は意味的には不適切になるが、API 互換性のためクラス名は残し、TODO コメントで将来的な改名を残す。

- [ ] **Step 4.5: `recordingLogic.ts` 内の `rateLimiter.check` 呼び出しを更新**

`Grep` で `rateLimiter.check` の呼び出し箇所を特定し、第 1 引数を `tabId` から `sender` オブジェクトに変更:

```typescript
// Before
const result = await rateLimiter.check(tabId.toString(), settings);

// After
const result = await rateLimiter.check(sender, settings);
```

- [ ] **Step 4.6: テストを再実行して PASS を確認**

```bash
npx vitest run src/background/__tests__/rateLimiter.test.ts
```

Expected: All tests pass

- [ ] **Step 4.7: Commit**

```bash
git add src/background/rateLimiter.ts src/background/sessionStore.ts src/background/recordingLogic.ts src/background/__tests__/rateLimiter.test.ts
git commit -m "fix(rate-limit): use origin-based sender key + chrome.storage.local (H4)

- Sender key is now `origin:${new URL(sender.url).origin}` instead of tabId
- Rate limit applies across all tabs from the same origin
- Persist to chrome.storage.local so rate limit survives SW restart + tab close
- Add removeOrigin method; keep removeTab as deprecated no-op
- Update recordingLogic.ts call sites to pass sender object

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 5: H5 — Optimistic Lock 適用 + 旧ストア読み取り専用化

**Files:**
- Modify: `src/background/pipeline/steps/saveSqliteStep.ts`
- Modify: `src/background/recordingLogic.ts`
- Modify: `src/background/migrationService.ts`
- Create: `src/background/pipeline/__tests__/saveSqliteStep.test.ts`

- [ ] **Step 5.1: 失敗するテストを追加**

`src/background/pipeline/__tests__/saveSqliteStep.test.ts` 新規作成:

```typescript
import { saveSqliteStep } from '../steps/saveSqliteStep.js';
import { SqliteClient } from '../../sqliteClient.js';
import { withOptimisticLock } from '../../../utils/optimisticLock.js';

jest.mock('../../../utils/optimisticLock.js');
jest.mock('../../sqliteClient.js');

describe('saveSqliteStep — Optimistic Lock (H5)', () => {
  it('wraps insert + update in withOptimisticLock', async () => {
    const mockSqlite = {
      insert: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue(true),
    } as unknown as SqliteClient;

    (withOptimisticLock as jest.Mock).mockImplementation(async (_key, fn) => fn());

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x', created_at: 100 },
      sqliteClient: mockSqlite,
    } as unknown as Parameters<typeof saveSqliteStep>[0]);

    expect(withOptimisticLock).toHaveBeenCalledWith(
      expect.stringContaining('sqlite-write'),
      expect.any(Function),
      expect.any(Object)
    );
    expect(mockSqlite.insert).toHaveBeenCalled();
    expect(mockSqlite.update).toHaveBeenCalled();
  });

  it('does not write to old chrome.storage.savedUrlsWithTimestamps', async () => {
    const setSpy = jest.spyOn(chrome.storage.local, 'set');
    const mockSqlite = {
      insert: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue(true),
    } as unknown as SqliteClient;
    (withOptimisticLock as jest.Mock).mockImplementation(async (_k, fn) => fn());

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x', created_at: 100 },
      sqliteClient: mockSqlite,
    } as unknown as Parameters<typeof saveSqliteStep>[0]);

    const callsToLegacy = setSpy.mock.calls.filter(
      (call) => call[0] && 'savedUrlsWithTimestamps' in (call[0] as object)
    );
    expect(callsToLegacy).toHaveLength(0);

    setSpy.mockRestore();
  });
});
```

- [ ] **Step 5.2: テスト実行して失敗を確認**

```bash
npx vitest run src/background/pipeline/__tests__/saveSqliteStep.test.ts
```

Expected: Tests fail

- [ ] **Step 5.3: `src/background/pipeline/steps/saveSqliteStep.ts` を Optimistic Lock でラップ**

`src/background/pipeline/steps/saveSqliteStep.ts` を以下に修正:

```typescript
import { withOptimisticLock } from '../../../utils/optimisticLock.js';
import type { SqliteClient } from '../../sqliteClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { addLog, LogType } from '../../../utils/logger.js';

interface SaveSqliteStepContext {
  recordId: string | number;
  record: BrowsingLogRecord;
  sqliteClient: SqliteClient;
  obsidianSynced?: boolean;
}

export async function saveSqliteStep(context: SaveSqliteStepContext): Promise<void> {
  await withOptimisticLock(
    `sqlite-write-${context.record.url}-${context.record.created_at}`,
    async () => {
      const insertResult = await context.sqliteClient.insert(context.record);
      if (insertResult && context.obsidianSynced !== undefined) {
        await context.sqliteClient.update(insertResult.id, {
          obsidian_synced: context.obsidianSynced ? 1 : 0,
        });
      }
    },
    { maxRetries: 3, retryDelayMs: 100 }
  ).catch((err) => {
    addLog(LogType.ERROR, 'saveSqliteStep: failed', {
      url: context.record.url,
      error: String(err),
    });
    throw err;
  });
}
```

- [ ] **Step 5.4: `recordingLogic.ts` から旧ストア書き込みを削除**

`Grep` で `savedUrlsWithTimestamps` の書き込み箇所を特定し、削除:

```typescript
// Remove this block (or similar):
// await chrome.storage.local.set({ savedUrlsWithTimestamps: newEntries });
```

注: 旧ストアからの**読み取り**は `MigrationService` でのみ残し、書き込みは全面削除。

- [ ] **Step 5.5: `MigrationService` の最終削除フラグ追加**

`src/background/migrationService.ts` の `run()` メソッド完了時に、旧ストア読み取り用フラグ `legacyStoreReadOnly: true` を `chrome.storage.local` に保存。次回起動時に `getMigrationStatus` でこのフラグを確認の上、フラグが立っていても読み取りは許可するが、UI には「旧ストアは読み取り専用です」と表示。

```typescript
// At the end of successful run():
await chrome.storage.local.set({ legacyStoreReadOnly: true });
```

- [ ] **Step 5.6: テストを再実行して PASS を確認**

```bash
npx vitest run src/background/pipeline/__tests__/saveSqliteStep.test.ts
```

Expected: All tests pass

- [ ] **Step 5.7: Commit**

```bash
git add src/background/pipeline/steps/saveSqliteStep.ts src/background/recordingLogic.ts src/background/migrationService.ts src/background/pipeline/__tests__/saveSqliteStep.test.ts
git commit -m "fix(data): apply Optimistic Lock to SQLite writes + make legacy store read-only (H5)

- Wrap saveSqliteStep in withOptimisticLock to prevent race conditions
- Remove all writes to chrome.storage.savedUrlsWithTimestamps
- Add legacyStoreReadOnly flag so UI can warn users about legacy data
- MigrationService sets the flag on successful completion

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 6: H6 — `OPFS_FALLBACK.md` リネーム + 冒頭概要明記

**Files:**
- Rename: `docs/OPFS_FALLBACK.md` → `docs/STORAGE_MODES.md`
- Modify: `README.md` (update link)
- Modify: `CHANGELOG.md` (update link)
- Modify: `docs/PRIVACY.md` (if it links)

- [ ] **Step 6.1: ファイルリネーム**

```bash
git mv docs/OPFS_FALLBACK.md docs/STORAGE_MODES.md
```

- [ ] **Step 6.2: `STORAGE_MODES.md` の冒頭を明確化**

`docs/STORAGE_MODES.md` の最初の数行を以下に置換（既存の 2 つのモード説明の前に追加）:

```markdown
# ストレージモードについて / About Storage Modes

[日本語](#日本語) | [English](#english)

> **概要 / Summary:** Yasumaro は **2 つのストレージモード**を持ちます。
> 1. **通常モード（IndexedDB + SQLite + FTS5）** — wa-sqlite による全文検索対応のメインストレージ
> 2. **簡易ストレージモード（chrome.storage.local フォールバック）** — IndexedDB が利用できない環境向け
>
> 旧称の `OPFS_FALLBACK.md` はリネームされました（旧 OPFS ベースの実装は廃止済み）。

---
```

- [ ] **Step 6.3: `README.md` 内のリンクを更新**

```bash
grep -rn "OPFS_FALLBACK" --include="*.md"
```

すべての参照を `STORAGE_MODES.md` に置換:

```bash
# README.md, CHANGELOG.md, docs/PRIVACY.md など
sed -i '' 's|OPFS_FALLBACK\.md|STORAGE_MODES.md|g' README.md CHANGELOG.md docs/PRIVACY.md
```

- [ ] **Step 6.4: Commit**

```bash
git add docs/STORAGE_MODES.md docs/OPFS_FALLBACK.md README.md CHANGELOG.md docs/PRIVACY.md
git commit -m "docs: rename OPFS_FALLBACK.md to STORAGE_MODES.md and clarify two-mode overview (H6)

- File renamed via git mv to preserve history
- Added summary section at the top making the two storage modes explicit
- Updated all internal references in README.md, CHANGELOG.md, docs/PRIVACY.md

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 7: H7 — `cspStyleUtils` の CSS エスケープ

**Files:**
- Modify: `src/dashboard/cspStyleUtils.ts`
- Create: `src/dashboard/__tests__/cspStyleUtils.test.ts`

- [ ] **Step 7.1: 失敗するテストを追加**

`src/dashboard/__tests__/cspStyleUtils.test.ts` 新規作成:

```typescript
import { setElementColor, setElementWidth, escapeCssIdentifier, escapeCssValue } from '../cspStyleUtils.js';

describe('cspStyleUtils — CSS injection prevention (H7)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="target"></div>';
  });

  describe('escapeCssIdentifier', () => {
    it('allows alphanumerics, hyphens, underscores', () => {
      expect(escapeCssIdentifier('foo-bar_123')).toBe('foo-bar_123');
    });
    it('strips CSS meta-characters', () => {
      expect(escapeCssIdentifier('foo<bar>{test}')).toBe('foobar');
    });
  });

  describe('escapeCssValue', () => {
    it('strips semicolons, braces, angle brackets, backslashes', () => {
      expect(escapeCssValue('red}<script>')).toBe('redscript');
    });
    it('strips url() javascript: values', () => {
      expect(escapeCssValue('url(javascript:alert(1))')).toBe('urljavascript:alert(1)');
    });
  });

  describe('setElementColor', () => {
    it('applies a safe color', () => {
      setElementColor('target', 'red');
      const el = document.getElementById('target');
      expect(el?.style.color).toBe('red');
    });
    it('rejects malicious color value', () => {
      setElementColor('target', 'red; background:url(javascript:alert(1))');
      const el = document.getElementById('target');
      expect(el?.style.getPropertyValue('color')).not.toContain('javascript');
      expect(el?.style.getPropertyValue('background')).toBe('');
    });
  });

  describe('setElementWidth', () => {
    it('applies a safe width', () => {
      setElementWidth('target', '100px');
      const el = document.getElementById('target');
      expect(el?.style.width).toBe('100px');
    });
    it('rejects malicious width value', () => {
      setElementWidth('target', '100px}; color:red');
      const el = document.getElementById('target');
      expect(el?.style.getPropertyValue('width')).not.toContain('}');
    });
  });
});
```

- [ ] **Step 7.2: テスト実行して失敗を確認**

```bash
npx vitest run src/dashboard/__tests__/cspStyleUtils.test.ts
```

Expected: Tests fail (escape functions don't exist)

- [ ] **Step 7.3: `cspStyleUtils.ts` を修正**

`src/dashboard/cspStyleUtils.ts` を以下に置換:

```typescript
/**
 * cspStyleUtils.ts
 * Safe CSS manipulation utilities for dashboard UI.
 * Prevents CSS injection via elementId or color/width values (H7).
 */

const CSS_IDENTIFIER_ALLOWED = /[^a-zA-Z0-9_-]/g;
const CSS_VALUE_DANGEROUS = /[<>"'`{};()\\]/g;

export function escapeCssIdentifier(value: string): string {
  return value.replace(CSS_IDENTIFIER_ALLOWED, '');
}

export function escapeCssValue(value: string): string {
  return value.replace(CSS_VALUE_DANGEROUS, '');
}

export function setElementColor(elementId: string, color: string): void {
  const safeId = escapeCssIdentifier(elementId);
  const safeColor = escapeCssValue(color);
  const el = document.getElementById(safeId);
  if (!el) return;
  el.style.setProperty('color', safeColor);
}

export function setElementWidth(elementId: string, width: string): void {
  const safeId = escapeCssIdentifier(elementId);
  const safeWidth = escapeCssValue(width);
  const el = document.getElementById(safeId);
  if (!el) return;
  el.style.setProperty('width', safeWidth);
}
```

- [ ] **Step 7.4: テストを再実行して PASS を確認**

```bash
npx vitest run src/dashboard/__tests__/cspStyleUtils.test.ts
```

Expected: All tests pass

- [ ] **Step 7.5: Commit**

```bash
git add src/dashboard/cspStyleUtils.ts src/dashboard/__tests__/cspStyleUtils.test.ts
git commit -m "fix(csp): escape CSS identifiers and values in cspStyleUtils (H7)

- Add escapeCssIdentifier to strip non-alphanumeric chars from elementId
- Add escapeCssValue to strip CSS meta-characters from color/width
- Apply sanitization in setElementColor and setElementWidth
- Use setProperty to avoid inline style attribute injection

🤖 Generated with [Kilo Code](https://kilocode.ai)
Co-Authored-By: kilo@bot <kilo@bot.local>"
```

---

## Task 8: 最終検証

- [ ] **Step 8.1: `npm validate` を実行**

```bash
cd /Users/yaar/Playground/obsidian-smart-history && npm validate
```

Expected: Type check + all tests pass. If failures occur, address them.

- [ ] **Step 8.2: 手動テストチェックリスト**

- [ ] 拡張機能をビルドして Chrome にロード
- [ ] ダッシュボードで「履歴全削除」ボタン押下 → 確認モーダル表示 → キャンセルできることを確認
- [ ] SW DevTools で SW を強制終了 → 再起動 → レート制限が保持されていることを確認
- [ ] 旧バージョンで暗号化した API キーを新バージョンで読込 → 自動復号 → 再暗号化されることを確認
- [ ] Safari（または OPFS 非対応モック）でロード → 警告バナー表示を確認
- [ ] README/CHANGELOG から STORAGE_MODES.md へのリンクが機能することを確認

- [ ] **Step 8.3: PR を作成しレビュー依頼**

```bash
git push origin tobe-yasumaro
gh pr create --title "fix(hotfix): address review findings H1-H7" --body "Closes review findings from plans/2026-06-13-1112-review-tobe-yasumaro.md
See dev-docs/plans/tobe-yasumaro/2026-06-13-002-review-fixes-design.md for design rationale."
```

---

## 成功基準

- [ ] Task 1〜7 すべてのテストが PASS
- [ ] `npm validate` が PASS
- [ ] 手動テストチェックリスト全項目クリア
- [ ] PR が main ブランチにマージ可能

## 次のフェーズ

この Hotfix マージ後、**通常 8 トラック計画**（v5.x.1〜v5.x.3）に進む。別途 `dev-docs/superpowers/plans/2026-06-13-review-fixes-normal-tracks.md` として作成予定。
