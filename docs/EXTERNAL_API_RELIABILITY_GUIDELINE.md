# External API Reliability Guideline

外部APIと連携する機能を実装する際の信頼性設計ガイドライン。このガイドラインは過去のインシデントから抽出した設計パターンに基づく。

## 背景

本プロジェクトでは以下の外部APIと連携している:

| API | 用途 | 特性 |
|-----|------|------|
| AI Provider APIs (OpenAI, Gemini, Groq, Ollama等) | コンテンツ要約・分析 | 高レイテンシ、レート制限あり |
| Obsidian Local REST API | ノート作成 | ローカルホスト、自己署名証明書対応 |

過去のインシデントから、外部API連携の信頼性を確保するための6つの設計パターンを定義する。Chrome Web Store配布は v6.8.1 で終了したため、本文中のCWS事例は過去の記録として残す。現行の適用対象は上表の2系統のみである。

## 1. タイムアウト設定

### 推奨値

実装はリクエスト単位の単一タイムアウト（`timeoutMs`）を使用する。接続タイムアウトと読み取りタイムアウトの分離は行わない。デフォルトは 30,000ms（`fetchWithTimeout` のデフォルト値）。

| API種別 | 単一タイムアウト（`timeoutMs`） | 補足 |
|---------|-------------------------------|------|
| 軽量API（認証、ステータス確認） | 30秒 | OAuthトークン取得、接続試験の到達確認 |
| 中量API（データ取得、要約） | 30秒（ローカルLLM向けは 120秒） | OpenAI/Gemini API呼び出し。AI要約フローでは `AI_TIMEOUT_MS` 設定（0 = 自動）がローカルプロバイダー 120,000ms・その他 30,000ms に解決される |
| 重量API（ファイル取得など） | 最大300秒（5分）まで設定可能 | `fetchWithTimeout` の許容範囲は 100ms〜300,000ms。`validateTimeout` で範囲外は fail-closed |

### 実装例

```typescript
import { fetchWithTimeout } from './src/utils/fetch.js';

const response = await fetchWithTimeout(
  url,
  { blockLocalhost: false }, // Obsidian Local REST・ローカルLLMなど正規のローカル用途のみ明示する。既定は true（拒否）
  30000,
);
```

参照実装: `src/utils/fetch.ts` の `fetchWithTimeout()` 関数。内部では `AbortController` + `setTimeout` で中断し、中断時は `FailureKind.TIMEOUT` を付与した `AbortError` を投げる。環境依存のmessage比較でタイムアウト判定をしないこと。

補足の標準動作:

- リダイレクト追従は既定で無効化する方針である。`NO_REDIRECT_FETCH_POLICY`（`redirect: 'error'`）か `noRedirectInit()` を使う。攻撃者が影響できるURLで追従が必要な場合のみ `fetchWithRedirectGuard()` を使い、各hopを `validateUrlForFilterImport` で再検証する。最大hop数は5である。
- DNSピン留めを使う経路では、検証と接続で同一pinを使い回す。接続後に同一resolverで再解決し、差異があれば応答を破棄する検出型制御である。
- 接続試験のfetchには `CONNECTION_TEST_CACHE_MODE`（`no-store`）を必ず渡す。キャッシュ応答で成功扱いになるのを防ぐ。
- AIプロバイダーURLは `CSPValidator` の許可リスト検証を通す。条件付きCSPが有効な場合のみ適用される。

### インシデントからの教訓

過去のCWS公開ワークフローでは、`curl`コマンドにタイムアウトが設定されておらず、OAuthエンドポイントが応答を返さない場合に15分以上処理がブロックされた。**すべての外部API呼び出しに明示的なタイムアウトを設定すること。**

## 2. リトライ戦略

### 指数バックオフ

```typescript
import { fetchWithRetry } from './src/utils/fetch.js';

const response = await fetchWithRetry(
  url,
  { method: 'GET', timeoutMs: 30000 },
  { maxRetryCount: 3, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 10000 },
);
```

参照実装: `src/utils/fetch.ts` の `fetchWithRetry()` 関数（純粋な指数バックオフ、ジッターなし、リトライ条件のカスタマイズ可能）。遅延計算は `src/utils/backoff.ts` の `backoffDelayMs()`（`min(base * multiplier^attempt, max)`）に一元化されている。HTTP経路とtransport経路のどちらの再試行も同一の `decideRetryAndBackoff` を通る。`maxDelayMs` のデフォルトは 10,000ms だが、呼び出し元で上書きされる: AI要約フローは 60,000ms、接続テストフローは 3,000ms。

### リトライ可能なエラー

- 500番台サーバーエラー（冪等なメソッドの場合のみ。§6参照）
- 503 Service Unavailable（同上）
- ネットワークタイムアウト（`AbortError`、最大1回のみ再試行）
- 接続リセット（ECONNRESETなどtransport異常）
- 一時的なネットワークエラー（fetch failedなど）

### リトライ不可のエラー

- 400番台クライアントエラー
- 401 Unauthorized / 403 Forbidden（認証種別として扱い、即時再試行しない。トークン期限切れは別途処理）
- 404 Not Found
- 422 Unprocessable Entity
- 429 Too Many Requests（レート制限を尊重し、即時再試行しない）

### デフォルトリトライ条件（プロジェクト標準）

判定のSSOTは `src/utils/failureTaxonomy.ts` である。本文の例は要点のみ示す。message部分文字列を再試行判定に使わないこと。

```typescript
import { shouldRetryHttpResponse, shouldRetryTransportFailure } from './src/utils/failureTaxonomy.js';

function defaultShouldRetry(error: Error, attempt: number, response: Response | null, method: string = 'GET'): boolean {
  if (response) {
    return shouldRetryHttpResponse(response.status, method);
  }
  return shouldRetryTransportFailure(error, attempt);
}
```

要点:

- HTTP応答あり: `classifyHttpStatus` で7分類（`network/timeout/http/auth/rate_limit/configuration/csp`）に正規化する。401/403は `auth`、429は `rate_limit` に閉じる。5xxのうち再送できるのは `http` 種別かつ安全なメソッド（GET等）のみである。POST/PUT/PATCH/DELETEは二重生成・二重課金を防ぐため再送しない。
- 応答なし: `resolveFailure` で構造化kindを読む。`TIMEOUT` は最大1回（合計2試行）、`NETWORK` は再試行する。`message` の部分一致は互換用の `LEGACY_TRANSPORT_MARKERS_FULL` に限定し、新規境界では使わない。
- `FAILURE_RETRY_PROFILE` が即時再試行・offline回復・同一要求再送の可否を定める。429（`rate_limit`）と認証（`auth`）と設定（`configuration/csp`）は即時再試行しない。

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

過去のCWS公開ワークフローでは、`uploadState` が `IN_PROGRESS` の状態を無視して即座に `/publish` エンドポイントを呼び出し失敗した。非同期APIを利用する場合は、完了を確認するまでポーリングすること。CWS配布終了後の現行コードに汎用ポーリング実装はないため、新規の非同期API連携で必要になった場合は本節のパターンに従い実装すること。

### 注意点

- ポーリング間隔はAPIのレート制限を考慮すること
- 最大試行回数とタイムアウトを必ず設定すること（無限ループ防止）
- ポーリング中の各試行にもタイムアウトを設定すること

## 4. エラーハンドリング

### 一時的エラーと永続的エラーの区別

message比較ではなく、構造化kindで判定する。SSOTは `src/utils/failureTaxonomy.ts` である。

```typescript
import { resolveFailure, FAILURE_RETRY_PROFILE } from './src/utils/failureTaxonomy.js';

function isRetryableError(error: unknown): boolean {
  const failure = resolveFailure(error);
  if (!failure) return false;
  return FAILURE_RETRY_PROFILE[failure.kind].immediateRetry;
}
```

429（`rate_limit`）は即時再試行しない（レート制限を尊重。§2 のデフォルトリトライ条件と同様）。401/403（`auth`）と設定異常（`configuration/csp`）も再試行しない。

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

参照: プロジェクトのエラーコード体系は `dev-docs/ERROR_CODES.md` を参照すること。`FailureMetadata` にはmessageや応答本文や秘密情報を入れない。原因の `name`（AbortErrorなど）のみ残す。

### インシデントからの教訓

過去のCWS APIでは `itemError` が非可読形式で出力されており、デバッグに時間を要した。エラー情報は人間が読める形式で出力し、可能な限り詳細を含めること。

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

上記は考え方の例である。現行のAI Provider向け実装は `src/background/ai/providerBreaker.ts` を参照すること。

### 適用基準

サーキットブレーカーは以下の条件をすべて満たす場合に導入を検討すること:

1. APIが頻繁にタイムアウト・ダウンする（週1回以上の頻度）
2. 失敗が連続して発生する場合、後続のリクエストが無意味
3. ユーザー体験に大きな影響がある（UIブロッキング等）

AI Provider連携にはcross-requestのサーキットブレーカーを導入済みである。`src/background/ai/providerBreaker.ts` がprovider x model単位で連続失敗を数え、cooldown中のスロットを要約のfallback loopから除外する（`src/background/ai/RemoteAIService.ts`）。stateは`chrome.storage.session`にsession-scopedで保存し、browserを閉じると消える。閾値・cooldown時間・half-open probeなどの数値のSSOTは`dev-docs/archived/plans/2026-09-27-pbi15-ai-provider-circuit-breaker-policy.md`の§3・§4であり、本ガイドラインでは再定義しない。breakerはユーザー設定`ai_provider_breaker_enabled`（既定ON、dashboardのAIプロバイダー設定でOFFにできる）で無効化できる。認証情報を差し替えて直ちに回復したい場合は、接続試験が成功したときにbreaker stateが全消去される。接続試験の失敗はstateに反映しない。Obsidian Local REST APIをはじめとする他のAPI連携には導入していない。

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
- プロジェクト内のObsidian API呼び出し（ノート作成）は冪等ではないため、リトライ前に重複チェックを行うこと。現行の `fetchWithRetry` は非安全メソッドの5xx再送を行わないため、この注意は呼び出し側の設計で守ること

## 7. セキュリティ考慮事項

外部API連携におけるセキュリティ設計は以下のドキュメントも参照すること:

- **SSRF対策**: `src/utils/ssrfGuard.ts` で定義され `src/utils/fetch.ts` から再エクスポートされる `validateUrlForAIRequests()` 関数（プライベートIPブロック、ポート制限）。呼び出し側は `blockLocalhost` の既定拒否を保ち、ローカル用途でのみ `false` を明示する。DNSピン留めと転送先再検証（`fetchWithRedirectGuard`）も同ファイル群で扱う
- **APIキー管理**: PBKDF2 + AES-GCM暗号化 (`src/utils/crypto/`)
- **CSP検証**: `src/utils/cspValidator.ts` によるAIプロバイダーURLの許可リスト検証
- **PIIマスキング**: `src/utils/piiSanitizer.ts` による個人情報保護

## 8. 既存コードとの対応関係

このガイドラインの各パターンと既存コードの対応:

| パターン | 既存実装 | 状態 |
|---------|---------|------|
| タイムアウト | `src/utils/fetch.ts#fetchWithTimeout` | 実装済み（パラメータ検証付き。`NO_REDIRECT_FETCH_POLICY`、`fetchWithRedirectGuard`、DNSピン留め、`CONNECTION_TEST_CACHE_MODE` を含む） |
| リトライ戦略 | `src/utils/fetch.ts#fetchWithRetry` + `src/utils/failureTaxonomy.ts` | 実装済み（指数バックオフ + 構造化kind判定。`defaultShouldRetry` は `shouldRetryHttpResponse` / `shouldRetryTransportFailure` に委譲） |
| ポーリング設計 | 汎用実装なし | パターンのみ定義。旧CWS用bash実装は配布終了（v6.8.1）とともに削除 |
| エラーハンドリング | `src/utils/logger/` + `src/utils/failureTaxonomy.ts` | 実装済み（構造化ログ + 7分類kind。message比較は互換用途のみ） |
| サーキットブレーカー | `src/background/ai/providerBreaker.ts` | 実装済み（AI Provider連携のみ。既定ON・`ai_provider_breaker_enabled` で無効化可能・接続試験成功で state を全消去） |
| 冪等性 | 未対応 | 将来の課題（POSTリトライ時。現行は非安全メソッドの自動再送を抑止する側の対応のみ） |

## 改訂履歴

- 2026-11-26: CWS配布終了（v6.8.1）に伴い背景と§1・§3・§4・§8を現行構成に同期。§2・§4の判定を `failureTaxonomy.ts` のSSOTに置換。429の扱いの矛盾を修正。§1に転送抑止・DNSピン留め・接続試験cache抑止を追記
- 2026-09-27: §5 適用基準と §8 の対応関係を、AI Provider向けサーキットブレーカー（`src/background/ai/providerBreaker.ts`）の実装に同期
- 2026-07-25: 初版作成。PBI 03（CWS公開信頼性向上）のインシデント分析に基づく
