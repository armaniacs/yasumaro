# PBI 06: 外部API連携の信頼性設計ガイドライン策定 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 外部APIと連携する機能の実装時に参照する信頼性設計ガイドラインを作成する

**Architecture:** 過去のインシデントから設計パターンを抽出し、タイムアウト、リトライ、ポーリング、エラーハンドリングのベストプラクティスを文書化。

**Tech Stack:** Markdown, TypeScript

---

## タスク概要

1. **Task 1: インシデント分析** - 過去の外部API関連インシデントを洗い出し
2. **Task 2: ガイドライン作成** - 設計パターンを文書化
3. **Task 3: 既存コードへの適用** - サンプル実装を作成
4. **Task 4: 検証** - ガイドラインの完全性を確認

---

### Task 1: インシデント分析

**Files:**
- Analyze: `pbi/2026-07-25-03-fix-cws-publish-reliability.md`
- Analyze: `docs/superpowers/plans/2026-07-25-pbi-03-cws-publish-reliability.md`

- [ ] **Step 1: 過去のインシデントをリスト化**

以下のインシデントから設計パターンを抽出:
1. CWS APIのIN_PROGRESS状態のポーリング欠如
2. curlコマンドのタイムアウト欠如
3. 非同期処理の完了確認なし
4. エラー時の詳細情報不足

- [ ] **Step 2: 設計パターンを分類**

カテゴリ:
- タイムアウト設定
- リトライ戦略
- ポーリング設計
- エラーハンドリング
- サーキットブレーカー
- 冪等性

- [ ] **Step 3: Commit analysis**

```bash
git commit --allow-empty -m "docs: analyze past external API reliability incidents"
```

---

### Task 2: ガイドライン作成

**Files:**
- Create: `docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md`

- [ ] **Step 1: ガイドラインの骨格を作成**

```markdown
# External API Reliability Guideline

外部APIと連携する機能を実装する際の信頼性設計ガイドライン。

## タイムアウト設定

### 推奨値
- **接続タイムアウト** (`--connect-timeout`): 10秒
- **読み取りタイムアウト** (`--max-time`):
  - 軽量API（認証、ステータス確認）: 30秒
  - 中量API（データ取得）: 60秒
  - 重量API（ファイルアップロード）: 300秒（5分）

### 実装例
```typescript
const response = await fetch(url, {
  signal: AbortSignal.timeout(30000), // 30秒
});
```

## リトライ戦略

### 指数バックオフ
```typescript
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
```

### リトライ可能なエラー
- 500番台サーバーエラー
- 503 Service Unavailable
- 429 Too Many Requests
- ネットワークタイムアウト

### リトライ不可のエラー
- 400番台クライアントエラー
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found

## ポーリング設計

### 推奨パターン
```typescript
async function pollUntilComplete(
  checkStatus: () => Promise<string>,
  maxAttempts = 30,
  intervalMs = 10000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await checkStatus();
    if (status !== 'IN_PROGRESS') {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error('Polling timeout exceeded');
}
```

### ポーリング間隔
- 短期処理（数秒）: 1-2秒間隔
- 中期処理（数分）: 10秒間隔
- 長期処理（数十分）: 30秒間隔

## エラーハンドリング

### 一時的エラーと永続的エラーの区別
```typescript
function isRetryableError(error: any): boolean {
  if (error.code === 'ETIMEDOUT') return true;
  if (error.code === 'ECONNRESET') return true;
  if (error.status >= 500) return true;
  if (error.status === 429) return true;
  return false;
}
```

### ユーザーへの通知
```typescript
try {
  await apiCall();
} catch (error) {
  if (isRetryableError(error)) {
    showMessage('一時的なエラーが発生しました。しばらく後でもう一度お試しください。');
  } else {
    showMessage(`エラー: ${error.message}`);
  }
}
```

## サーキットブレーカー

### 実装例
```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly resetTimeout = 60000; // 60秒

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailure < this.resetTimeout) {
        throw new Error('Circuit breaker is open');
      }
      this.failures = 0;
    }

    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      throw error;
    }
  }
}
```

## 冪等性

### 再試行の安全性確保
- PUT、DELETEは冪等
- POSTは冝等でない場合がある → 冝等性キーを使用
```typescript
// 冝等性キーを使用したPOST
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify(data),
});
```
```

- [ ] **Step 2: Commit guideline creation**

```bash
git add docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md
git commit -m "docs: create external API reliability design guideline"
```

---

### Task 3: 既存コードへの適用

**Files:**
- Modify: `src/utils/fetch.ts` (既存の`fetchWithTimeout`を参考に)

- [ ] **Step 1: 既存の`fetchWithTimeout`を確認**

Run:
```bash
grep -n "fetchWithTimeout" src/utils/fetch.ts
```

- [ ] **Step 2: ガイドラインに基づく改善点を特定**

既存の実装とガイドラインを比較し、改善点をリスト化。

- [ ] **Step 3: Commit analysis**

```bash
git commit --allow-empty -m "docs: analyze existing fetchWithTimeout against guideline"
```

---

### Task 4: 検証

**Files:**
- Test: `docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md`

- [ ] **Step 1: ガイドラインの完全性を確認**

Run:
```bash
cat docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md | grep -c "^##"
```

Expected: At least 6 sections (タイムアウト、リトライ、ポーリング、エラーハンドリング、サーキットブレーカー、冝等性)

- [ ] **Step 2: コード例の構文を確認**

Run:
```bash
# Extract TypeScript code blocks and check syntax
cat docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md | grep -A 20 "^\`\`\`typescript" | head -50
```

Expected: Valid TypeScript syntax

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "test: verify external API reliability guideline completeness"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-06-external-api-reliability-guideline.md`に保存しました。
