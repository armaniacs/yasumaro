# PBI-02: 暗号化エンベロープの入力検証を強化する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `decryptEnvelope` において、細工されたエンベロープの過大な `iterations`、弱い `hash`、未来の `version`、巨大な `salt/iv/data` を拒否する。

**Architecture:** `isEncryptionEnvelope` に近い入口で検証を追加し、不正な入力を PBKDF2/WebCrypto に到達する前に弾く。`decryptEnvelope` 内でも防御的に `version` を検証する。

**Tech Stack:** TypeScript, Web Crypto API, Jest

---

### Task 1: 定数と検証関数を追加する

**Files:**
- Modify: `src/utils/crypto/index.ts`

- [ ] **Step 1: 既存の定数位置を確認する**

Read `src/utils/crypto/index.ts` around lines 600-602 to find `CURRENT_ENVELOPE_VERSION`, `ENVELOPE_ITERATIONS`, `ENVELOPE_HASH`.

- [ ] **Step 2: 検証用定数を追加する**

```typescript
const MAX_ENVELOPE_ITERATIONS = ENVELOPE_ITERATIONS * 10; // 6,000,000
const MIN_ENVELOPE_ITERATIONS = 1;
const MAX_ENVELOPE_BASE64_LENGTH = 10 * 1024 * 1024; // 10MB
const ALLOWED_ENVELOPE_HASHES = ['SHA-256'] as const;
```

- [ ] **Step 3: 検証関数を追加する**

```typescript
function validateEnvelope(envelope: EncryptionEnvelope): void {
  if (envelope.version !== CURRENT_ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope version: ${envelope.version}. Expected ${CURRENT_ENVELOPE_VERSION}.`);
  }
  if (envelope.iterations < MIN_ENVELOPE_ITERATIONS || envelope.iterations > MAX_ENVELOPE_ITERATIONS) {
    throw new Error(`Invalid envelope iterations: ${envelope.iterations}`);
  }
  if (!ALLOWED_ENVELOPE_HASHES.includes(envelope.hash as typeof ALLOWED_ENVELOPE_HASHES[number])) {
    throw new Error(`Invalid envelope hash: ${envelope.hash}`);
  }
  for (const field of ['salt', 'iv', 'data'] as const) {
    if (envelope[field].length > MAX_ENVELOPE_BASE64_LENGTH) {
      throw new Error(`Envelope ${field} exceeds maximum length`);
    }
  }
}
```

- [ ] **Step 4: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "feat(crypto): add envelope validation constants and helper"
```

---

### Task 2: isEncryptionEnvelope を強化する

**Files:**
- Modify: `src/utils/crypto/index.ts` (lines 666-678)

- [ ] **Step 1: 既存の型ガードを確認する**

Read `src/utils/crypto/index.ts` lines 666-678.

- [ ] **Step 2: 型ガードに範囲検証を追加する**

```typescript
export function isEncryptionEnvelope(data: unknown): data is EncryptionEnvelope {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (typeof d.iterations !== 'number' || d.iterations < MIN_ENVELOPE_ITERATIONS || d.iterations > MAX_ENVELOPE_ITERATIONS) {
    return false;
  }
  if (typeof d.hash !== 'string' || !ALLOWED_ENVELOPE_HASHES.includes(d.hash as typeof ALLOWED_ENVELOPE_HASHES[number])) {
    return false;
  }
  return (
    typeof d.version === 'number' &&
    d.version === CURRENT_ENVELOPE_VERSION &&
    d.kdf === 'pbkdf2' &&
    typeof d.salt === 'string' &&
    typeof d.iv === 'string' &&
    typeof d.data === 'string'
  );
}
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "feat(crypto): tighten isEncryptionEnvelope validation"
```

---

### Task 3: decryptEnvelope での防御的検証

**Files:**
- Modify: `src/utils/crypto/index.ts` (lines 652-664)

- [ ] **Step 1: decryptEnvelope の先頭で validateEnvelope を呼ぶ**

```typescript
export async function decryptEnvelope(envelope: EncryptionEnvelope, password: string): Promise<string> {
  validateEnvelope(envelope);
  const salt = base64ToBytes(envelope.salt);
  // ... rest unchanged
}
```

- [ ] **Step 2: 型チェックを実行する**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "feat(crypto): validate envelope in decryptEnvelope"
```

---

### Task 4: 異常ケースのテストを追加する

**Files:**
- Modify: `src/utils/crypto/__tests__/crypto.test.ts`

- [ ] **Step 1: 既存テストファイルを確認する**

Read `src/utils/crypto/__tests__/crypto.test.ts` to understand test patterns.

- [ ] **Step 2: 異常エンベロープテストを追加する**

```typescript
describe('decryptEnvelope validation', () => {
  const password = 'test-password';

  it('rejects iterations that are too high', async () => {
    const envelope = await encryptEnvelope('secret', password);
    envelope.iterations = 1_000_000_000;
    await expect(decryptEnvelope(envelope, password)).rejects.toThrow('Invalid envelope iterations');
  });

  it('rejects SHA-1 hash downgrade', async () => {
    const envelope = await encryptEnvelope('secret', password);
    envelope.hash = 'SHA-1';
    await expect(decryptEnvelope(envelope, password)).rejects.toThrow('Invalid envelope hash');
  });

  it('rejects future version', async () => {
    const envelope = await encryptEnvelope('secret', password);
    envelope.version = 999;
    await expect(decryptEnvelope(envelope, password)).rejects.toThrow('Unsupported envelope version');
  });

  it('rejects oversized data', async () => {
    const envelope = await encryptEnvelope('secret', password);
    envelope.data = 'a'.repeat(10 * 1024 * 1024 + 1);
    await expect(decryptEnvelope(envelope, password)).rejects.toThrow('exceeds maximum length');
  });
});
```

- [ ] **Step 3: テストを実行する**

Run: `npm test -- src/utils/crypto/__tests__/crypto.test.ts`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/utils/crypto/__tests__/crypto.test.ts
git commit -m "test(crypto): add envelope validation edge case tests"
```

---

### Task 5: 統合テスト（バックアップインポート経路）

**Files:**
- Modify: `src/dashboard/__tests__/encryptedBackupService.test.ts` or create new test

- [ ] **Step 1: テストファイルを確認する**

Read `src/dashboard/__tests__/encryptedBackupService.test.ts`.

- [ ] **Step 2: 異常エンベロープのインポート拒否テストを追加する**

```typescript
it('rejects import with excessive iterations', async () => {
  const envelope = await createEncryptedBackup(password);
  envelope.iterations = 1_000_000_000;
  const result = await importEncryptedBackup(envelope, password);
  expect(result.success).toBe(false);
});
```

- [ ] **Step 3: テストを実行する**

Run: `npm test -- src/dashboard/__tests__/encryptedBackupService.test.ts`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/dashboard/__tests__/encryptedBackupService.test.ts
git commit -m "test(dashboard): reject oversized iterations in backup import"
```

---

## Self-Review

- **Spec coverage:** iterations 上限/下限、hash 許可リスト、version 検証、base64 長さ上限をすべてカバー
- **Placeholder scan:** 数値は具体例を使用
- **Type consistency:** `EncryptionEnvelope` 型は変更なし

## Parallelizability

**高**
- 変更は `src/utils/crypto/index.ts` 内の独立した関数群に限定
- PBI-03, PBI-10 も crypto を触るが、関数単位で競合は少ない
- テストも独立
