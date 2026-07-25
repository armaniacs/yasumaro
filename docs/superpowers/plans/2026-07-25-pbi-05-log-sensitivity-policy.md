# PBI 05: ログ出力の機密性分類ポリシー策定 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログ出力時の機密情報ハンドリングポリシーを策定する

**Architecture:** 機密レベルを4段階で定義し、各レベルに対するマスク方法を規定。既存コードへの適用方針を明記。

**Tech Stack:** Markdown, TypeScript (for mask function)

---

## タスク概要

1. **Task 1: 機密レベル定義** - 4段階の機密レベルを定義
2. **Task 2: マスク関数実装** - 機密情報をマスクするユーティリティ関数
3. **Task 3: ポリシードキュメント作成** - Markdown形式でポリシーを作成
4. **Task 4: 検証** - 既存コードへの適用テスト

---

### Task 1: 機密レベル定義

**Files:**
- Create: `docs/LOG_SENSITIVITY_POLICY.md`

- [ ] **Step 1: 機密レベルを定義**

```markdown
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
```

- [ ] **Step 2: Commit level definitions**

```bash
git add docs/LOG_SENSITIVITY_POLICY.md
git commit -m "docs: define log sensitivity levels in policy"
```

---

### Task 2: マスク関数実装

**Files:**
- Create: `src/utils/logMasker.ts`
- Create: `src/utils/__tests__/logMasker.test.ts`

- [ ] **Step 1: マスク関数のテストを作成（TDD）**

```typescript
// src/utils/__tests__/logMasker.test.ts
import { maskSensitiveData } from '../logMasker.js';

describe('maskSensitiveData', () => {
  it('masks Level 1 secrets', () => {
    const input = { api_key: 'secret123', access_token: 'token456' };
    const result = maskSensitiveData(input);
    expect(result.api_key).toBe('***');
    expect(result.access_token).toBe('***');
  });

  it('masks Level 2 confidential data', () => {
    const input = { email: 'user@example.com', user_id: '12345' };
    const result = maskSensitiveData(input);
    expect(result.email).toBe('u***@example.com');
    expect(result.user_id).toBe('***');
  });

  it('preserves Level 4 public data', () => {
    const input = { status: 200, timestamp: '2026-07-25T00:00:00Z' };
    const result = maskSensitiveData(input);
    expect(result.status).toBe(200);
    expect(result.timestamp).toBe('2026-07-25T00:00:00Z');
  });

  it('handles nested objects', () => {
    const input = { user: { email: 'test@example.com' }, data: { api_key: 'secret' } };
    const result = maskSensitiveData(input);
    expect(result.user.email).toBe('t***@example.com');
    expect(result.data.api_key).toBe('***');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- logMasker.test.ts`
Expected: FAIL - module not found

- [ ] **Step 3: マスク関数を実装**

```typescript
// src/utils/logMasker.ts
const LEVEL1_FIELDS = [
  'api_key', 'apiKey', 'API_KEY',
  'access_token', 'accessToken',
  'refresh_token', 'refreshToken',
  'password', 'passwd',
  'private_key', 'privateKey',
  'client_secret', 'clientSecret',
];

const LEVEL2_FIELDS = [
  'user_id', 'userId',
  'email',
  'ip', 'ipAddress',
  'session_id', 'sessionId',
];

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local[0]}***@${domain}`;
}

function maskValue(key: string, value: any): any {
  if (typeof value !== 'string') return value;
  
  if (LEVEL1_FIELDS.includes(key)) {
    return '***';
  }
  
  if (LEVEL2_FIELDS.includes(key)) {
    if (key === 'email') {
      return maskEmail(value);
    }
    return '***';
  }
  
  return value;
}

export function maskSensitiveData(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveData(item));
  }
  
  const masked: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value);
    } else {
      masked[key] = maskValue(key, value);
    }
  }
  
  return masked;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- logMasker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit mask function**

```bash
git add src/utils/logMasker.ts src/utils/__tests__/logMasker.test.ts
git commit -m "feat: add log masker utility for sensitive data"
```

---

### Task 3: ポリシードキュメント作成

**Files:**
- Modify: `docs/LOG_SENSITIVITY_POLICY.md`

- [ ] **Step 1: 使用方法を追加**

```markdown
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
```

- [ ] **Step 2: Commit policy documentation**

```bash
git add docs/LOG_SENSITIVITY_POLICY.md
git commit -m "docs: add usage examples to log sensitivity policy"
```

---

### Task 4: 検証

**Files:**
- Test: `src/utils/logMasker.ts`

- [ ] **Step 1: 既存コードへの適用テスト**

Run:
```bash
# Find places where response data is logged
grep -rn "console.log.*response\|console.error.*response" src/ | head -5
```

Expected: List of locations to apply masking

- [ ] **Step 2: マスク関数のカバレッジを確認**

Run: `npm test -- logMasker.test.ts --coverage`
Expected: Coverage > 90%

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "test: verify log sensitivity policy implementation"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-05-log-sensitivity-policy.md`に保存しました。
