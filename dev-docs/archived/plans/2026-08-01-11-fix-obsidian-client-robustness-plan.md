# PBI-11: Obsidian クライアントの堅牢性と整合性を向上する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obsidian Local REST API への接続がポート・プロトコル・IPv6 に関して一貫し、タイムアウトやネットワーク断でもデータが失われたり重複したりしない。

**Architecture:** ポート既定値を 27123 に統一。`_validateHost` で IPv6 `::1` を許可。`response.text()` にタイムアウトを追加。タイムアウト時もログを出力。dailyPath の URL メタ文字をエンコード。

**Tech Stack:** TypeScript, Jest

---

### Task 1: ポート既定値を統一

**Files:**
- Modify: `src/background/obsidianClient.ts` (line 29), `src/utils/storage/defaults.ts` (line 14), `src/utils/storage/settingsStore.ts` (line 550)

- [ ] **Step 1: 現在の既定値を確認する**

Read the three files.

- [ ] **Step 2: すべて `27123` に統一する**

```typescript
const DEFAULT_PORT = '27123';
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/obsidianClient.ts src/utils/storage/defaults.ts src/utils/storage/settingsStore.ts
git commit -m "fix(obsidian): unify default port to 27123"
```

---

### Task 2: IPv6 ループバックを許可

**Files:**
- Modify: `src/background/obsidianClient.ts` (lines 166-186)

- [ ] **Step 1: `_validateHost` の拒否文字からコロンを除去する**

```typescript
if (/[\s\/\\]/.test(trimmed)) {
  throw new Error('Obsidian host contains invalid characters.');
}
```

- [ ] **Step 2: IPv6 ブラケット対応を追加する**

```typescript
if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
  const inner = trimmed.slice(1, -1);
  // validate IPv6 address format
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/obsidianClient.ts
git commit -m "fix(obsidian): allow IPv6 loopback addresses in host validation"
```

---

### Task 3: レスポンスボディ読み込みにタイムアウト

**Files:**
- Modify: `src/background/obsidianClient.ts` (lines 252-260)

- [ ] **Step 1: `_fetchExistingContent` を修正する**

```typescript
const response = await fetchWithTimeout(url, { headers }, READ_TIMEOUT_MS);
const text = await Promise.race([
  response.text(),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Body read timeout')), READ_TIMEOUT_MS))
]);
```

- [ ] **Step 2: コミットする**

```bash
git add src/background/obsidianClient.ts
git commit -m "fix(obsidian): add timeout to response body read"
```

---

### Task 4: タイムアウトログ追加

**Files:**
- Modify: `src/background/obsidianClient.ts` (lines 286-297)

- [ ] **Step 1: `_handleError` のタイムアウト分岐にログを追加する**

```typescript
} else if (errorMessage.includes('timed out')) {
  await addLog(LogType.WARN, `Obsidian write timed out: ${targetUrl}`, { error: errorMessage }, 'obsidianClient');
  return { success: false, error: chrome.i18n.getMessage('obsidianTimeoutError') || 'Obsidian request timed out' };
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/background/obsidianClient.ts
git commit -m "fix(obsidian): log timeout errors"
```

---

### Task 5: dailyPath の URL メタ文字エンコード

**Files:**
- Modify: `src/utils/dailyNotePathBuilder.ts` (lines 10-31), `src/background/obsidianClient.ts` (lines 49-52)

- [ ] **Step 1: `sanitizePathComponent` で URL メタ文字をエスケープする**

```typescript
export function sanitizePathComponent(component: string): string {
  // Reject path traversal
  if (component.includes('../') || component.includes('..\\') || component.startsWith('/')) {
    throw new Error('Invalid path component');
  }
  // Encode characters that have special meaning in URLs
  return encodeURIComponent(component).replace(/%2F/g, '/');
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/utils/dailyNotePathBuilder.ts
git commit -m "fix(obsidian): encode URL metacharacters in daily path"
```

---

## Self-Review

- **Spec coverage:** ポート統一、IPv6、ボディタイムアウト、ログ、パスエンコードをカバー
- **Placeholder scan:** 具体値を使用
- **Type consistency:** `_validateHost` の正規表現変更に注意

## Parallelizability

**中**
- PBI-09 と `src/utils/fetch.ts` を共有
- `_validateHost` の IPv6 対応は PBI-09 と重複する可能性があるため調整が必要
