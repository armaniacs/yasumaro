# AIClientテストをRemoteAIService経由に移行する Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `aiClient.test.ts`(598行/20件)と`aiClient-priority-fallback.test.ts`(418行/17件)が実質的にテストしている`RemoteAIService`の実装詳細を`RemoteAIService.test.ts`へ移植し、`aiClient.test.ts`を`AIClient→RemoteAIService`の委譲contractテスト(4件)に縮小、`aiClient-priority-fallback.test.ts`を削除する。

**Architecture:** `RemoteAIService`はコンストラクタ注入(`new RemoteAIService({ getSettings })`)でテスト可能な設計を既に持つ。移行後の`RemoteAIService`側テストは全てこのDIパターンに統一し、`vi.mock('../../utils/storage.js')`によるモジュールモックを廃止する。フェッチ層(Gemini/OpenAIの実エラーメッセージ整形)に依存するテストは`RemoteAIService`のprovider factory差し替え(`registerProvider`)でスタブ提供し、実プロバイダーの内部実装(fetch呼び出し)には依存しない。

**Tech Stack:** Vitest, TypeScript, 既存の`RemoteAIService`/`AIClient`実装（変更なし、テストのみ移行）

---

## 移行前後のテストケース対応表

移行前37件（`aiClient.test.ts`20件 + `aiClient-priority-fallback.test.ts`17件）を検証内容ごとに分類する。「Ver」列は移行先。

| # | 元ファイル:describe | 元テスト名 | 検証内容の実体 | 移行先 |
|---|---|---|---|---|
| 1 | aiClient.test.ts: 未知のプロバイダー | 未知のプロバイダー名がエラーメッセージに含まれない | `RemoteAIService.generateSummary`が未登録provider名を`Error: AI provider configuration is missing`に丸める | RemoteAIService.test.ts (Task 2) |
| 2 | aiClient.test.ts: 未知のプロバイダー | エラーメッセージがユーザーに分かりやすい形式 | 同上の"check your settings"文言 | RemoteAIService.test.ts (Task 2, #1と統合) |
| 3 | aiClient.test.ts: APIキー未提供 | Geminiプロバイダー名が漏洩しない | **GeminiProvider固有**のエラー文言("API key is missing")。RemoteAIServiceはproviderをスタブ経由で呼ぶだけなので、この文言はGeminiProvider自身の責務 | 対象外（GeminiProvider側の既存挙動、RemoteAIServiceのテスト対象外と判断。Task 1で除外理由を明記） |
| 4 | aiClient.test.ts: APIキー未提供 | エラーメッセージがユーザーに分かりやすい | 同上 | 対象外（#3と同じ理由） |
| 5 | aiClient.test.ts: APIエラー時 | Gemini 404で詳細が含まれない | GeminiProvider内部のfetchエラー整形 | 対象外（GeminiProvider固有、RemoteAIServiceは関与しない） |
| 6 | aiClient.test.ts: APIエラー時 | Gemini一般エラーで生データが含まれない | 同上 | 対象外 |
| 7 | aiClient.test.ts: APIエラー時 | OpenAI APIエラーで生データが含まれない | OpenAIProvider内部のfetchエラー整形 | 対象外 |
| 8 | aiClient.test.ts: ネットワークエラー時 | 詳細なエラーメッセージが含まれない | GeminiProvider内部 | 対象外 |
| 9 | aiClient.test.ts: エラーハンドリングの一貫性 | errorUtils未使用（プレースホルダー） | `expect(true).toBe(true)`の分析用ダミー | 削除（実質的な検証なし） |
| 10 | aiClient.test.ts: 推奨される改善点 | 内部情報を削除すべき（プレースホルダー） | 同上 | 削除 |
| 11 | aiClient.test.ts: 推奨される改善点 | errorUtils使用すべき（プレースホルダー） | 同上 | 削除 |
| 12 | aiClient.test.ts: registerProvider | カスタムプロバイダー登録できる | `RemoteAIService.registerProvider`の動作確認だが実質アサーションなし(`expect(true).toBe(true)`) | RemoteAIService.test.tsに実質的なテストとして統合（Task 2で`registerProvider`が登録したfactoryが実際に呼ばれることを検証する形に強化） |
| 13 | aiClient.test.ts: in-flight重複排除 | 同一URL並行呼び出しは1回に集約 | `RemoteAIService.generateSummary`のdedupe機構 | **RemoteAIService.test.tsに既存**(`deduplicates concurrent generateSummary calls for the same URL`, RemoteAIService.test.ts:54) — 重複、移植不要 |
| 14 | aiClient.test.ts: in-flight重複排除 | 異なるURLはそれぞれ独立 | 同上 | RemoteAIService.test.ts (Task 2で新規追加、既存にない観点) |
| 15 | aiClient.test.ts: in-flight重複排除 | 完了後は同一URLで再度APIが呼ばれる | 同上 | RemoteAIService.test.ts (Task 2で新規追加) |
| 16 | aiClient.test.ts: in-flight重複排除 | urlが空文字列は対象外 | **RemoteAIService.test.tsに既存**(`treats empty URL as non-dedupeable`, :71) — 重複、移植不要 |
| 17 | aiClient.test.ts: in-flight重複排除 | 失敗時もin-flightマップから削除される | RemoteAIService.test.ts (Task 2で新規追加) |
| 18 | aiClient.test.ts: registerDefaultProviders | デフォルトプロバイダーが登録される（実質アサーションなし） | 削除（`expect(client).toBeDefined()`のみで無意味） |
| 19 | aiClient.test.ts: testConnection | 未知のプロバイダーでエラーを返す | RemoteAIService.test.ts (Task 2で新規追加) |
| 20 | aiClient.test.ts: testConnection | プロバイダーがthrowした場合エラーを返す | **RemoteAIService.test.tsに既存**(`propagates provider exceptions as error results`は`generateSummary`側のみ。`testConnection`側は未カバー) → RemoteAIService.test.ts (Task 2で新規追加) |
| 21 | aiClient.test.ts: testConnection | 各プロバイダー結果にelapsedMsを含める | RemoteAIService.test.ts (Task 2で新規追加) |
| 22 | aiClient.test.ts: testConnection | 未知のプロバイダーの結果にもelapsedMsを含める | RemoteAIService.test.ts (Task 2, #21と統合可能) |
| 23 | aiClient.test.ts: generateSummary正常系 | Geminiプロバイダーで正常に要約（実プロバイダー経由、fetchモック） | 対象外（実プロバイダーのE2E的な統合テストで、RemoteAIServiceのスタブベーステストとは性質が異なる。**削除**して良いか要判断→ Task 1で保持方針を決定） |
| 24 | aiClient.test.ts: generateSummary正常系 | OpenAIプロバイダーで正常に要約 | 対象外（#23と同様） |
| 25 | aiClient.test.ts: generateSummary正常系 | recordAuditLogがprovider/urlで呼ばれる | RemoteAIService.test.ts (Task 2で新規追加。`processSummarySlot`内の`recordAuditLog`呼び出しを検証) |
| 26 | aiClient.test.ts: generateSummary正常系 | fallback時に複数回recordAuditLogが呼ばれる | RemoteAIService.test.ts (Task 2で新規追加) |
| 27 | aiClient.test.ts: プロバイダー例外ハンドリング | throwした場合汎用エラーメッセージ | **RemoteAIService.test.tsに既存**(`propagates provider exceptions as error results`, :87) — ほぼ重複だが「Provider internal errorが含まれない」というnegativeアサーションは新規。RemoteAIService.test.ts (Task 2で強化) |
| 28 | aiClient.test.ts: testConnection例外 | throwした場合エラー結果を返す | RemoteAIService.test.ts (Task 2で新規追加) |
| 29 | aiClient.test.ts: MAX_PROVIDERS制限 | 10件を超えるスロットは切り捨てられる | RemoteAIService.test.ts (Task 2で新規追加。`resolveProviderSlots`のDoS対策) |
| 30 | fallback.test.ts: 優先度フォールバック | 1位失敗→2位で成功 | RemoteAIService.test.tsに既存の`falls back to the next provider`と概念は同じだが、こちらは**実プロバイダー(Gemini/OpenAI)経由**のfetchモック。RemoteAIServiceのスタブ版で同等カバレッジ済みのため対象外 |
| 31 | fallback.test.ts: 優先度フォールバック | 最小長未満→2位にフォールバック | RemoteAIService.test.ts (Task 2で新規追加。`minLength`しきい値によるフォールバックはRemoteAIService固有ロジックで未カバー) |
| 32 | fallback.test.ts: 優先度フォールバック | 全プロバイダー失敗で失敗結果 | **RemoteAIService.test.tsに既存**(`returns the last provider result when all providers fail`, :43) — 重複、移植不要 |
| 33 | fallback.test.ts: 優先度フォールバック | 優先度リスト空配列→旧AI_PROVIDER単一設定にフォールバック | RemoteAIService.test.ts (Task 2で新規追加。`resolveProviderSlots`のフォールバック仕様) |
| 34 | fallback.test.ts: 進捗コールバック | 各プロバイダー開始時にonProgressが順番に呼ばれる | **RemoteAIService.test.tsに既存**(`delegates testConnection to providers with progress callback`, :119)だが1件のみ検証。複数スロットでの順序保証は未カバー → RemoteAIService.test.ts (Task 2で強化) |
| 35 | fallback.test.ts: 進捗コールバック | model未指定でもデフォルトモデルを解決してonProgressに渡す | RemoteAIService.test.ts (Task 2で新規追加。`resolveEffectiveModel`のロジック) |
| 36 | fallback.test.ts: 進捗コールバック | onProgressを省略しても動作する | RemoteAIService.test.ts (Task 2で新規追加) |
| 37 | fallback.test.ts: built-in-aiディスパッチ (8件) | built-in-ai成功/失敗/フォールバック/success:false等 | 対象外（**実BuiltInAIClient経由**。`registerDefaultProviders`が`BuiltInAiProvider`を登録する配線の確認であり、`providers/__tests__/BuiltInAiProvider.test.ts`が単体では既にカバー。RemoteAIServiceからの配線自体は`registerDefaultProviders`の1テストで十分） |

### 対応表のサマリー

- **対象外（移植しない）**: #3,4,5,6,7,8,23,24,30,32,37の一部 — GeminiProvider/OpenAIProvider/BuiltInAiProviderの内部実装に依存する統合的な検証であり、`RemoteAIService`は関与しない。これらのプロバイダー固有ロジックは`providers/__tests__/`配下の既存テストでカバーされているか、カバーされていない場合は本PBIのスコープ外として別途Issue化する（Task 1で確認）。
- **削除（無意味なプレースホルダー）**: #9,10,11,18
- **既存で重複（移植不要）**: #13(部分),16,20(部分),27(部分),32,34(部分)
- **RemoteAIService.test.tsへ新規追加**: #1,2,12,14,15,17,19,21,22,25,26,28,29,31,33,35,36 (17件相当)
- **AIClient.test.tsに委譲contractとして残す**: 4件（Task 3で新規作成）

---

## File Structure

- Modify: `src/background/ai/__tests__/RemoteAIService.test.ts` — DIパターンで新規テストケースを追加
- Modify: `src/background/__tests__/aiClient.test.ts` — 委譲contract 4件のみに全面書き換え
- Delete: `src/background/__tests__/aiClient-priority-fallback.test.ts`
- No production code changes（`src/background/aiClient.ts`, `src/background/ai/RemoteAIService.ts`は変更しない）

---

### Task 1: 対象外テストの妥当性確認（コードのみ、実装前の事前確認）

**Files:**
- Read: `src/background/ai/providers/__tests__/` 配下の全ファイル

- [ ] **Step 1: GeminiProvider/OpenAIProviderの単体テストが存在するか確認する**

Run: `ls src/background/ai/providers/__tests__/`

Expected:
```
BuiltInAiProvider.test.ts
ProviderStrategy.test.ts
prompt-injection-high-blocking.test.ts
providerParity.test.ts
```

`GeminiProvider.test.ts` / `OpenAIProvider.test.ts` が存在しないことを確認する（存在しない前提で本計画は書かれている）。

- [ ] **Step 2: providerParity.test.tsの中身を確認し、404/400/401エラー整形が既にカバーされているか確認する（確認済み）**

Run: `grep -n "404\|400\|401\|Not found\|Detailed error\|API key is missing" src/background/ai/providers/__tests__/providerParity.test.ts`

**確認結果（本計画作成時点で実施済み）**: `status < 400`という汎用的なHTTPステータス判定コードが1件ヒットするのみで、Gemini 404/OpenAI 401等の**エラーメッセージ整形**（内部情報が漏洩しないことの検証）はカバーされていない。
よって Step 2b は**実施が必要**と確定している。このステップは再確認のみでよく、スキップしないこと。

- [ ] **Step 2b: GeminiProvider.test.ts / OpenAIProvider.test.tsを新規作成する（実施必須）**

以下を新規作成する:

`src/background/ai/providers/__tests__/GeminiProvider.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../GeminiProvider.js';
import type { Settings } from '../../../../utils/storage.js';

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
  getRateLimitMessage: vi.fn(() => 'Rate limit exceeded'),
}));
vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })),
}));

describe('GeminiProvider: エラーハンドリング', () => {
  const baseSettings = {
    gemini_api_key: 'test_key',
    gemini_model: 'gemini-3.1-flash-lite',
  } as unknown as Settings;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRestore();
  });

  it('APIキーが空の場合、プロバイダー名を含まないエラーを返す', async () => {
    const provider = new GeminiProvider({ ...baseSettings, gemini_api_key: '' } as Settings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('Gemini');
    expect(result.summary).toContain('API key is missing');
  });

  it('404エラー時、HTTPステータスコードやレスポンス詳細を含まない', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
      json: () => Promise.resolve({}),
    });

    const provider = new GeminiProvider(baseSettings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('404');
    expect(result.summary).not.toContain('Not found');
  });

  it('一般エラー時、レスポンスの生データを含まない', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Detailed error message from API: Invalid request'),
    });

    const provider = new GeminiProvider(baseSettings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('400');
    expect(result.summary).not.toContain('Detailed error message');
    expect(result.summary).not.toContain('Invalid request');
  });

  it('ネットワークエラー時、内部エラー詳細を含まない', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to fetch: Network request failed'),
    );

    const provider = new GeminiProvider(baseSettings);
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).toContain('try again');
    expect(result.summary).not.toContain('Failed to fetch');
    expect(result.summary).not.toContain('Network request');
  });
});
```

`src/background/ai/providers/__tests__/OpenAIProvider.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../OpenAIProvider.js';
import type { Settings } from '../../../../utils/storage.js';

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
  getRateLimitMessage: vi.fn(() => 'Rate limit exceeded'),
  recordUsage: vi.fn(),
}));
vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })),
}));
vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: vi.fn((settings: unknown, provider: string, content: string) => ({
    userPrompt: `summarize: ${content}`,
    systemPrompt: 'You are a helpful assistant.',
  })),
}));
vi.mock('../../../../utils/fetch.js', () => ({
  CONNECTION_TEST_CACHE_MODE: 'no-store',
  fetchWithRetry: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/storage.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage.js')>('../../../../utils/storage.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});

describe('OpenAIProvider: エラーハンドリング', () => {
  const baseSettings = {
    openai_base_url: 'https://api.openai.com/v1',
    openai_api_key: 'test_key',
    openai_model: 'gpt-3.5-turbo',
  } as unknown as Settings;

  beforeEach(async () => {
    global.fetch = vi.fn();
    const fetchModule = await import('../../../../utils/fetch.js');
    vi.mocked(fetchModule.fetchWithRetry).mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Detailed error message from OpenAI API'),
    } as Response);
  });

  afterEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRestore();
  });

  it('APIエラー時、HTTPステータスコード・レスポンス詳細・プロバイダー名を含まない', async () => {
    const provider = new OpenAIProvider(baseSettings, 'openai');
    const result = await provider.generateSummary('content', false, '');

    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('401');
    expect(result.summary).not.toContain('Detailed error message');
    expect(result.summary).not.toContain('OpenAI');
  });
});
```

このステップはStep 2の確認結果により実施必須と確定済み（上記参照）。

- [ ] **Step 3: 新規テストを実行してからコミットする**

Run: `npx vitest run src/background/ai/providers/__tests__/GeminiProvider.test.ts src/background/ai/providers/__tests__/OpenAIProvider.test.ts`
Expected: 全件PASS

```bash
git add src/background/ai/providers/__tests__/GeminiProvider.test.ts src/background/ai/providers/__tests__/OpenAIProvider.test.ts
git commit -m "test(ai): GeminiProvider/OpenAIProviderのエラーハンドリングテストを追加"
```

---

### Task 2: RemoteAIService.test.tsにカバレッジを拡充する

**Files:**
- Modify: `src/background/ai/__tests__/RemoteAIService.test.ts`

対応表の「RemoteAIService.test.tsへ新規追加」17件を、既存ファイルの末尾（135行目の`});`の直前）に追記する。既存の`makeProvider`/`createService`ヘルパーをそのまま再利用する。

- [ ] **Step 1: 未知プロバイダー時のエラーメッセージテストを追加（対応表#1,2）**

`src/background/ai/__tests__/RemoteAIService.test.ts`の134行目（`});`の直前、`describe('RemoteAIService', ...)`ブロック内末尾）に追加:

```typescript
  it('未知のプロバイダーの場合、設定不備エラーを返す', async () => {
    const service = createService([{ provider: 'unknown-provider' }]);

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('unknown-provider');
    expect(result.summary).toContain('AI provider configuration is missing');
    expect(result.summary).toContain('check your settings');
  });
```

- [ ] **Step 2: テストを実行し失敗しないことを確認する（既存動作の再確認のため、実際にはPASSする想定）**

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "未知のプロバイダーの場合"`
Expected: PASS（`RemoteAIService.processSummarySlot`は既存実装で対応済みのため、テスト追加のみでPASSする）

- [ ] **Step 3: registerProviderの動作確認テストを追加（対応表#12）**

```typescript
  it('registerProviderで登録したカスタムプロバイダーが実際に呼ばれる', async () => {
    const service = createService([{ provider: 'custom' }]);
    const customProvider = makeProvider('custom summary');
    service.registerProvider('custom', () => customProvider);

    const result = await service.generateSummary('content');

    expect(customProvider.generateSummary).toHaveBeenCalled();
    expect(result.summary).toBe('custom summary');
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "registerProviderで登録した"`
Expected: PASS

- [ ] **Step 4: in-flight重複排除の追加観点を追加（対応表#14,15,17）**

```typescript
  it('異なるURLへの並行呼び出しはそれぞれ独立してAPIを呼び出す', async () => {
    const service = createService([{ provider: 'test' }]);
    let callCount = 0;
    service.registerProvider('test', () => {
      callCount++;
      return makeProvider(`summary-${callCount}`);
    });

    await Promise.all([
      service.generateSummary('content', { url: 'https://example.com/a' }),
      service.generateSummary('content', { url: 'https://example.com/b' }),
    ]);

    expect(callCount).toBe(2);
  });

  it('完了後は同一URLへの新規呼び出しで再度APIが呼ばれる', async () => {
    const service = createService([{ provider: 'test' }]);
    let callCount = 0;
    service.registerProvider('test', () => {
      callCount++;
      return makeProvider('ok');
    });

    const url = 'https://example.com/article';
    await service.generateSummary('content', { url });
    expect(callCount).toBe(1);

    await service.generateSummary('content', { url });
    expect(callCount).toBe(2);
  });

  it('失敗時もin-flightマップから削除され、次の呼び出しで再試行できる', async () => {
    const service = createService([{ provider: 'fail' }]);
    let callCount = 0;
    service.registerProvider('fail', () => ({
      generateSummary: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error('API error'));
      }),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    }));

    const url = 'https://example.com/article';
    await service.generateSummary('content', { url });
    expect(callCount).toBe(1);

    await service.generateSummary('content', { url });
    expect(callCount).toBe(2);
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "並行呼び出し"`
Expected: PASS

- [ ] **Step 5: testConnectionの未知プロバイダー・例外・elapsedMsテストを追加（対応表#19,21,22,28）**

```typescript
  it('testConnection: 未知のプロバイダーでエラーを返す', async () => {
    const service = createService([{ provider: 'unknown' }]);

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown provider: unknown');
  });

  it('testConnection: プロバイダーがthrowした場合エラー結果を返す', async () => {
    const service = createService([{ provider: 'throwing' }]);
    service.registerProvider('throwing', () => ({
      generateSummary: vi.fn().mockResolvedValue({ success: true, summary: 'ok' }),
      testConnection: vi.fn().mockRejectedValue(new Error('Connection test internal error')),
    }));

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.providers[0].message).toContain('Connection test internal error');
  });

  it('testConnection: 各プロバイダーの結果に非負のelapsedMsを含める', async () => {
    const service = createService([{ provider: 'a' }, { provider: 'b' }]);
    service.registerProvider('a', () => makeProvider('ok-a'));
    service.registerProvider('b', () => makeProvider('ok-b'));

    const result = await service.testConnection();

    expect(result.providers.length).toBe(2);
    for (const provider of result.providers) {
      expect(typeof provider.elapsedMs).toBe('number');
      expect(Number.isNaN(provider.elapsedMs)).toBe(false);
      expect(provider.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('testConnection: 未知のプロバイダーの結果にもelapsedMsを含める', async () => {
    const service = createService([{ provider: 'unknown' }]);

    const result = await service.testConnection();

    expect(result.providers).toHaveLength(1);
    expect(typeof result.providers[0].elapsedMs).toBe('number');
    expect(result.providers[0].elapsedMs).toBeGreaterThanOrEqual(0);
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "testConnection"`
Expected: PASS

- [ ] **Step 6: recordAuditLog呼び出しのテストを追加（対応表#25,26）**

まずファイル冒頭のimportに`recordAuditLog`のモックを追加する必要がある。`src/background/ai/__tests__/RemoteAIService.test.ts`の1行目付近を編集:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';
import { AIProviderStrategy } from '../providers/index.js';
import { recordAuditLog } from '../../../utils/auditLog.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));
```

その上でテストを追加:

```typescript
  it('generateSummary前にrecordAuditLogをprovider名とurlで呼ぶ', async () => {
    const service = createService([{ provider: 'test' }]);
    service.registerProvider('test', () => makeProvider('ok'));

    await service.generateSummary('content', { url: 'https://example.com/audit-test' });

    expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'test', url: 'https://example.com/audit-test' });
  });

  it('フォールバック中は試行した各プロバイダーについてrecordAuditLogが呼ばれる', async () => {
    const service = createService([{ provider: 'fail' }, { provider: 'success' }]);
    service.registerProvider('fail', () => makeProvider('fail', false));
    service.registerProvider('success', () => makeProvider('success'));

    await service.generateSummary('content', { url: 'https://example.com/fallback-test' });

    expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'fail', url: 'https://example.com/fallback-test' });
    expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'success', url: 'https://example.com/fallback-test' });
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "recordAuditLog"`
Expected: PASS

- [ ] **Step 7: プロバイダー例外時の内部情報非漏洩テストを追加（対応表#27強化）**

```typescript
  it('プロバイダーがthrowした場合、内部エラーメッセージを含まない汎用メッセージを返す', async () => {
    const service = createService([{ provider: 'throwing' }]);
    service.registerProvider('throwing', () => ({
      generateSummary: vi.fn().mockRejectedValue(new Error('Provider internal error')),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    }));

    const result = await service.generateSummary('content');

    expect(result.summary).toContain('Error:');
    expect(result.summary).toContain('Failed to generate summary');
    expect(result.summary).not.toContain('Provider internal error');
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "内部エラーメッセージを含まない"`
Expected: PASS

- [ ] **Step 8: MAX_PROVIDERS制限テストを追加（対応表#29）**

```typescript
  it('MAX_PROVIDERS(10)を超えるスロットは切り捨てられる', async () => {
    const slots = Array.from({ length: 30 }, (_, i) => ({ provider: 'test', model: `model-${i}` }));
    const service = createService(slots);
    let callCount = 0;
    service.registerProvider('test', () => {
      callCount++;
      return makeProvider('ok');
    });

    const result = await service.testConnection();

    expect(callCount).toBeLessThanOrEqual(10);
    expect(result.providers.length).toBeLessThanOrEqual(10);
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "MAX_PROVIDERS"`
Expected: PASS

- [ ] **Step 9: 優先度フォールバックの最小長・空リストテストを追加（対応表#31,33）**

```typescript
  it('要約が最小長未満の場合、次のプロバイダーにフォールバックする', async () => {
    const getSettings = async () => ({
      ai_provider_priority_list: [{ provider: 'short' }, { provider: 'long' }],
      summary_min_length: 20,
    } as Record<string, unknown>);
    const service = new RemoteAIService({ getSettings });
    service.registerProvider('short', () => makeProvider('短い'));
    service.registerProvider('long', () => makeProvider('これは20文字以上ある十分な長さの要約結果テキストです。'));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(true);
    expect(result.summary).toContain('20文字以上');
  });

  it('優先度リストが空配列の場合、旧AI_PROVIDER単一設定にフォールバックする', async () => {
    const getSettings = async () => ({
      ai_provider_priority_list: [],
      ai_provider: 'legacy',
      summary_min_length: 0,
    } as Record<string, unknown>);
    const service = new RemoteAIService({ getSettings });
    service.registerProvider('legacy', () => makeProvider('legacy summary'));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('legacy summary');
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "フォールバック"`
Expected: PASS

- [ ] **Step 10: onProgressの複数スロット順序保証・モデル解決・省略時テストを追加（対応表#34,35,36）**

```typescript
  it('優先度リストの各プロバイダー開始時にonProgressが順番に呼ばれる', async () => {
    const service = createService([{ provider: 'a' }, { provider: 'b', model: 'model-b' }]);
    service.registerProvider('a', () => makeProvider('ok-a'));
    service.registerProvider('b', () => makeProvider('ok-b'));
    const onProgress = vi.fn();

    await service.testConnection(onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { provider: 'a', model: undefined, index: 0, total: 2 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { provider: 'b', model: 'model-b', index: 1, total: 2 });
  });

  it('スロットにmodel未指定でも、設定済みデフォルトモデルを解決してonProgressに渡す', async () => {
    const getSettings = async () => ({
      ai_provider_priority_list: [{ provider: 'gemini' }],
      gemini_model: 'gemini-3.1-flash-lite',
    } as Record<string, unknown>);
    const service = new RemoteAIService({ getSettings });
    service.registerProvider('gemini', () => makeProvider('ok'));
    const onProgress = vi.fn();

    await service.testConnection(onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      index: 0,
      total: 1,
    });
  });

  it('onProgressを省略しても従来通り動作する', async () => {
    const service = createService([{ provider: 'a' }]);
    service.registerProvider('a', () => makeProvider('ok'));

    const result = await service.testConnection();

    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });
```

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts -t "onProgress"`
Expected: PASS

- [ ] **Step 11: 全体を実行し、35件前後（既存9件+新規17件+強化分）が通ることを確認する**

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts`
Expected: 全テストPASS（既存9件 + 新規約17件 = 26件前後。件数はStep 1〜10の追加数に依存するため、失敗がないことを確認する）

- [ ] **Step 12: Commit**

```bash
git add src/background/ai/__tests__/RemoteAIService.test.ts
git commit -m "test(ai): RemoteAIServiceのテストカバレッジをaiClient.test.tsから移植して拡充"
```

---

### Task 3: aiClient.test.tsを委譲contractテストに縮小する

**Files:**
- Modify: `src/background/__tests__/aiClient.test.ts`（全面書き換え）

- [ ] **Step 1: 既存ファイルの内容を、委譲contract 4件のみに置き換える**

`src/background/__tests__/aiClient.test.ts`の全内容を以下に置き換える:

```typescript
/**
 * aiClient.test.ts
 * AIClient は RemoteAIService への薄い委譲ラッパー。
 * ここでは委譲そのものが正しく行われることのみを検証し、
 * RemoteAIService の実装詳細（優先度フォールバック、エラー整形等）は
 * ai/__tests__/RemoteAIService.test.ts が担当する。
 */

import { describe, it, expect, vi } from 'vitest';
import { AIClient } from '../aiClient.js';
import { RemoteAIService } from '../ai/RemoteAIService.js';

describe('AIClient: RemoteAIServiceへの委譲', () => {
  it('generateSummaryをremoteAiServiceに委譲する', async () => {
    const remoteAiService = new RemoteAIService();
    const spy = vi
      .spyOn(remoteAiService, 'generateSummary')
      .mockResolvedValue({ success: true, summary: 'delegated summary' });
    const client = new AIClient(remoteAiService);

    const result = await client.generateSummary('content', true, 'https://example.com', 'trace-1');

    expect(spy).toHaveBeenCalledWith('content', {
      tagSummaryMode: true,
      url: 'https://example.com',
      traceId: 'trace-1',
    });
    expect(result.summary).toBe('delegated summary');
  });

  it('testConnectionをremoteAiServiceに委譲する', async () => {
    const remoteAiService = new RemoteAIService();
    const spy = vi
      .spyOn(remoteAiService, 'testConnection')
      .mockResolvedValue({ success: true, message: 'ok', providers: [] });
    const client = new AIClient(remoteAiService);
    const onProgress = vi.fn();

    const result = await client.testConnection(onProgress, 'run-1');

    expect(spy).toHaveBeenCalledWith(onProgress, 'run-1');
    expect(result.success).toBe(true);
  });

  it('registerProviderをremoteAiServiceに委譲する', () => {
    const remoteAiService = new RemoteAIService();
    const spy = vi.spyOn(remoteAiService, 'registerProvider');
    const client = new AIClient(remoteAiService);
    const factory = vi.fn();

    client.registerProvider('custom', factory);

    expect(spy).toHaveBeenCalledWith('custom', factory);
  });

  it('remoteAiServiceを渡さない場合はデフォルトでRemoteAIServiceを生成する', () => {
    const client = new AIClient();

    expect(client.remoteAiService).toBeInstanceOf(RemoteAIService);
  });
});
```

- [ ] **Step 2: テストを実行する**

Run: `npx vitest run src/background/__tests__/aiClient.test.ts`
Expected: 4件全てPASS

- [ ] **Step 3: Commit**

```bash
git add src/background/__tests__/aiClient.test.ts
git commit -m "refactor(test): aiClient.test.tsをRemoteAIServiceへの委譲contractテストに縮小"
```

---

### Task 4: aiClient-priority-fallback.test.tsを削除する

**Files:**
- Delete: `src/background/__tests__/aiClient-priority-fallback.test.ts`

- [ ] **Step 1: Task 2で対応表の該当項目が全てRemoteAIService.test.tsに移植済みであることを再確認する**

Run: `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts src/background/__tests__/aiClient.test.ts`
Expected: 全件PASS（Task 2, 3のコミットが両方入っていること）

- [ ] **Step 2: ファイルを削除する**

```bash
git rm src/background/__tests__/aiClient-priority-fallback.test.ts
```

- [ ] **Step 3: プロジェクト全体のテストスイートを実行し、他に参照が無いことを確認する**

Run: `npm test`
Expected: 全テストPASS（削除したファイルへの参照エラーが出ないこと）

- [ ] **Step 4: Commit**

```bash
git commit -m "test(ai): aiClient-priority-fallback.test.tsを削除（RemoteAIService.test.tsに統合済み）"
```

---

### Task 5: 型チェックと最終検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行する**

Run: `npm run validate`
Expected: 型チェック・全テストPASS

- [ ] **Step 3: PBIの受け入れ基準を1件ずつ確認する**

`pbi/2026-08-12-02-refactor-migrate-aiclient-tests-to-aiservice.md`の受け入れ基準:
- [ ] `RemoteAIService`のテストカバレッジが維持されている → Task 2の対応表で確認済み
- [ ] `AIClient`のテストが委譲contractに絞られている → Task 3で4件に縮小済み
- [ ] 全テストが通る → Task 5 Step 2で確認
- [ ] `aiClient-priority-fallback.test.ts`が削除されている → Task 4で確認

---

## Self-Review結果

- **Spec coverage**: PBIの実装内容1〜4は全てTask 1〜4でカバーされている。Task 1はPBIに明記のない事前確認ステップだが、事前調査によりGemini/OpenAIのエラーハンドリングテスト(#3〜8,23,24,30)が`providerParity.test.ts`ではカバーされていないことが判明したため、`GeminiProvider.test.ts`/`OpenAIProvider.test.ts`を新規作成する実装ステップとして必須化した。
- **Placeholder scan**: 全ステップに実コード・実コマンドを記載済み。「TBD」等のプレースホルダーなし。
- **Type consistency**: `RemoteAIService`のコンストラクタ引数`{ getSettings }`、`registerProvider`のシグネチャ、`AiTestProgress`の型（`runId`はoptional）は既存コード(`RemoteAIService.ts`)から転記しており、後続タスクでも一貫している。
