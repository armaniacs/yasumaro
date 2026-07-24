# Log Sensitivity Policy

## 機密レベル定義

### Level 1 (Secret) - 絶対出力禁止
- APIキー（`api_key`, `apiKey`, `API_KEY`）
- アクセストークン（`access_token`, `accessToken`）
- リフレッシュトークン（`refresh_token`, `refreshToken`）
- パスワード（`password`, `passwd`）
- 秘密鍵（`private_key`, `privateKey`）
- クライアントシークレット（`client_secret`, `clientSecret`）

### Level 2 (Confidential) - マスク必須
- ユーザーID（`user_id`, `userId`）
- メールアドレス（`email`）
- IPアドレス（`ip`, `ipAddress`）
- セッションID（`session_id`, `sessionId`）

### Level 3 (Internal) - 状況に応じてマスク
- リクエストID（`request_id`, `requestId`）
- トランザクションID（`transaction_id`）
- 内部エラーコード

### Level 4 (Public) - 出力可能
- HTTPステータスコード
- タイムスタンプ
- 処理時間
- エラーメッセージ（機密情報を含まないもの）

## 使用方法

### マスク関数の使用

```typescript
import { maskSensitiveData } from '../utils/logMasker.js';

const responseData = await api.getResponse();
console.log('Response:', maskSensitiveData(responseData));
```

### 既存コードへの適用

1. エラーレスポンスをログ出力する箇所を探す:
   ```bash
   grep -rn "console.log.*response\|console.error.*response" src/
   ```

2. 各箇所で`maskSensitiveData`を適用:
   ```typescript
   // Before
   console.error('API error:', error.response);

   // After
   console.error('API error:', maskSensitiveData(error.response));
   ```
