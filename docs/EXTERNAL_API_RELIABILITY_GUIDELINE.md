# External API Reliability Guideline

外部APIと連携する機能を実装する際の信頼性設計ガイドライン。このガイドラインは過去のインシデントから抽出した設計パターンに基づく。

## 背景

本プロジェクトでは以下の外部APIと連携している:

| API | 用途 | 特性 |
|-----|------|------|
| AI Provider APIs (OpenAI, Gemini, Groq, Ollama等) | コンテンツ要約・分析 | 高レイテンシ、レート制限あり |
| Obsidian Local REST API | ノート作成 | ローカルホスト、自己署名証明書対応 |
| Chrome Web Store API | 拡張機能公開 | 非同期処理（IN_PROGRESS状態） |

過去のインシデントから、外部API連携の信頼性を確保するための6つの設計パターンを定義する。

## 1. タイムアウト設定

### 推奨値

| API種別 | 接続タイムアウト | 読み取りタイムアウト | 補足 |
|---------|-----------------|---------------------|------|
| 軽量API（認証、ステータス確認） | 10秒 | 30秒 | OAuthトークン取得、CWS status check |
| 中量API（データ取得、要約） | 10秒 | 60秒 | OpenAI/Gemini API呼び出し |
| 重量API（ファイルアップロード） | 10秒 | 300秒（5分） | CWS zip upload |

### 実装例

```typescript
const response = await fetch(url, {
  signal: AbortSignal.timeout(30000), // 30秒
});
```

参照実装: `src/utils/fetch.ts` の `fetchWithTimeout()` 関数。

### インシデントからの教訓

CWS公開ワークフローで、`curl`コマンドにタイムアウトが設定されておらず、OAuthエンドポイントが応答を返さない場合に15分以上処理がブロックされた。**すべての外部API呼び出しに明示的なタイムアウトを設定すること。**

## 2. リトライ戦略

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

参照実装: `src/utils/fetch.ts` の `fetchWithRetry()` 関数（指数バックオフ + ジッター、最大遅延10秒、リトライ条件のカスタマイズ可能）。

### リトライ可能なエラー

- 500番台サーバーエラー
- 503 Service Unavailable
- 429 Too Many Requests
- ネットワークタイムアウト（ETIMEDOUT）
- 接続リセット（ECONNRESET）
- 一時的なネットワークエラー（fetch failed）

### リトライ不可のエラー

- 400番台クライアントエラー
- 401 Unauthorized（トークン期限切れは別途処理）
- 403 Forbidden
- 404 Not Found
- 422 Unprocessable Entity

### デフォルトリトライ条件（プロジェクト標準）

```typescript
function defaultShouldRetry(error: Error, attempt: number, response: Response | null): boolean {
  // 429 Too Many Requests: リトライしない（レート制限を尊重）
  if (response && response.status === 429) return false;

  // 5xxサーバーエラー: 通常リトライ
  if (response && response.status >= 500) return true;

  // タイムアウト: 最大1回のみリトライ（合計2試行）
  if (error.message.includes('timed out')) return attempt <= 1;

  // その他のネットワークエラー
  if (error.message.includes('NetworkError') || error.message.includes('fetch failed')) return true;

  return false;
}
```

## 3. ポーリング設計

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

| 処理種別 | 間隔 | 最大試行回数 | 最大待機時間 |
|---------|------|-------------|-------------|
| 短期処理（数秒） | 1-2秒 | 15回 | 30秒 |
| 中期処理（数分） | 10秒 | 30回 | 5分 |
| 長期処理（数十分） | 30秒 | 20回 | 10分 |

### インシデントからの教訓

CWS公開ワークフローで、`uploadState` が `IN_PROGRESS` の状態を無視して即座に `/publish` エンドポイントを呼び出し失敗した。非同期APIを利用する場合は、完了を確認するまでポーリングすること。

### 注意点

- ポーリング間隔はAPIのレート制限を考慮すること
- 最大試行回数とタイムアウトを必ず設定すること（無限ループ防止）
- ポーリング中の各試行にもタイムアウトを設定すること

## 4. エラーハンドリング

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

### 構造化エラーログ

```typescript
logError('API call failed', {
  url,
  status: response?.status,
  error: error.message,
  attempt,
  component: 'fetchWithRetry'
});
```

参照: プロジェクトのエラーコード体系は `dev-docs/ERROR_CODES.md` を参照すること。

### インシデントからの教訓

CWS API の `itemError` が非可読形式で出力されており、デバッグに時間を要した。エラー情報は人間が読める形式で出力し、可能な限り詳細を含めること。

## 5. サーキットブレーカー

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

### 適用基準

サーキットブレーカーは以下の条件をすべて満たす場合に導入を検討すること:

1. APIが頻繁にタイムアウト・ダウンする（週1回以上の頻度）
2. 失敗が連続して発生する場合、後続のリクエストが無意味
3. ユーザー体験に大きな影響がある（UIブロッキング等）

現時点では本プロジェクトの全API連携においてサーキットブレーカーの導入は必須ではないが、将来のAI Provider追加時には検討すること。

## 6. 冪等性

### 再試行の安全性確保

| HTTPメソッド | 冪等性 | 補足 |
|-------------|--------|------|
| GET | 冪等 | 安全に再試行可能 |
| PUT | 冪等 | 同一リクエストは同一結果 |
| DELETE | 冪等 | 初回以降の削除要求は無視される |
| POST | 非冪等 | Idempotency-Keyが必要な場合あり |

### Idempotency-Keyを使用したPOST

```typescript
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify(data),
});
```

### 注意点

- すべてのAPIがIdempotency-Keyをサポートしているわけではない
- 冪等性が保証されないPOSTの再試行は、重複登録のリスクがある
- プロジェクト内のObsidian API呼び出し（ノート作成）は冪等ではないため、リトライ前に重複チェックを行うこと

## 7. セキュリティ考慮事項

外部API連携におけるセキュリティ設計は以下のドキュメントも参照すること:

- **SSRF対策**: `src/utils/fetch.ts` の `validateUrlForAIRequests()` 関数（プライベートIPブロック、ポート制限）
- **APIキー管理**: PBKDF2 + AES-GCM暗号化 (`src/utils/crypto.ts`)
- **CSP検証**: `src/utils/cspValidator.ts` によるAIプロバイダーURLの許可リスト検証
- **PIIマスキング**: `src/utils/piiSanitizer.ts` による個人情報保護

## 8. 既存コードとの対応関係

このガイドラインの各パターンと既存コードの対応:

| パターン | 既存実装 | 状態 |
|---------|---------|------|
| タイムアウト | `src/utils/fetch.ts#fetchWithTimeout` | 実装済み（パラメータ検証付き） |
| リトライ戦略 | `src/utils/fetch.ts#fetchWithRetry` | 実装済み（指数バックオフ + カスタム条件） |
| ポーリング設計 | 未実装 | Task TODO: `pbi/2026-07-25-03-fix-cws-publish-reliability.md` でbash実装 |
| エラーハンドリング | `src/utils/logger.ts` | 実装済み（構造化ログ） |
| サーキットブレーカー | 未実装 | 将来の課題 |
| 冪等性 | 未対応 | 将来の課題（POSTリトライ時） |

## 改訂履歴

- 2026-07-25: 初版作成。PBI 03（CWS公開信頼性向上）のインシデント分析に基づく
