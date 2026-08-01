# PBI-06: 長いトークン内部の PII マスク漏れを修正する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 200文字を超える空白なしトークンの中央部に含まれる PII（メール、電話など）も検出・マスクする。

**Architecture:** `neutralizeLongNonWhitespaceRuns` の戦略を変更し、中央部も検出可能にする。または、長トークンを分割してスキャンする。

**Tech Stack:** TypeScript, Jest

---

### Task 1: 長トークンの分割スキャンを実装

**Files:**
- Modify: `src/utils/piiSanitizer.ts` (lines 31-40, 260)

- [ ] **Step 1: 新しい neutralize 関数を追加する**

```typescript
function neutralizeLongNonWhitespaceRuns(text: string): string {
  const threshold = TOKEN_EDGE_KEEP_LENGTH * 2;
  return text.replace(NON_WHITESPACE_RUN, (token) => {
    if (token.length <= threshold) return token;
    const head = token.slice(0, TOKEN_EDGE_KEEP_LENGTH);
    const tail = token.slice(-TOKEN_EDGE_KEEP_LENGTH);
    const middle = token.slice(TOKEN_EDGE_KEEP_LENGTH, -TOKEN_EDGE_KEEP_LENGTH);
    // Keep a sample of the middle so regexes can still match PII there
    const sampledMiddle = sampleMiddleForScan(middle);
    return head + sampledMiddle + tail;
  });
}

function sampleMiddleForScan(middle: string): string {
  const sampleInterval = 50;
  let sampled = '';
  for (let i = 0; i < middle.length; i += sampleInterval) {
    sampled += middle.slice(i, i + sampleInterval) + '#';
  }
  return sampled;
}
```

- [ ] **Step 2: インデックス整合性を保つ**

Ensure that matches found in `scanText` correspond to positions in original `text`.

- [ ] **Step 3: コミットする**

```bash
git add src/utils/piiSanitizer.ts
git commit -m "feat(pii): sample long token middle for PII scanning"
```

---

### Task 2: マスク処理の調整

**Files:**
- Modify: `src/utils/piiSanitizer.ts` (lines 338-384)

- [ ] **Step 1: マッチ位置を元のテキストに正確にマッピングする**

If `scanText` length differs from `text`, compute offset adjustments.

- [ ] **Step 2: コミットする**

```bash
git add src/utils/piiSanitizer.ts
git commit -m "fix(pii): map masked positions back to original text"
```

---

### Task 3: テスト追加

**Files:**
- Modify: `src/utils/__tests__/piiSanitizer.test.ts`

- [ ] **Step 1: 長トークン中央のメールテスト**

```typescript
it('masks email buried in long whitespace-free token', () => {
  const input = 'a'.repeat(150) + 'user@example.com' + 'b'.repeat(150);
  const result = sanitizeText(input, { mode: 'full_pipeline' });
  expect(result.text).not.toContain('user@example.com');
});
```

- [ ] **Step 2: 長い URL クエリのメールテスト**

```typescript
it('masks email in long URL query parameter', () => {
  const input = `https://example.com/${'x'.repeat(200)}?email=user@example.com&next=${'y'.repeat(100)}`;
  const result = sanitizeText(input, { mode: 'full_pipeline' });
  expect(result.text).not.toContain('user@example.com');
});
```

- [ ] **Step 3: 性能テスト**

```typescript
it('handles 64KB input within timeout', () => {
  const input = 'a'.repeat(64 * 1024);
  const start = Date.now();
  sanitizeText(input, { mode: 'full_pipeline' });
  expect(Date.now() - start).toBeLessThan(1000);
});
```

- [ ] **Step 4: コミットする**

```bash
git add src/utils/__tests__/piiSanitizer.test.ts
git commit -m "test(pii): add long-token PII masking tests"
```

---

## Self-Review

- **Spec coverage:** 長トークン中央の PII 検出、マスク、性能をカバー
- **Placeholder scan:** 具体値を使用
- **Type consistency:** `scanText` と `text` の長さが異なる場合のインデックス管理に注意

## Parallelizability

**高**
- `src/utils/piiSanitizer.ts` 内の局所変更
- PBI-04 と `privacyPipeline.ts` を共有するが、変更領域は独立
