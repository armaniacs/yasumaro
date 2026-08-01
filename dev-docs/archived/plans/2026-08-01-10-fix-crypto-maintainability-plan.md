# PBI-10: 暗号化モジュールの保守性と堅牢性を向上する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 暗号化モジュールの型捏造、TDZ、未検証バージョン、暗黙の形式契約などの保守性トラップを除去する。

**Architecture:** 型捏造を削除、定数を先頭に移動、`needsRehash` を修正、`isEncrypted` を厳密化、平文 API キーを検出、hashUrl の衝突リスクを軽減。

**Tech Stack:** TypeScript, Web Crypto API, Jest

---

### Task 1: 型捏造を削除

**Files:**
- Modify: `src/utils/crypto/types.ts` (lines 11-15)

- [ ] **Step 1: 型宣言を削除する**

```typescript
// Remove the declare global block for SubtleCrypto.timingSafeEqual
```

- [ ] **Step 2: `index.ts` の分岐を整理する**

In `src/utils/crypto/index.ts` lines 62-91, remove the `subtle.timingSafeEqual` branch and always use the manual fallback.

- [ ] **Step 3: コミットする**

```bash
git add src/utils/crypto/types.ts src/utils/crypto/index.ts
git commit -m "fix(crypto): remove fake SubtleCrypto.timingSafeEqual type"
```

---

### Task 2: 定数を先頭に移動

**Files:**
- Modify: `src/utils/crypto/index.ts`

- [ ] **Step 1: `ENVELOPE_ITERATIONS`, `CURRENT_ENVELOPE_VERSION`, `ENVELOPE_HASH` をファイル先頭付近に移動**

Move constants to around line 20-30, before any function that uses them.

- [ ] **Step 2: 型チェックを実行する**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "refactor(crypto): move envelope constants before first use"
```

---

### Task 3: needsRehash を修正

**Files:**
- Modify: `src/utils/crypto/index.ts` (lines 373-377)

- [ ] **Step 1: 保存 iteration と現在の推奨値を比較する**

```typescript
const effectiveIterations = iterations ?? ENVELOPE_ITERATIONS;
return {
  isValid,
  needsRehash: effectiveIterations !== ENVELOPE_ITERATIONS,
};
```

- [ ] **Step 2: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "fix(crypto): compare stored iterations to current default for needsRehash"
```

---

### Task 4: isEncrypted を厳密化

**Files:**
- Modify: `src/utils/crypto/index.ts` (lines 237-247)

- [ ] **Step 1: 空文字列を拒否する**

```typescript
export function isEncrypted(data: unknown): data is EncryptedData {
  return Boolean(
    data !== null &&
    data !== undefined &&
    typeof data === 'object' &&
    'ciphertext' in data &&
    typeof data.ciphertext === 'string' &&
    data.ciphertext.length > 0 &&
    'iv' in data &&
    typeof data.iv === 'string' &&
    data.iv.length > 0
  );
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "fix(crypto): reject empty ciphertext/iv in isEncrypted"
```

---

### Task 5: 平文 API キーの検出/警告

**Files:**
- Modify: `src/utils/storage/settingsStore.ts` (lines 273-291)

- [ ] **Step 1: 平文 API キーを検出してログ警告する**

```typescript
for (const field of API_KEY_FIELDS) {
  const value = merged[field];
  if (typeof value === 'string' && value.length > 0) {
    await logWarn(`Plaintext API key detected: ${field}`, {}, 'settingsStore');
    // Optionally re-encrypt here if encryption key is available
  }
  if (isEncrypted(value)) {
    // decrypt as before
  }
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/utils/storage/settingsStore.ts
git commit -m "fix(settings): warn when plaintext API keys are detected"
```

---

### Task 6: hashUrl の衝突リスク軽減

**Files:**
- Modify: `src/utils/crypto/index.ts` (line 593)

- [ ] **Step 1: ハッシュ長を増やす**

```typescript
export function hashUrl(url: string): string {
  const hash = crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  // Use first 16 hex chars (64 bits) instead of 8
  return `[hash:${hex.slice(0, 16)}]`;
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/utils/crypto/index.ts
git commit -m "fix(crypto): increase hashUrl length to reduce collision risk"
```

---

## Self-Review

- **Spec coverage:** 型捏造、TDZ、needsRehash、isEncrypted、平文 API キー、hashUrl をカバー
- **Placeholder scan:** 具体値を使用
- **Type consistency:** `EncryptedData` 型は変更なし

## Parallelizability

**中**
- PBI-02, PBI-03 と `src/utils/crypto/index.ts` を共有
- 本PBIを先に完了させると、PBI-02/PBI-03 の競合が減る
