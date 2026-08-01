# PBI-12: AI プロバイダー間の整合性と診断を改善する — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenAI と Gemini のどちらを使っても使用量が正しく記録され、タイムアウト設定が反映され、エラー発生時に原因がわかるメッセージが表示される。

**Architecture:** `OpenAIProvider` に `recordUsage()` 呼び出しを追加。`GeminiProvider` のタイムアウトを `AI_TIMEOUT_MS` 設定に。`testConnection` のエラーハンドリングを整理。Gemini 成功結果に `providerName`/`model` を追加。

**Tech Stack:** TypeScript, Jest

---

### Task 1: OpenAIProvider で recordUsage を呼ぶ

**Files:**
- Modify: `src/background/ai/providers/OpenAIProvider.ts` (lines 199-211)

- [ ] **Step 1: レスポンスから使用量を抽出する**

```typescript
const data = await response.json();
if (data.usage) {
  recordUsage({
    provider: this.getName(),
    model: this.model,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    timestamp: Date.now(),
  });
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/background/ai/providers/OpenAIProvider.ts
git commit -m "fix(openai): record usage after successful summary"
```

---

### Task 2: GeminiProvider のタイムアウトを設定に合わせる

**Files:**
- Modify: `src/background/ai/providers/GeminiProvider.ts` (lines 30, 100-114)

- [ ] **Step 1: コンストラクタでタイムアウトを設定から読む**

```typescript
this.timeoutMs = Number(settings[StorageKeys.AI_TIMEOUT_MS] ?? settings.ai_timeout_ms ?? 30000);
```

- [ ] **Step 2: `fetchWithRetry` の第3引数に渡す**

```typescript
const response = await fetchWithRetry(url, { ... }, this.timeoutMs);
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/ai/providers/GeminiProvider.ts
git commit -m "fix(gemini): use configured AI_TIMEOUT_MS instead of fixed 30000"
```

---

### Task 3: testConnection のエラーハンドリング整理

**Files:**
- Modify: `src/background/ai/providers/OpenAIProvider.ts` (lines 255-279), `src/background/ai/providers/GeminiProvider.ts` (lines 211-262)

- [ ] **Step 1: エラーメッセージを `error.name` と status で判定する**

```typescript
try {
  // ... fetch
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === 'AbortError') {
    return { success: false, error: 'Connection timed out. Check your network or increase timeout.' };
  }
  if (msg.includes('401')) {
    return { success: false, error: 'Invalid API key (401).' };
  }
  if (msg.includes('404')) {
    return { success: false, error: 'Model or endpoint not found (404).' };
  }
  return { success: false, error: `Connection error: ${msg}` };
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/background/ai/providers/OpenAIProvider.ts src/background/ai/providers/GeminiProvider.ts
git commit -m "fix(ai): improve testConnection error messages"
```

---

### Task 4: Gemini 成功結果にメタデータ追加

**Files:**
- Modify: `src/background/ai/providers/GeminiProvider.ts` (lines 116-127)

- [ ] **Step 1: 戻り値に providerName/model を追加する**

```typescript
return {
  success: true,
  summary,
  providerName: this.getName(),
  model: this.model,
};
```

- [ ] **Step 2: コミットする**

```bash
git add src/background/ai/providers/GeminiProvider.ts
git commit -m "fix(gemini): include providerName and model in success result"
```

---

### Task 5: テスト追加

**Files:**
- Modify: `src/background/__tests__/OpenAIProvider.test.ts`, `src/background/__tests__/GeminiProvider.test.ts`

- [ ] **Step 1: recordUsage テスト**

```typescript
it('records usage after successful generation', async () => {
  const recordUsageSpy = jest.spyOn(aiUsageTracker, 'recordUsage');
  fetchMock.mockResponseOnce(JSON.stringify({ choices: [{ message: { content: 'summary' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  await provider.generateSummary('content');
  expect(recordUsageSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Gemini タイムアウトテスト**

```typescript
it('uses configured timeout', async () => {
  const provider = new GeminiProvider({ ...settings, ai_timeout_ms: 60000 });
  expect(provider.timeoutMs).toBe(60000);
});
```

- [ ] **Step 3: コミットする**

```bash
git add src/background/__tests__/OpenAIProvider.test.ts src/background/__tests__/GeminiProvider.test.ts
git commit -m "test(ai): add usage recording and Gemini timeout tests"
```

---

## Self-Review

- **Spec coverage:** OpenAI usage、Gemini timeout、testConnection エラー、Gemini メタデータをカバー
- **Placeholder scan:** 具体値を使用
- **Type consistency:** `recordUsage` の引数型を確認

## Parallelizability

**高**
- PBI-04, PBI-07 とプロバイダーファイルを共有するが、変更領域は分離可能
