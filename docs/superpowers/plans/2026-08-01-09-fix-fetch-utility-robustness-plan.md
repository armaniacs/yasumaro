# PBI-09: fetch ユーティリティの検証と堅牢性を向上する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fetchWithTimeout`/`fetchWithRetry` の API を直感的にし、タイムアウト判定を環境依存せず、SSRF 防御が IPv6 や別形式 IP に対しても機能する。

**Architecture:** `timeoutMs` オプションを正しく扱う。タイムアウト判定を `error.name` ベースに。IPv6 ブラケットを正規化してからプライベート IP 判定。`localhost`/`127.0.0.1` を `isLocalhostAddress` に追加。

**Tech Stack:** TypeScript, Jest

---

### Task 1: timeoutMs オプションを正しく扱う

**Files:**
- Modify: `src/utils/fetch.ts` (lines 106-115)

- [ ] **Step 1: `fetchWithTimeout` のシグネチャを確認する**

Read `src/utils/fetch.ts` lines 100-120.

- [ ] **Step 2: オプションの timeoutMs を優先する**

```typescript
export async function fetchWithTimeout(
  url: string,
  fetchOptions: RequestInit & FetchOptions = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const effectiveTimeout = fetchOptions.timeoutMs ?? timeoutMs;
  // ... use effectiveTimeout instead of timeoutMs
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/fetch.ts
git commit -m "fix(fetch): honor timeoutMs option in fetchWithTimeout"
```

---

### Task 2: タイムアウト判定を名前ベースに

**Files:**
- Modify: `src/utils/fetch.ts` (lines 155-165)

- [ ] **Step 1: abort エラーを name で判定する**

```typescript
} catch (error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    throw new Error(`Request timed out after ${effectiveTimeout}ms`);
  }
  throw error;
}
```

- [ ] **Step 2: 呼び出し側の文字列判定を name 判定に置き換える**

Search for `'timed out'` string checks and update callers.

- [ ] **Step 3: コミットする**

```bash
git add src/utils/fetch.ts src/background/obsidianClient.ts src/background/ai/providers/*.ts
git commit -m "fix(fetch): use AbortError name for timeout detection"
```

---

### Task 3: IPv6 ブラケット正規化

**Files:**
- Modify: `src/utils/fetch.ts` (lines 207-225)

- [ ] **Step 1: hostname からブラケットを除去する**

```typescript
function normalizeIpHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}
```

- [ ] **Step 2: `isPrivateIpAddress` の先頭で正規化する**

```typescript
export function isPrivateIpAddress(hostname: string): boolean {
  const normalized = normalizeIpHostname(hostname);
  // ... existing checks on normalized
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/utils/fetch.ts
git commit -m "fix(fetch): normalize IPv6 brackets before private IP check"
```

---

### Task 4: localhost ホスト名をブロック

**Files:**
- Modify: `src/utils/fetch.ts` (lines 303-330)

- [ ] **Step 1: `isLocalhostAddress` を拡張する**

```typescript
export function isLocalhostAddress(hostname: string): boolean {
  const normalized = normalizeIpHostname(hostname);
  if (normalized === 'localhost') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;
  if (normalized === '::1') return true;
  if (/^::ffff:127\./.test(normalized)) return true;
  return false;
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/utils/fetch.ts
git commit -m "fix(fetch): treat localhost and 127.0.0.1 as localhost addresses"
```

---

### Task 5: テスト追加

**Files:**
- Modify: `src/utils/__tests__/fetch.test.ts`

- [ ] **Step 1: timeoutMs テスト**

```typescript
it('respects timeoutMs option', async () => {
  fetchMock.mockResponseOnce(() => new Promise(() => {}));
  await expect(
    fetchWithTimeout('https://example.com', { timeoutMs: 100 })
  ).rejects.toThrow('timed out after 100ms');
});
```

- [ ] **Step 2: IPv6 プライベート IP テスト**

```typescript
it('blocks bracketed IPv6 loopback', () => {
  expect(() => validateUrlForFilterImport('http://[::1]:8080/')).toThrow();
});
```

- [ ] **Step 3: localhost テスト**

```typescript
it('blocks localhost with blockLocalhost', () => {
  expect(() => validateUrl('http://localhost:9999', { blockLocalhost: true })).toThrow();
});
```

- [ ] **Step 4: コミットする**

```bash
git add src/utils/__tests__/fetch.test.ts
git commit -m "test(fetch): add timeoutMs, IPv6, and localhost validation tests"
```

---

## Self-Review

- **Spec coverage:** timeoutMs、AbortError 判定、IPv6 ブラケット、localhost 判定をカバー
- **Placeholder scan:** 具体値を使用
- **Type consistency:** `FetchOptions` に `timeoutMs` が含まれていることを確認

## Parallelizability

**高**
- `src/utils/fetch.ts` のみを主に変更
- PBI-07, PBI-11 と連携可能
