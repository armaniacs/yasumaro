# PBI-03: HMAC 署名鍵を暗号化して保存する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HMAC 署名鍵を `chrome.storage.local` に平文 base64 で保存しないようにし、storage を読める攻撃者による署名偽造を防ぐ。

**Architecture:** マスターパスワードが設定されている場合はそれを KEK とし、ない場合は `chrome.storage.session` または `SubtleCrypto` ラップで保護。旧平文鍵を検出したら暗号化し直すマイグレーションを実装する。

**Tech Stack:** TypeScript, Web Crypto API, Chrome Extension Storage API, Jest

---

### Task 1: 鍵暗号化用の KEK 導出方針を決定・実装する

**Files:**
- Modify: `src/utils/crypto/index.ts` or `src/utils/storage/encryptionSession.ts`

- [ ] **Step 1: 現状の `encryptionSession.ts` を確認する**

Read `src/utils/storage/encryptionSession.ts` lines 130-170.

- [ ] **Step 2: KEK 導出関数を追加する**

```typescript
async function deriveHmacWrappingKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const webcrypto = getWebCrypto();
  const encoder = new TextEncoder();
  const baseKey = await webcrypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ENVELOPE_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "feat(crypto): add KEK derivation for HMAC key wrapping"
```

---

### Task 2: HMAC 鍵の保存を暗号化する

**Files:**
- Modify: `src/utils/crypto/index.ts` (lines 411-449 and 455-496)

- [ ] **Step 1: 鍵の wrap/unwrap 関数を追加する**

```typescript
async function wrapHmacKey(key: CryptoKey, wrappingKey: CryptoKey): Promise<{ wrapped: string; iv: string }> {
  const webcrypto = getWebCrypto();
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const wrapped = await webcrypto.subtle.wrapKey('raw', key, wrappingKey, { name: 'AES-GCM', iv });
  return {
    wrapped: bytesToBase64(new Uint8Array(wrapped)),
    iv: bytesToBase64(iv),
  };
}

async function unwrapHmacKey(wrapped: string, iv: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const webcrypto = getWebCrypto();
  return webcrypto.subtle.unwrapKey(
    'raw',
    base64ToBytes(wrapped) as BufferSource,
    wrappingKey,
    { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource },
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}
```

- [ ] **Step 2: `getConsentHmacKey` を暗号化保存に変更する**

```typescript
export async function getConsentHmacKey(): Promise<CryptoKey> {
  // ... load existing key, if wrapped unwrap it, else generate new key and wrap it
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "feat(crypto): encrypt HMAC keys before storage"
```

---

### Task 3: 平文旧鍵のマイグレーション

**Files:**
- Modify: `src/utils/crypto/index.ts`

- [ ] **Step 1: 平文鍵を検出して暗号化し直す**

```typescript
async function migratePlaintextHmacKey(plainBase64: string, wrappingKey: CryptoKey): Promise<{ wrapped: string; iv: string }> {
  const webcrypto = getWebCrypto();
  const keyData = base64ToUint8Array(plainBase64);
  const key = await webcrypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return wrapHmacKey(key, wrappingKey);
}
```

- [ ] **Step 2: マイグレーションを呼び出し側に統合する**

In `getConsentHmacKey` and `getNotificationHmacKey`, detect old plaintext format and migrate.

- [ ] **Step 3: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "feat(crypto): migrate plaintext HMAC keys to encrypted format"
```

---

### Task 4: settings import の署名検証を定数時間比較に

**Files:**
- Modify: `src/utils/settingsExportImport.ts` (line 395)

- [ ] **Step 1: `constantTimeCompare` を import する**

```typescript
import { constantTimeCompare } from './crypto/index.js';
```

- [ ] **Step 2: 署名比較を置き換える**

```typescript
if (!constantTimeCompare(signature, computedSignature)) {
  // ... existing error handling
  return null;
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/settingsExportImport.ts
git commit -m "fix(settings): use constant-time comparison for import signature"
```

---

### Task 5: テスト追加

**Files:**
- Modify: `src/utils/crypto/__tests__/crypto.test.ts`, `src/utils/__tests__/settingsExportImport.test.ts`

- [ ] **Step 1: HMAC 鍵暗号化テストを追加する**

```typescript
it('stores HMAC keys in encrypted form', async () => {
  await getConsentHmacKey();
  const stored = await chrome.storage.local.get('privacy-consent-signature-key');
  const value = stored['privacy-consent-signature-key'];
  expect(typeof value).toBe('object');
  expect(value).toHaveProperty('wrapped');
  expect(value).toHaveProperty('iv');
});
```

- [ ] **Step 2: 署名偽造テストを追加する**

```typescript
it('rejects forged settings import signature', async () => {
  const forged = JSON.stringify({ settings: {}, signature: 'fake', apiKeyExcluded: false });
  const result = await importSettings(forged);
  expect(result).toBeNull();
});
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/crypto/__tests__/crypto.test.ts src/utils/__tests__/settingsExportImport.test.ts
git commit -m "test(crypto,settings): verify encrypted HMAC keys and signature forgery rejection"
```

---

## Self-Review

- **Spec coverage:** 平文保存防止、マイグレーション、定数時間比較をカバー
- **Placeholder scan:** KEK 導出に具体的手法を指定
- **Type consistency:** `CryptoKey` の使い回しに注意

## Parallelizability

**低**
- PBI-02, PBI-10 と `src/utils/crypto/index.ts` を共有
- マスターパスワード有無で設計が分岐するため、PBI-10 の整理後に実装すると競合が減る
