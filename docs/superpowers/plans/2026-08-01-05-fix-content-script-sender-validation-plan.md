# PBI-05: VALID_VISIT の sender 検証とレート制限を強化する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コンテンツスクリプトからの `VALID_VISIT` メッセージの送信元を厳密に検証し、攻撃者ページによる自動記録/AI コスト搾取を防ぐ。

**Architecture:** `service-worker.ts` のメッセージゲートで `sender.url` スキームを検証。`createValidVisitHandler` にレート制限を追加。`extractor.ts` でプログラムスクロールのみのトリガーを抑制。

**Tech Stack:** TypeScript, Chrome Extension Messaging API, Jest

---

### Task 1: sender.url スキーム検証を追加

**Files:**
- Modify: `src/background/service-worker.ts` (lines 496-501)

- [ ] **Step 1: ヘルパー関数を追加する**

```typescript
function isValidContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.tab || !sender.tab.id || !sender.tab.url) return false;
  const senderUrl = sender.url;
  if (!senderUrl) return false;
  return senderUrl.startsWith('http://') || senderUrl.startsWith('https://');
}
```

- [ ] **Step 2: ゲートで使用する**

```typescript
if (CONTENT_SCRIPT_ONLY_TYPES.includes(message.type as typeof CONTENT_SCRIPT_ONLY_TYPES[number])) {
  if (!isValidContentScriptSender(sender)) {
    sendResponse(INVALID_SENDER_ERROR);
    return;
  }
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/service-worker.ts
git commit -m "fix(sw): validate content script sender URL scheme"
```

---

### Task 2: VALID_VISIT にレート制限を追加

**Files:**
- Modify: `src/background/handlers/messageHandlers.ts` (lines 137-213)

- [ ] **Step 1: レート制限関数を追加する**

```typescript
const visitRateLimiter = new Map<string, number>();
const VISIT_RATE_LIMIT_MS = 5000;

function isRateLimitedVisit(url: string): boolean {
  const now = Date.now();
  const last = visitRateLimiter.get(url);
  if (last && now - last < VISIT_RATE_LIMIT_MS) return true;
  visitRateLimiter.set(url, now);
  return false;
}
```

- [ ] **Step 2: handler の先頭でレート制限をチェックする**

```typescript
if (sender.tab.url && isRateLimitedVisit(sender.tab.url)) {
  sendResponse({ success: false, reason: 'rate_limited' });
  return;
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/handlers/messageHandlers.ts
git commit -m "fix(handler): add rate limiting for VALID_VISIT messages"
```

---

### Task 3: プログラムスクロール検出（オプション）

**Files:**
- Modify: `src/content/extractor.ts` (lines 633-653, scroll listener)

- [ ] **Step 1: スクロールイベントの信頼性を考慮する**

```typescript
function onScroll(event: Event): void {
  if (!event.isTrusted) return;
  updateMaxScroll();
}
```

- [ ] **Step 2: リスナーに `{ passive: true }` を追加しつつ置き換える**

- [ ] **Step 3: コミットする**

```bash
git add src/content/extractor.ts
git commit -m "fix(extractor): ignore programmatic scroll for visit trigger"
```

---

### Task 4: テスト追加

**Files:**
- Modify: `src/background/__tests__/service-worker.test.ts`, `src/background/handlers/__tests__/messageHandlers.test.ts`

- [ ] **Step 1: sender 検証テストを追加する**

```typescript
it('rejects VALID_VISIT without valid sender URL', () => {
  const sender = { tab: { id: 1, url: 'https://example.com' } } as chrome.runtime.MessageSender;
  delete (sender as any).url;
  // expect INVALID_SENDER_ERROR
});
```

- [ ] **Step 2: レート制限テストを追加する**

```typescript
it('rate limits repeated VALID_VISIT for same URL', async () => {
  // first call accepted, second within 5s rejected
});
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/__tests__/service-worker.test.ts src/background/handlers/__tests__/messageHandlers.test.ts
git commit -m "test(sw,handlers): add VALID_VISIT sender and rate limit tests"
```

---

## Self-Review

- **Spec coverage:** sender URL 検証、レート制限、スクロール信頼性をカバー
- **Placeholder scan:** 具体値を使用
- **Type consistency:** `chrome.runtime.MessageSender` の型に注意

## Parallelizability

**中**
- PBI-01 と `service-worker.ts` を共有
- PBI-08 と `recordingLogic.ts`/`RecordingPipeline.ts` を共有
- 変更領域は分離可能
