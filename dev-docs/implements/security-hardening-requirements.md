# セキュリティ堅牢化 (Security Hardening) - 要件定義

>機能名: security-hardening
>作成日: 2026-02-28
>タスクID: 2026-02-28-fix0

## 信頼性レベル注釈

各項目について、EARS要件定義書・設計文書との照合状況を信号で示します：

- 🟢 **青信号**: EARS要件定義書・設計文書を参考にしてほぼ推測していない場合
- 🟡 **黄信号**: EARS要件定義書・設計文書から妥当な推測の場合
- 🔴 **赤信号**: EARS要件定義書・設計文書にない推測の場合

> **注記**: 本プロジェクトはEARS要件定義書やアーキテクチャ設計書を持っていません。
> したがって、ほとんどの項目は🔴赤信号となっており、タスクファイルと既存コードの分析に基づいて要件を定義しています。

---

## 1. 機能の概要

- 🔴 **信頼性レベル**: タスクファイル `docs/plans/2026-02-28-fix0.md` ベースの推測

### ユーザストーリー

> As a セキュリティ意識の高いユーザー
> So that 機密情報が攻撃者から保護され、設定ファイルの改ざんが防止される
> I want マスターパスワード認証にレート制限があり、コンソールログに機密情報が流出せず、設定ファイルの署名が適切に検証されること

### 想定されるユーザー

拡張機能のすべてのユーザー（特に機密情報を扱うユーザー）

### 解決する問題

| ID | 問題 | 影響 |
|----|------|------|
| ISSUE-001 | ブルートフォース攻撃に対する脆弱性 | マスターパスワードが総当たりで解読される可能性 |
| ISSUE-002 | コンソールログへのAPIキー情報露出 | 開発者ツールから機密情報が取得可能 |
| ISSUE-003 | 本番環境でのデバッグログ出力 | 攻撃者に内部構造情報が漏洩 |
| ISSUE-004 | 未署名設定ファイルのインポート許可 | 改ざんされた設定の適用リスク |

### システム内での位置づけ

| モジュール | ファイル | 責務 |
|-----------|---------|------|
 | パスワード認証 | `src/popup/popup.ts` | ユーザー認証レイヤー（`authenticatePassword()` 関数） |
| 通信モジュール | `src/background/obsidianClient.ts` | APIクライアント、ログ出力 |
| ロギング | `src/utils/logger.ts` | ログ出力制御 |
| 設定管理 | `src/utils/settingsExportImport.ts` | 設定エクスポート/インポート |

### 参照した資料

- `docs/plans/2026-02-28-fix0.md`
- Chrome Extension Security Best Practices
- OWASP Authentication Cheat Sheet

---

## 2. 入力・出力の仕様

- 🔴 **信頼性レベル**: TypeScript型定義と既存コードの分析から推測

### 2.1 マスターパスワードレート制限（項目1）

#### 入力パラメータ

| パラメータ | 型 | 範囲/制約 | 説明 |
|-----------|-----|----------|------|
| password | string | 1-255文字 | ユーザー入力のパスワード |
| timestamp | number | 正整数 (ms) | 認証試行のタイムスタンプ |
| storageFn | `(keys: string[]) => Promise<unknown>` | - | Storageアクセス関数 |

#### 出力

| 出力値 | 型 | 例 | 説明 |
|--------|-----|----|------|
| success | boolean | `true` / `false` | 認証結果 |
| error | string \| undefined | `'Too many attempts'` | エラーメッセージ |

#### データフロー

```
ユーザー入力
    ↓
authenticatePassword()
    ↓
レート制限チェック（storage.sessionから取得）
    ↓
レート制限超過 → エラー返却
    ↓
レート制限以内 → verifyMasterPassword()
    ↓
認証結果通知
```

### 2.2 コンソールログ機密情報削除（項目2）

#### 入力・出力

この項目はコード変更（副作用）のみで、新しい入出力はありません。

### 2.3 デバッグログ本番無効化（項目3）

#### 入力パラメータ

| パラメータ | 型 | 範囲/制約 | 説明 |
|-----------|-----|----------|------|
| logType | LogType | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` | ログレベル |
| message | string | - | ログメッセージ |
| metadata | Record<string, unknown> | - | 追加メタデータ |

#### 出力

| 出力値 | 型 | 説明 |
|--------|-----|------|
| - | void | 副作用としてコンソールに出力（または出力せず） |

### 2.4 設定ファイル署名強化（項目4）

#### 入力パラメータ

| パラメータ | 型 | 範囲/制約 | 説明 |
|-----------|-----|----------|------|
| jsonData | string | JSON形式 | インポートする設定データ |
| signature | string | HMAC署名（hex） | データの署名 |
| hmacSecret | string | - | HMAC秘密鍵（暗号化済み） |

#### 出力

| 出力値 | 型 | 例 | 説明 |
|--------|-----|----|------|
| result | Settings \| null | `null` (署名拒否時) | インポート結果 |
| error | string \| undefined | `'Invalid signature'` | エラーメッセージ |

#### データフロー

```
インポートリクエスト
    ↓
JSON解析
    ↓
署名の存在チェック
    ↓
署名なし → 拒否（警告ダイアログなし）
    ↓
署名あり → HMAC検証
    ↓
検証失敗 → 拒否
    ↓
検証成功 → 設定適用
```

---

## 3. 制約条件

- 🔴 **信頼性レベル**: プロジェクトのアーキテクチャと一般的なセキュリティ要件から推測

### 3.1 パフォーマンス要件

| 項目 | 要求値 |
|------|--------|
| レート制限チェック時間計算量 | O(1) |
| ストレージ使用 | 最小化（カウンターで最大64KB） |
| 署名検証時間 | 100ms以内 |

### 3.2 セキュリティ要件

#### レート制限

| 項目 | 値 |
|------|-----|
| 許容回数 | 5回 / 5分以内 |
| 違反時ロック時間 | 30分 |
| リセット条件 | ロック期間経過後 |
| カウンター保存先 | `chrome.storage.session`（ブラウザ閉じるとクリア） |

#### ログ制限

| 環境 | DEBUG | VERBOSE | INFO | WARN | ERROR |
|------|-------|---------|------|------|-------|
| production | ❌ | ❌ | ✅ | ✅ | ✅ |
| development | ✅ | ✅ | ✅ | ✅ | ✅ |

- 機密情報の禁止事項:
  - APIキー（生の値）
  - パスワード
  - 暗号化鍵
  - トークン
  - 個人情報（PII）

#### 署名検証

| 項目 | 要求値 |
|------|--------|
| HMAC署名 | 必須 |
| 署名なし時 | 拒否（警告後続行不可） |
| HMAC秘密鍵 | `chrome.storage.local`に暗号化して保存 |
| 署名アルゴリズム | HMAC-SHA256 |

### 3.3 互換性要件

- 既存のパスワード認証動作を変更しない（正当なユーザー体験）
- 署名付きエクスポート形式との互換性維持
- 既存テストへの影響を最小限にする

### 3.4 アーキテクチャ制約

- Chrome Extension Manifest V3 準拠
- サーバー側の状態管理不可（オフラインで動作）
- storage.session または memory で一時状態管理
- Background Service Worker で動作

### 3.5 Chromeストア要件

- 機密情報をログに出力しない
- マルウェア防止のためのセキュリティ対策
- ユーザーの同意なしのネットワーク通信禁止

---

## 4. 想定される使用例

- 🔴 **信頼性レベル**: ソースコード分析から推測

### 4.1 基本的な使用パターン（正常系）

#### 項目1: マスターパスワードレート制限

**シナリオ A: 正常ログイン**

```typescript
// 1. ユーザーが正しいパスワードを入力
input: password = "correct-password"

// 2. 認証成功
output: { success: true }

// 3. レートカウンターは影響を受けない
```

**シナリオ B: 誤パスワード試行（レート制限未到達）**

```typescript
// 1〜4回の誤った入力
input: password = "wrong" // x4回
output: { success: false, error: "Incorrect password" }

// 5回目の正しい入力
input: password = "correct-password"
output: { success: true }
```

**シナリオ C: レート制限到達**

```typescript
// 1〜5回の誤った入力
input: password = "wrong" // x5回
output: { success: false, error: "Incorrect password" }

// 6回目の試行はブロックされる
input: password = "correct-password"
output: { success: false, error: "Too many attempts. Please try again in 30 minutes." }

// 30分経過後
input: password = "correct-password"
output: { success: true }
```

#### 項目2: コンソールログ機密情報削除

```typescript
// 修正前（忌避された動作）
console.log('[ObsidianClient] API Key is missing or invalid!', {
  apiKey: typeof apiKey,
  fullKey: apiKey  // ← 機密情報露出
});

// 修正後（期待される動作）
console.log('[ObsidianClient] API Key validation failed');
// または redacted に置換
console.log('[ObsidianClient] API Key is missing or invalid!', {
  apiKey: typeof apiKey,  // 型情報のみ
  fullKey: "[REDACTED]"   // 値を秘匿
});
```

#### 項目3: デバッグログ本番無効化

```typescript
// production環境での動作
const isDev = process.env.NODE_ENV === 'development';

addLog(LogType.DEBUG, 'Some debug message', { data: '...' });
// production: 出力なし
// development: コンソールに出力

addLog(LogType.ERROR, 'Some error message', { error: '...' });
// production: 出力あり
// development: 出力あり
```

#### 項目4: 設定ファイル署名強化

**シナリオ: 署名付きファイルのインポート**

```typescript
const jsonData = '{"settings": {...}, "signature": "abc123def456..."}';
const result = await importSettings(jsonData);
// output: Settings {...} (インポート成功)
```

**シナリオ: 未署名ファイルのインポート（拒否）**

```typescript
const jsonData = '{"settings": {...}}'; // signatureがない
const result = await importSettings(jsonData);
// output: null (インポート拒否)
// 同時にalertで "Invalid signature" エラー表示
```

### 4.2 エッジケース

| ID | シナリオ | 期待される動作 |
|----|----------|---------------|
| EDGE-001 | 複数ブラウザタブでの同時認証 | 各タブごとにレート制限が独立して動作（storage.sessionベース） |
| EDGE-002 | ストレージがクリアされた場合 | レートカウンターがリセットされる（正常な動作） |
| EDGE-003 | 署名形式のバージョンアップ | 旧形式の署名を検証できない場合、適切なエラーメッセージ |
| EDGE-004 | 非常に長い入力バッファ | 入力サイズ制限を超える場合、エラーを返す |
| EDGE-005 | HMAC秘密鍵が存在しない | 新しいキーを生成してstorageに保存 |
| EDGE-006 | 認証リクエストが中断された場合 | レートカウンターは増加しない |

### 4.3 エラーケース

| ID | シナリオ | 期待される挙動 |
|----|----------|---------------|
| ERR-001 | レート制限ロック中に認証試行 | "Too many attempts. Please try again in X minutes." エラーを返す |
| ERR-002 | 署名検証エラー | "Invalid signature. Import rejected." エラーを返し、インポートを拒否 |
| ERR-003 | 環境判定エラー | 安全側（ログ無効）にフォールバック |
| ERR-004 | HMAC秘密鍵生成エラー | 再試行または致命的エラーとして処理 |
| ERR-005 | JSON解析エラー | "Invalid JSON format" エラーを返す |
| ERR-006 | 設定形式の検証エラー | "Invalid settings format" エラーを返す |

---

## 5. EARS要件・設計文書との対応関係

**参照したユーザストーリー**: なし（🔴 赤信号）

**参照した機能要件**: なし（🔴 赤信号）

**参照した非機能要件**: なし（🔴 赤信号）

**参照したEdgeケース**: なし（🔴 赤信号）

**参照した受け入れ基準**: なし（🔴 赤信号）

**参照した設計文書**

| 文書 | 状態 | 信頼性 |
|------|------|--------|
| アーキテクチャ (architecture.md) | 存在しない | 🔴 赤信号 |
| データフロー (dataflow.md) | 存在しない | 🔴 赤信号 |
| 型定義 (interfaces.ts) | 既存コード分析 | 🟡 黄信号 |
| データベース (database-schema.sql) | 存在しない（Chrome storage使用） | 🟡 黄信号 |
| API仕様 (api-endpoints.md) | 存在しない（Chrome Extension API使用） | 🟡 黄信号 |

---

## 6. 実装方針

### 6.1 マスターパスワードレート制限

```typescript
// ストレージ保存形式
interface RateLimitState {
  attempts: number;
  firstAttemptTime: number;
  lockedUntil?: number;
}

// 実装場所
// src/popup/popup.ts 内の authenticatePassword() 関数に追加
```

### 6.2 コンソールログ機密情報削除

```typescript
// 修正対象: src/background/obsidianClient.ts:118-121
// console.error での apiKey 出力を削除または [REDACTED] に置換
```

### 6.3 デバッグログ本番無効化

```typescript
// 修正対象: src/utils/logger.ts
// 環境判定を追加し、productionではDEBUG/VERBOSEをスキップ

const isDevelopment = () => {
  // development判定ロジック
};
```

### 6.4 設定ファイル署名強化

```typescript
// 修正対象: src/utils/settingsExportImport.ts:352-364
// 署名なしの確認ダイアログを削除し、直接拒否する

if (!parsed.signature) {
  throw new Error('Invalid signature: Settings file must be signed.');
}
```

---

## 7. 品質判定

### ✅ 高品質

- ✅ 要件の曖昧さ: なし
- ✅ 入出力定義: 完全
- ✅ 制約条件: 明確
- ✅ 実装可能性: 確実

### 7.1 判定根拠

1. **要件の明確さ**: 4つのセキュリティ修正項目が明確に定義されている
2. **入出力の定義**: 各項目について具体的な型、範囲、期待動作が定義されている
3. **制約条件**: パフォーマンス、セキュリティ、互換性、アーキテクチャ制約が明確
4. **使用例**: 正常系、エッジケース、エラーケースが網羅されている
5. **実装方針**: 各修正項目に対する具体的な実装ガイドラインが提供されている

### 7.2 懸念事項

- 🟡 EARS要件定義書が存在しないため、推測に基づく定義
- 🟡 既存テストとの互換性を確認する必要がある

---

## 8. 次のステップ

**推奨コマンド**: `/tdd-testcases` でテストケースの洗い出しを行います。

テストケースでは以下を網羅します：

1. マスターパスワードレート制限のテスト
   - 正常な認証（1〜5回の試行）
   - レート制限到達とロックアウト
   - ロックアウト経過後のリセット
   - 複数タブでの独立動作

2. コンソールログのテスト
   - 機密情報がログに出力されないこと

3. デバッグログのテスト
   - production環境でのDEBUGログ無効化
   - development環境でのDEBUGログ有効化

4. 設定ファイル署名のテスト
   - 署名付きファイルのインポート成功
   - 未署名ファイルのインポート失敗
   - 署名検証エラー時の挙動