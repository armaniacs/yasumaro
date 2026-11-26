# Log Sensitivity Policy

[日本語](#日本語) | [English](#english)

---

## 日本語

### 機密レベル定義

実装（`src/utils/sensitiveDataMask.ts`）では、機密フィールドは次の2段階に分類されます。判定はキー名の小文字化した部分一致で行います（例: `githubPersonalAccessToken` は `github_pat` 由来の扱いで対象になる）。

#### Level 1（秘密情報）- 完全マスク対象

APIキー・トークン・パスワード等。出力時は値を残さず完全にマスクします。

- APIキー（`api_key`, `apiKey`, `API_KEY`, `fullKey` および設定由来のAPIキー項目: `obsidian_api_key`, `gemini_api_key`, `openai_official_api_key`, `openai_api_key`, `openai_2_api_key`, `provider_api_key`, `github_pat`）
- アクセストークン（`access_token`, `accessToken`, `authToken`, `auth`, `token`）
- リフレッシュトークン（`refresh_token`, `refreshToken`）
- パスワード（`password`, `passwd`）
- 秘密鍵（`private_key`, `privateKey`）
- クライアントシークレット（`client_secret`, `clientSecret`）
- 署名・認証系の内部秘密値（`master_password_hash`, `master_password_pending_hash`, `hmac_secret`）

#### Level 2（個人識別情報）- 部分マスク対象

ユーザー識別情報。出力時は一部を残して部分マスクします（例: メールアドレスは `u***@example.com` の形式）。

- ユーザーID（`user_id`, `userId`）
- メールアドレス（`email`）
- IPアドレス（`ip`, `ipAddress`）
- セッションID（`session_id`, `sessionId`）

上記2段階に該当しない値（HTTPステータスコード、タイムスタンプ、処理時間、機密情報を含まないエラーメッセージ等）は、そのまま出力可能です。

### 使用方法

#### マスク関数の使用

新規コードでは `src/utils/sensitiveDataMask.ts` を直接使用してください。旧 `src/utils/logMasker.ts` と旧 `src/utils/redaction.ts` は削除済みであり、現行では存在しません。新規の参照は `scripts/check-deprecated-aliases.mjs` で禁止されています。

```typescript
import { maskSensitiveData } from '../utils/sensitiveDataMask.js';
import { logError } from '../utils/logger/api.js';

const responseData = await api.getResponse();
logError('Response', { data: maskSensitiveData(responseData, 'partial') });
```

構造化loggerのdetails経路では `src/utils/logger/sanitize.ts` が `maskSecretValueByKey()` によるキー名マスクを自動適用します。直接 `console.log` で出力しないでください。ヘッダー値には `redactHeaderValue()`、既存の安全な誤り出力には `consoleSecureError()` を使います。

#### マスク戦略（full / partial）

- `full`: Level 1 の値を値の型にかかわらず完全に除去します（`[REDACTED]`）。旧 `redaction.ts` 相当。`email` も `full` では `[REDACTED]` になります
- `partial`: Level 1 は文字列値のみ `***` でマスクし、Level 2 は部分マスクします。旧 `logMasker.ts` 相当。ログ出力用は原則こちらを使います

```typescript
maskSensitiveData(data, 'full'); // 完全マスク。既定値
maskSensitiveData(data, 'partial'); // 部分マスク（ログ出力用）
```

深さ100超と循環参照は `[REDACTED: too deep]`（`partial` では `***`）に置換し、例外を投げません。

#### 既存コードへの適用

1. 応答内容を記録する箇所を探す:
   ```bash
   grep -rn "response" src/utils/logger src/background --include="*.ts" | head -40
   ```

2. 各箇所で`maskSensitiveData`を適用:
   ```typescript
   // Before
   logError('API error', { data: error.response });

   // After
   import { maskSensitiveData } from '../utils/sensitiveDataMask.js';
   logError('API error', { data: maskSensitiveData(error.response, 'partial') });
   ```

### 関連ドキュメント

記録パイプラインにおける機密データのマスキングは、[PII_FEATURE_GUIDE.md](PII_FEATURE_GUIDE.md) で説明されているPIIサニタイザー（WASMハイブリッド、21パターン）によって補完されています。

---

## English

### Sensitivity Level Definitions

The implementation (`src/utils/sensitiveDataMask.ts`) classifies sensitive fields into two tiers. Matching is case-insensitive substring matching on the key name (e.g., `githubPersonalAccessToken` matches via the `github_pat` entry).

#### Level 1 (Secrets) ― fully masked

API keys, tokens, passwords, and similar values. Fully masked on output with no residual value.

- API keys (`api_key`, `apiKey`, `API_KEY`, `fullKey`, plus API key fields from settings: `obsidian_api_key`, `gemini_api_key`, `openai_official_api_key`, `openai_api_key`, `openai_2_api_key`, `provider_api_key`, `github_pat`)
- Access tokens (`access_token`, `accessToken`, `authToken`, `auth`, `token`)
- Refresh tokens (`refresh_token`, `refreshToken`)
- Passwords (`password`, `passwd`)
- Private keys (`private_key`, `privateKey`)
- Client secrets (`client_secret`, `clientSecret`)
- Internal signing/authentication secrets (`master_password_hash`, `master_password_pending_hash`, `hmac_secret`)

#### Level 2 (User identifiers) ― partially masked

User-identifying information. Partially masked on output, keeping part of the value (e.g., email addresses become `u***@example.com`).

- User IDs (`user_id`, `userId`)
- Email addresses (`email`)
- IP addresses (`ip`, `ipAddress`)
- Session IDs (`session_id`, `sessionId`)

Values that fall into neither tier (HTTP status codes, timestamps, durations, error messages containing no sensitive data, etc.) may be output as-is.

### Usage

#### Using the mask function

New code must use `src/utils/sensitiveDataMask.ts` directly. The former `src/utils/logMasker.ts` and `src/utils/redaction.ts` have been removed and no longer exist. New references to them are rejected by `scripts/check-deprecated-aliases.mjs`.

```typescript
import { maskSensitiveData } from '../utils/sensitiveDataMask.js';
import { logError } from '../utils/logger/api.js';

const responseData = await api.getResponse();
logError('Response', { data: maskSensitiveData(responseData, 'partial') });
```

The structured logger details path applies key-based masking via `maskSecretValueByKey()` in `src/utils/logger/sanitize.ts` automatically. Do not write directly with `console.log`. Use `redactHeaderValue()` for header values and `consoleSecureError()` for the legacy secure error path.

#### Masking strategies (full / partial)

- `full`: Removes Level 1 values regardless of value type (`[REDACTED]`). Equivalent to the former `redaction.ts`. `email` also becomes `[REDACTED]` under `full`
- `partial`: Masks only string Level 1 values with `***` and partially masks Level 2. Equivalent to the former `logMasker.ts`. Use this for log output

```typescript
maskSensitiveData(data, 'full'); // Full masking. This is the default
maskSensitiveData(data, 'partial'); // Partial masking (for log output)
```

Depth over 100 and circular references are replaced with `[REDACTED: too deep]` (`***` under `partial`) without throwing.

#### Applying to existing code

1. Find places that record response content:
   ```bash
   grep -rn "response" src/utils/logger src/background --include="*.ts" | head -40
   ```

2. Apply `maskSensitiveData` at each site:
   ```typescript
   // Before
   logError('API error', { data: error.response });

   // After
   import { maskSensitiveData } from '../utils/sensitiveDataMask.js';
   logError('API error', { data: maskSensitiveData(error.response, 'partial') });
   ```

### Related Documentation

Sensitive-data masking in the recording pipeline is complemented by the PII sanitizer (WASM hybrid, 21 patterns) described in [PII_FEATURE_GUIDE.md](PII_FEATURE_GUIDE.md).
