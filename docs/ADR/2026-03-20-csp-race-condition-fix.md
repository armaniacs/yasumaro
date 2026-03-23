# CSP初期化前のレースコンディション修正

## Context

Chrome Service Workerは起動直後に設定が読み込まれるまで非同期で初期化が行われます。CSPValidatorはユーザー設定(`conditional_csp_providers`)に基づいて許可ドメインを動的に更新しますが、初期化前の`safeFetch()`呼び出しではデフォルトドメインのみ許可されます。

**問題点:**
- Service Worker起動直後のAPIリクエストが未保護状態
- 同期的な`initialized`フラグによる初期化完了判断が不十分
- 初期化完了前のリクエストがキューイングされない

**影響範囲:**
- `src/utils/cspValidator.ts`
- `src/utils/fetch.ts`（safeFetchを使用）

## Decision

### 1. 初期化Promiseの導入

同期的な`initialized`フラグを非同期の`init Promise`に置き換えます。

```typescript
private static initPromise: Promise<void> | null = null;
private static resolveInit: (() => void) | null = null;
```

### 2. リクエストキューイング

初期化中の`safeFetch()`リクエストをキューイングし、初期化完了後に実行します。

```typescript
private static requestQueue: Array<{
  url: string;
  options?: RequestInit;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
}> = [];

static async safeFetch(url: string, options?: RequestInit): Promise<Response> {
  // 初期化中はキューイング
  if (CSPValidator.initPromise) {
    return new Promise((resolve, reject) => {
      CSPValidator.requestQueue.push({ url, options, resolve, reject });
    });
  }

  // 通常処理
  if (!CSPValidator.isUrlAllowed(url)) {
    const error = new Error(`URL blocked by CSP policy: ${url}`);
    (error as any).code = 'CSP_BLOCKED';
    throw error;
  }
  return fetch(url, options);
}
```

### 3. 初期化完了時のキュー処理

```typescript
private static completeInitialization(): void {
  if (CSPValidator.resolveInit) {
    CSPValidator.resolveInit();
    CSPValidator.resolveInit = null;
  }
  CSPValidator.processQueue();
}

private static processQueue(): void {
  const queue = [...CSPValidator.requestQueue];
  CSPValidator.requestQueue = [];

  for (const { url, options, resolve, reject } of queue) {
    safeFetch(url, options).then(resolve).catch(reject);
  }
}
```

## Consequences

### Positive

- Service Worker起動直後のレースコンディションを解消
- 初期化中のリクエストが確実に保護される
- 非同期初期化の状態管理が明確になる

### Negative

- リクエストキューによる軽微な遅延が発生
- `safeFetch()`のインターフェース変更（返り値が`Promise<Response>`)
- キュー上限を設けない場合はメモリ消費の可能性

### Mitigation

- キュー上限（例: 100件）を設定し、超過時は即時エラー
- 初期化タイムアウト（例: 5秒）を設定
- 既存のテストケースとの互換性を維持

## Alternatives Considered

### Alternative A: 初期化完了までブロック

```typescript
static async safeFetch(url: string, options?: RequestInit): Promise<Response> {
  await CSPValidator.initPromise;
  // ...
}
```

**Pros:** シンプル
**Cons:** 全リクエストが初期化待ちになる、ユーザー体験悪化

### Alternative B: デフォルトドメインのみ許可（現状）

**Pros:** 実装不要
**Cons:** セキュリティ上のリスク、ユーザー設定が反映されない

→ **Decision**: C（キューイング）を採用

## Implementation Steps

1. [ ] `cspValidator.ts`に初期化Promiseとリクエストキューシステムを実装
2. [ ] `initializeFromSettings()`で初期化完了を管理
3. [ ] TDDテスト追加（初期化前キューイング、初期化後実行）
4. [ ] `fetch.ts`（既存）への影響確認
5. [ ] 文書更新

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: 待機
- **Superseded By**: -