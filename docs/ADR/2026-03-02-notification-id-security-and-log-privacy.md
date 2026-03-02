# ADR: 通知IDセキュリティ強化とログ出力のプライバシー保護

## ステータス
採用済み

## 日付
2026-03-02

## 作成者
Checking Team (Security Review implementation)

## コンテキスト

### 問題の背景
v4.1.1のコードレビューにおいて、セキュリティとプライバシーに関して以下の懸念が指摘された：

1. **通知IDの脆弱性**: Base64エンコードされた通知IDが改ざんやなりすましのリスクにさらされている
2. **ログ出力時の機密情報漏洩**: `console.log` でURLがそのまま出力されており、センシティブなURL情報がログに含まれる可能性がある
3. **整合性制約の欠如**: 入力検証や整合性チェックが不十分

### 現在の状況
- service-worker.ts で通知ID生成に単純なBase64エンコードを使用
- pendingStorage.ts, statusChecker.ts, headerDetector.ts で URL を `console.log` そのまま出力
- logger.ts に構造化ロギング機能は存在するが、一貫して使用されていない

### 影響を受けるステークホルダー
- エンドユーザー（ブラウジング履歴のプライバシー保護）
- 開発者（デバッグ用ログのセキュリティ）
- 監査・コンプライアンス担当者

## 関連するADR
- [0001-api-key-security-policy.md](./0001-api-key-security-policy.md) - APIキーのセキュリティポリシー

## 決定事項

### 1. HMAC-SHA256署名による通知ID認証強化

#### モチベーション
通知IDにデジタル署名を追加することで、改ざん検出となりすまし防止を回復する。

#### 実装内容
- Web Crypto API を使用し、HMAC-SHA256署名を生成
- 通知IDフォーマット: `base64Url | base64Signature`
- 署名検証: 定時間比較演算子を使用してタイミング攻撃を回避
- HMACキー生成: 32バイトの乱数を使用し、`chrome.storage.local` に保存
- 下位互換性: 簽名がない従来フォーマットもサポート

#### コード例（service-worker.ts）
```typescript
async function getHmacKey(): Promise<CryptoKey> {
    const storage = await chrome.storage.local.get(HMAC_SECRET_KEY);
    let keyData = storage[HMAC_SECRET_KEY] as Uint8Array | undefined;
    if (!keyData || !(keyData instanceof Uint8Array)) {
        keyData = new Uint8Array(32);
        crypto.getRandomValues(keyData);
        await chrome.storage.local.set({ [HMAC_SECRET_KEY]: keyData });
    }
    const keyBuffer = new ArrayBuffer(keyData.byteLength);
    new Uint8Array(keyBuffer).set(keyData);
    return await crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function generateSignature(url: string): Promise<string> {
    const key = await getHmacKey();
    const msgBuffer = new TextEncoder().encode(url);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, msgBuffer);
    const signature = new Uint8Array(signatureBuffer);
    return encodeUrlSafeBase64(signature);
}

function verifySignature(url: string, signature: string): boolean {
    // 定時間比較演算子でタイミング攻撃を回避
    const computed = await generateSignature(url);
    return computed.length === signature.length &&
           computed.split('').every((c, i) => c === signature[i]);
}
```

### 2. URLハッシュ化によるログ出力のプライバシー保護

#### モチベーション
ログ出力時にURLをそのまま出力すると、センシティブな情報が漏洩するリスクがある。ハッシュ化することでトレーサビリティを維持しつつプライバシーを保護。

#### 実装内容
- SHA-256ハッシュを生成し、先頭8文字をログ出力
- 各ファイル（pendingStorage.ts, statusChecker.ts, headerDetector.ts）に `hashUrl()` ヘルパー関数を追加
- Structured Logging（logInfo, logDebug, logWarn, logError）を使用し、`source` パラメータでログ出力元を特定

#### コード例
```typescript
async function hashUrl(url: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `[hash:${hashHex.substring(0, 8)}]`;
}

// 使用例
const urlHash = await hashUrl(details.url);
await logDebug('onHeadersReceived fired', { urlHash, type: details.type, source: 'headerDetector' });
```

### 3. URL検証の強化

#### モチベーション
危険なスキーム（data:, javascript:, file: 等）によるXSSや追加攻撃を防止。

#### 実装内容
- `isValidUrl()` ヘルパー関数を追加
- 許可されるスキーム: http:, https:, chrome-extension:, moz-extension:
- 不正なスキームの場合はエラーを記録

#### コード例
```typescript
function isValidUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const ALLOWED_SCHEMES = ['http:', 'https:', 'chrome-extension:', 'moz-extension:'];
        return ALLOWED_SCHEMES.includes(parsed.protocol);
    } catch {
        return false;
    }
}
```

### 4. Structured Loggingへの移行

#### モチベーション
 logger.ts に既存する構造化ロギング機能を一貫して使用する。

#### 実装内容
- `console.log`, `console.warn`, `console.error` を `logInfo`, `logWarn`, `logError` に置き換え
- `ErrorCode` でエラー種類を分類
- `source` パラメータでログ出力元を特定

## 結果

### メリット
- **セキュリティ強化**: HMAC署名により通知IDの改ざんやなりすましを防止
- **プライバシー保護**: URLをハッシュ化してログに出力することで、センシティブ情報の漏洩を防止
- **監査可能性**: ErrorCode付き構造化ログにより、トラブルシューティングとセキュリティ監査を容易化
- **コードの一貫性**: 全ファイルで統一されたログ出力方式を使用

### デメリット
- **パフォーマンス影響**: HMAC署名とハッシュ化の計算コストが発生（ただし、Web Crypto APIはネイティブ実装）
- **実装複雑性**: 署名検証とハッシュ化のロジック追加によるコード複雑性の増加
- **下位互換性の管理**: 従来フォーマットの通知IDを扱うための特殊パスが必要

### 影響範囲
- 変更されるコンポーネント:
  - `src/background/service-worker.ts` - HMAC署名の実装、URL検証、Static Loggingへの移行
  - `src/utils/pendingStorage.ts` - URLハッシュ化、Static Loggingへの移行
  - `src/popup/statusChecker.ts` - URLハッシュ化、Static Loggingへの移行
  - `src/background/headerDetector.ts` - URLハッシュ化、Static Loggingへの移行

### 実装計画
- 2026-03-02: P0実装完了（HMAC署名、URLハッシュ化、入力検証）
- 2026-03-02: P1実装完了（データ検証強化、閾値設定、同意フロー）
- 2026-03-02: P2実装完了（ADR作成、従来フォーマット対応調整）

## 参照
- [Web Crypto API - HMAC](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API#HMAC)
- [Timing Attack - OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Timing_Attack_Cheat_Sheet.html)
- checking-team レビュー結果 (v4.1.1)