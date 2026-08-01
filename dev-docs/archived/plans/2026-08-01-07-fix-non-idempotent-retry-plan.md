# PBI-07: 非冪等な POST の 5xx 再送を防止する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fetchWithRetry` が POST/PUT/PATCH リクエストの 5xx 応答を再送しないようにし、二重生成・二重課金を防ぐ。

**Architecture:** `RetryOptions` に HTTP メソッドを渡し、`shouldRetry` 関数が冪等でないメソッドの 5xx をスキップする。

**Tech Stack:** TypeScript, Jest

---

### Task 1: RetryOptions に method を追加

**Files:**
- Modify: `src/utils/fetch.ts` (around lines 35-41, 382)

- [ ] **Step 1: 型定義を確認する**

Read `src/utils/fetch.ts` lines 35-45 and 380-385.

- [ ] **Step 2: `RetryOptions` に method を追加する**

```typescript
export interface RetryOptions {
  maxRetryCount?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error, attempt: number, response?: Response, method?: string) => boolean;
  method?: string;
}
```

- [ ] **Step 3: `fetchWithRetry` で method を shouldRetry に渡す**

```typescript
const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
if (shouldRetry(attemptError, attempt + 1, response, options.method ?? requestInit.method ?? 'GET')) {
  // retry
}
```

- [ ] **Step 4: コミットする**

```bash
git add src/utils/fetch.ts
git commit -m "feat(fetch): pass HTTP method to retry predicate"
```

---

### Task 2: defaultShouldRetry をメソッド対応に

**Files:**
- Modify: `src/utils/fetch.ts` (lines 391-414)

- [ ] **Step 1: 関数シグネチャを変更する**

```typescript
function defaultShouldRetry(error: Error, attempt: number, response?: Response, method: string = 'GET'): boolean {
```

- [ ] **Step 2: 5xx 判定にメソッドを追加する**

```typescript
const nonIdempotentMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
if (response && response.status >= 500) {
  return !nonIdempotentMethods.has(method.toUpperCase());
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/fetch.ts
git commit -m "fix(fetch): skip retry on 5xx for non-idempotent methods"
```

---

### Task 3: プロバイダーのカスタム shouldRetry を更新

**Files:**
- Modify: `src/background/ai/providers/OpenAIProvider.ts` (lines 186-196)

- [ ] **Step 1: カスタム shouldRetry のシグネチャを変更する**

```typescript
shouldRetry: (error, attempt, response, method) => {
  if (response?.status === 429) return false;
  if (response && response.status >= 500) {
    return !['POST', 'PUT', 'PATCH'].includes(method?.toUpperCase() ?? 'POST');
  }
  return attempt < 1;
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/background/ai/providers/OpenAIProvider.ts
git commit -m "fix(openai): respect method in custom retry predicate"
```

---

### Task 4: テスト追加

**Files:**
- Modify: `src/utils/__tests__/fetch.test.ts`

- [ ] **Step 1: POST 5xx 再送禁止テスト**

```typescript
it('does not retry POST on 500', async () => {
  fetchMock.mockResponseOnce('', { status: 500 });
  await expect(
    fetchWithRetry('https://api.example.com/v1', { method: 'POST', body: '{}' }, { maxRetryCount: 3 })
  ).rejects.toThrow('HTTP 500');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: GET 5xx 再送許可テスト**

```typescript
it('retries GET on 500', async () => {
  fetchMock.mockResponseOnce('', { status: 500 });
  fetchMock.mockResponseOnce('{}', { status: 200 });
  await fetchWithRetry('https://api.example.com/v1', { method: 'GET' }, { maxRetryCount: 3 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/__tests__/fetch.test.ts
git commit -m "test(fetch): verify no retry on POST 5xx"
```

---

## Self-Review

- **Spec coverage:** POST/PUT/PATCH の 5xx 再送禁止、GET の継続再送、プロバイダー更新をカバー
- **Placeholder scan:** 具体メソッドリストを使用
- **Type consistency:** `shouldRetry` のシグネチャ変更が全呼び出し元に反映されていることを確認

## Parallelizability

**高**
- `src/utils/fetch.ts` とプロバイダーのみを変更
- PBI-12 と連携可能だが競合は少ない
