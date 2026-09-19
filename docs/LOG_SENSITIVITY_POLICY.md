# Log Sensitivity Policy

[日本語](#日本語) | [English](#english)

---

## 日本語

### 機密レベル定義

実装（`src/utils/sensitiveDataMask.ts`）では、機密フィールドは次の2段階に分類されます。

#### Level 1（秘密情報）- 完全マスク対象

APIキー・トークン・パスワード等。出力時は値を残さず完全にマスクします。

- APIキー（`api_key`, `apiKey`, `API_KEY`, `fullKey` および設定由来のAPIキー項目）
- アクセストークン（`access_token`, `accessToken`, `authToken`, `auth`, `token`）
- リフレッシュトークン（`refresh_token`, `refreshToken`）
- パスワード（`password`, `passwd`）
- 秘密鍵（`private_key`, `privateKey`）
- クライアントシークレット（`client_secret`, `clientSecret`）
- 署名・認証系の内部秘密値（`master_password_hash`, `hmac_secret`）

#### Level 2（個人識別情報）- 部分マスク対象

ユーザー識別情報。出力時は一部を残して部分マスクします（例: メールアドレスは `u***@example.com` の形式）。

- ユーザーID（`user_id`, `userId`）
- メールアドレス（`email`）
- IPアドレス（`ip`, `ipAddress`）
- セッションID（`session_id`, `sessionId`）

上記2段階に該当しない値（HTTPステータスコード、タイムスタンプ、処理時間、機密情報を含まないエラーメッセージ等）は、そのまま出力可能です。

### 使用方法

#### マスク関数の使用

新規コードでは `src/utils/sensitiveDataMask.ts` を直接使用してください。`src/utils/logMasker.ts` と `src/utils/redaction.ts` は後方互換のためのシムであり、新規コードでは使用しないでください。

```typescript
import { maskSensitiveData } from '../utils/sensitiveDataMask.js';

const responseData = await api.getResponse();
console.log('Response:', maskSensitiveData(responseData, 'partial'));
```

#### マスク戦略（full / partial）

- `full`: 旧 `redaction.ts` 相当。Level 1 の値を完全に除去します（`[REDACTED]`）
- `partial`: 旧 `logMasker.ts` 相当。Level 1 は `***` でマスクし、Level 2 は部分マスクします

```typescript
maskSensitiveData(data, 'full'); // 完全マスク
maskSensitiveData(data, 'partial'); // 部分マスク（ログ出力用）
```

#### 既存コードへの適用

1. エラーレスポンスをログ出力する箇所を探す:
   ```bash
   grep -rn "console.log.*response\|console.error.*response" src/
   ```

2. 各箇所で`maskSensitiveData`を適用:
   ```typescript
   // Before
   console.error('API error:', error.response);

   // After
   import { maskSensitiveData } from '../utils/sensitiveDataMask.js';
   console.error('API error:', maskSensitiveData(error.response, 'partial'));
   ```

### 関連ドキュメント

記録パイプラインにおける機密データのマスキングは、[PII_FEATURE_GUIDE.md](PII_FEATURE_GUIDE.md) で説明されているPIIサニタイザー（WASMハイブリッド、21パターン）によって補完されています。

---

## English

### Sensitivity Level Definitions

The implementation (`src/utils/sensitiveDataMask.ts`) classifies sensitive fields into two tiers.

#### Level 1 (Secrets) — fully masked

API keys, tokens, passwords, and similar values. Fully masked on output with no residual value.

- API keys (`api_key`, `apiKey`, `API_KEY`, `fullKey`, plus API key fields from settings)
- Access tokens (`access_token`, `accessToken`, `authToken`, `auth`, `token`)
- Refresh tokens (`refresh_token`, `refreshToken`)
- Passwords (`password`, `passwd`)
- Private keys (`private_key`, `privateKey`)
- Client secrets (`client_secret`, `clientSecret`)
- Internal signing/authentication secrets (`master_password_hash`, `hmac_secret`)

#### Level 2 (User identifiers) — partially masked

User-identifying information. Partially masked on output, keeping part of the value (e.g., email addresses become `u***@example.com`).

- User IDs (`user_id`, `userId`)
- Email addresses (`email`)
- IP addresses (`ip`, `ipAddress`)
- Session IDs (`session_id`, `sessionId`)

Values that fall into neither tier (HTTP status codes, timestamps, durations, error messages containing no sensitive data, etc.) may be output as-is.

### Usage

#### Using the mask function

New code must use `src/utils/sensitiveDataMask.ts` directly. `src/utils/logMasker.ts` and `src/utils/redaction.ts` are compatibility shims kept for existing callers; do not use them in new code.

```typescript
import { maskSensitiveData } from '../utils/sensitiveDataMask.js';

const responseData = await api.getResponse();
console.log('Response:', maskSensitiveData(responseData, 'partial'));
```

#### Masking strategies (full / partial)

- `full`: Equivalent to the former `redaction.ts`. Fully removes Level 1 values (`[REDACTED]`)
- `partial`: Equivalent to the former `logMasker.ts`. Masks Level 1 with `***` and partially masks Level 2

```typescript
maskSensitiveData(data, 'full'); // Full masking
maskSensitiveData(data, 'partial'); // Partial masking (for log output)
```

#### Applying to existing code

1. Find places that log error responses:
   ```bash
   grep -rn "console.log.*response\|console.error.*response" src/
   ```

2. Apply `maskSensitiveData` at each site:
   ```typescript
   // Before
   console.error('API error:', error.response);

   // After
   import { maskSensitiveData } from '../utils/sensitiveDataMask.js';
   console.error('API error:', maskSensitiveData(error.response, 'partial'));
   ```

### Related Documentation

Sensitive-data masking in the recording pipeline is complemented by the PII sanitizer (WASM hybrid, 21 patterns) described in [PII_FEATURE_GUIDE.md](PII_FEATURE_GUIDE.md).
