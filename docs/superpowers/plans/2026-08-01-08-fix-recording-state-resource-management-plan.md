# PBI-08: 記録状態のリソース管理と永続化を修正する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Service Worker のメモリと `chrome.storage.session` のクォータを圧迫せず、キャッシュ状態が SW 再起動後も正しく復元される。

**Architecture:** `urlRecordMutexes` に LRU/TTL を追加。`RecordingLogic` と `RecordingPipeline` の二重 Mutex を整理。`lifecycleHandlers` で SW 起床時にもキャッシュ復元。`SessionStore` に強制フラッシュオプションを追加。

**Tech Stack:** TypeScript, Chrome Extension Storage API, Jest

---

### Task 1: urlRecordMutexes に完了後削除を実装

**Files:**
- Modify: `src/background/recordingLogic.ts` (lines 154-163, 449-467)

- [ ] **Step 1: Mutex 取得・解放をラップする**

```typescript
async function withUrlRecordMutex<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const mutex = getOrCreateUrlRecordMutex(url);
  try {
    await mutex.acquire();
    return await fn();
  } finally {
    mutex.release();
    if (mutex.queueLength === 0) {
      urlRecordMutexes.delete(url);
    }
  }
}
```

- [ ] **Step 2: `record()` で使用する**

Replace direct mutex acquire/release with `withUrlRecordMutex`.

- [ ] **Step 3: コミットする**

```bash
git add src/background/recordingLogic.ts
git commit -m "fix(recording): release urlRecordMutex when idle"
```

---

### Task 2: 二重 Mutex の整理

**Files:**
- Modify: `src/background/recordingLogic.ts`, `src/background/pipeline/RecordingPipeline.ts` (lines 251-282)

- [ ] **Step 1: 責務を確認する**

Read both files to understand why two mutexes exist.

- [ ] **Step 2: `RecordingPipeline` 側の Mutex を削除し、`RecordingLogic` 側に統合する**

```typescript
// In RecordingPipeline.ts, remove per-URL mutex and rely on recordingLogic.record() serialization
```

- [ ] **Step 3: `retryObsidianWriteOnly` と offline retry も Mutex 内を通るようにする**

- [ ] **Step 4: コミットする**

```bash
git add src/background/recordingLogic.ts src/background/pipeline/RecordingPipeline.ts
git commit -m "refactor(recording): consolidate duplicate URL mutexes"
```

---

### Task 3: SW 起床時のキャッシュ復元

**Files:**
- Modify: `src/background/handlers/lifecycleHandlers.ts` (line 95)

- [ ] **Step 1: `handleActivate` でもキャッシュ復元を呼ぶ**

```typescript
chrome.runtime.onActivate.addListener(async () => {
  await recordingLogic.loadCacheFromSession();
});
```

- [ ] **Step 2: コミットする**

```bash
git add src/background/handlers/lifecycleHandlers.ts
git commit -m "fix(lifecycle): restore recording cache on service worker activation"
```

---

### Task 4: privacyCache の TTL 検証とクリーンアップ

**Files:**
- Modify: `src/background/recordingLogic.ts` (lines 383-401, 410-415)

- [ ] **Step 1: session fallback で TTL を検証する**

```typescript
if (cached && Date.now() - cached.timestamp < TTL_MS) {
  return cached;
}
```

- [ ] **Step 2: `invalidatePrivacyCache` で `privacyCache_<url>` キーも削除する**

```typescript
async function invalidatePrivacyCache(): Promise<void> {
  // clear in-memory map
  // clear RECORDING_CACHE
  // clear all privacyCache_* keys from session
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/recordingLogic.ts
git commit -m "fix(recording): validate TTL in privacy cache and clean up session keys"
```

---

### Task 5: SessionStore の強制フラッシュ

**Files:**
- Modify: `src/background/sessionStore.ts` (lines 92-106)

- [ ] **Step 1: `set()` に `flushImmediately` オプションを追加する**

```typescript
async set(key: string, value: unknown, options?: { flushImmediately?: boolean }): Promise<void> {
  this.writeQueue.set(key, value);
  if (options?.flushImmediately) {
    await this.flush();
  } else {
    this.scheduleFlush();
  }
}
```

- [ ] **Step 2: 重要な書込で即時フラッシュを使用する箇所を特定する**

- [ ] **Step 3: コミットする**

```bash
git add src/background/sessionStore.ts
git commit -m "feat(session): add immediate flush option to SessionStore"
```

---

## Self-Review

- **Spec coverage:** Mutex 解放、二重 Mutex 整理、キャッシュ復元、TTL 検証、SessionStore 強制フラッシュをカバー
- **Placeholder scan:** 具体値を使用
- **Type consistency:** `Mutex` に `queueLength` アクセサが必要か確認

## Parallelizability

**低**
- PBI-01, PBI-05 と `service-worker.ts`/`recordingLogic.ts` を共有
- `RecordingPipeline` と `RecordingLogic` の責務変更は広範囲に影響
- 最も影響範囲が広いため後回し推奨
