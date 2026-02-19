# Private Page Detection Design

## 概要

HTTPヘッダー情報（Cache-Control、Set-Cookie、Authorization）を使用して、個人のプライベート情報が含まれるページを自動判定し、保存前に警告を表示する機能。

## 背景

現在のObsidian Smart Historyは、ドメインブロックリストによるフィルタリングとPIIマスキングでプライバシーを保護していますが、個人向けのプライベートページ（SNSのタイムライン、メール、銀行サイトなど）は自動判定できていません。HTTPレスポンスヘッダーには「このページが特定ユーザー向けのプライベートコンテンツか」を示す情報が含まれており、これを活用してより強固なプライバシー保護を実現します。

## 要件

### 機能要件

1. メインフレームのHTMLページのHTTPレスポンスヘッダーを監視
2. 以下の条件でプライベートページと判定:
   - Cache-Controlに`private`、`no-store`、`no-cache`が含まれる
   - Set-Cookieヘッダーが存在する
   - Authorizationヘッダーが存在する
3. プライベートページと判定された場合、保存前に警告ダイアログを表示
4. ユーザーが「保存する」を選択した場合は、force flagを立てて保存を実行
5. 判定結果を5分間キャッシュし、パフォーマンスオーバーヘッドを最小化

### 非機能要件

- パフォーマンス: 通常のページロード時間への影響は5ms以下
- メモリ使用量: キャッシュサイズは100エントリ上限
- エラーハンドリング: ヘッダー取得失敗時も記録機能を維持
- 互換性: Manifest V3準拠

## アーキテクチャ

### コンポーネント構成

```
┌─────────────────────────────────────────────────────────────┐
│ Background Service Worker                                   │
│                                                              │
│  ┌────────────────┐      ┌─────────────────┐               │
│  │ Header Detector│      │ Privacy Checker │               │
│  │ (webRequest)   │─────>│ (判定ロジック)   │               │
│  └────────────────┘      └─────────────────┘               │
│         │                                                    │
│         v                                                    │
│  ┌────────────────────────────────────┐                     │
│  │ Privacy Cache (Map<URL, Info>)    │                     │
│  │ TTL: 5分, Max: 100 entries        │                     │
│  └────────────────────────────────────┘                     │
│         │                                                    │
│         v                                                    │
│  ┌────────────────┐                                         │
│  │ RecordingLogic │                                         │
│  │ (チェック統合) │                                         │
│  └────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────────┐
│ Content Script / Popup                                      │
│ - PRIVATE_PAGE_DETECTED エラー受信                          │
│ - 警告ダイアログ表示                                         │
│ - force flag付きで再送信                                    │
└─────────────────────────────────────────────────────────────┘
```

### データフロー

1. **ページロード時:**
   ```
   ページロード
     → webRequest.onHeadersReceived
     → Header Detector
     → Privacy Checker (判定)
     → Privacy Cache に保存
   ```

2. **保存リクエスト時:**
   ```
   保存リクエスト
     → RecordingLogic.record()
     → Privacy Cache 確認
     → プライベートなら PRIVATE_PAGE_DETECTED 返却
     → Content Script/Popup で警告表示
     → ユーザー承認 → force=true で再送信
   ```

## データ構造

### PrivacyInfo

```typescript
interface PrivacyInfo {
  isPrivate: boolean;
  reason?: 'cache-control' | 'set-cookie' | 'authorization';
  timestamp: number;
  headers?: {
    cacheControl?: string;
    hasCookie: boolean;
    hasAuth: boolean;
  };
}
```

### CacheState拡張

```typescript
interface CacheState {
  // 既存
  settingsCache: Settings | null;
  cacheTimestamp: number | null;
  cacheVersion: number;
  urlCache: Map<string, number> | null;
  urlCacheTimestamp: number | null;

  // 新規追加
  privacyCache: Map<string, PrivacyInfo> | null;
  privacyCacheTimestamp: number | null;
}
```

## 実装詳細

### 1. Header Detector (`src/background/headerDetector.ts`)

**責務:**
- webRequest.onHeadersReceivedリスナーの登録
- メインフレーム(type='main_frame')のHTMLレスポンス(Content-Type='text/html')のみ監視
- ヘッダー情報をPrivacy Checkerに渡して判定
- 判定結果をRecordingLogic.cacheState.privacyCacheに保存

**主要メソッド:**
```typescript
class HeaderDetector {
  static initialize(): void;
  private static onHeadersReceived(details: chrome.webRequest.WebResponseHeadersDetails): void;
  private static cachePrivacyInfo(url: string, info: PrivacyInfo): void;
  private static evictOldestEntry(): void; // LRU実装
}
```

**webRequestフィルター:**
```typescript
chrome.webRequest.onHeadersReceived.addListener(
  HeaderDetector.onHeadersReceived,
  {
    urls: ['<all_urls>'],
    types: ['main_frame']
  },
  ['responseHeaders']
);
```

### 2. Privacy Checker (`src/utils/privacyChecker.ts`)

**責務:**
- ヘッダー情報からプライベート判定を行う純粋関数
- テスト可能な独立したモジュール

**主要関数:**
```typescript
export function checkPrivacy(
  headers: chrome.webRequest.HttpHeader[]
): PrivacyInfo;

function hasCacheControlPrivate(headers: chrome.webRequest.HttpHeader[]): boolean;
function hasSetCookie(headers: chrome.webRequest.HttpHeader[]): boolean;
function hasAuthorization(headers: chrome.webRequest.HttpHeader[]): boolean;
```

**判定ロジック:**
1. Cache-Controlに`private`、`no-store`、`no-cache`が含まれる → `reason: 'cache-control'`
2. Set-Cookieヘッダーが存在 → `reason: 'set-cookie'`
3. Authorizationヘッダーが存在 → `reason: 'authorization'`
4. いずれも該当しない → `isPrivate: false`

### 3. RecordingLogic拡張 (`src/background/recordingLogic.ts`)

**変更箇所:**

```typescript
async record(data: RecordingData): Promise<RecordingResult> {
  // ... コンテンツトランケーション ...

  // 1. Check domain filter (既存)
  const isAllowed = await isDomainAllowed(url);
  if (!isAllowed && !force) {
    return { success: false, error: 'DOMAIN_BLOCKED' };
  }

  // 1.5. Check privacy headers (新規)
  const privacyInfo = await this.getPrivacyInfoWithCache(url);
  if (privacyInfo?.isPrivate && !force) {
    addLog(LogType.WARN, 'Private page detected', {
      url,
      reason: privacyInfo.reason
    });
    return {
      success: false,
      error: 'PRIVATE_PAGE_DETECTED',
      reason: privacyInfo.reason
    };
  }

  // 2. Check for duplicates (既存)
  // ... 以降は既存の処理 ...
}
```

**新規メソッド:**

```typescript
async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
  const now = Date.now();
  const PRIVACY_CACHE_TTL = 5 * 60 * 1000; // 5分

  if (RecordingLogic.cacheState.privacyCache) {
    const cached = RecordingLogic.cacheState.privacyCache.get(url);
    if (cached && (now - cached.timestamp) < PRIVACY_CACHE_TTL) {
      addLog(LogType.DEBUG, 'Privacy cache hit', { url });
      return cached;
    }
  }

  // キャッシュミス: ヘッダー情報がまだ収集されていない
  addLog(LogType.DEBUG, 'Privacy check skipped: no header data', { url });
  return null;
}

static invalidatePrivacyCache(): void {
  addLog(LogType.DEBUG, 'Privacy cache invalidated');
  RecordingLogic.cacheState.privacyCache = null;
  RecordingLogic.cacheState.privacyCacheTimestamp = null;
}
```

### 4. UI/UX - Content Script (`src/content/extractor.ts`)

```typescript
const result = await chrome.runtime.sendMessage({
  action: 'record',
  data: { title, url, content }
});

if (result.error === 'PRIVATE_PAGE_DETECTED') {
  const reason = chrome.i18n.getMessage(
    `privatePageReason_${result.reason}` || 'unknown'
  );
  const message = chrome.i18n.getMessage('privatePageWarning', [reason]);

  const userConfirmed = confirm(message);

  if (userConfirmed) {
    await chrome.runtime.sendMessage({
      action: 'record',
      data: { title, url, content, force: true }
    });
  }
}
```

### 5. UI/UX - Popup (`src/popup/popup.ts`)

同様のパターンで、手動保存ボタンからの保存時に警告ダイアログを表示。

### 6. i18n メッセージ

**_locales/en/messages.json:**
```json
{
  "privatePageWarning": {
    "message": "This page may contain private information (detected: $REASON$). Save anyway?",
    "placeholders": {
      "reason": { "content": "$1" }
    }
  },
  "privatePageReason_cacheControl": {
    "message": "private cache headers"
  },
  "privatePageReason_setCookie": {
    "message": "authentication cookies"
  },
  "privatePageReason_authorization": {
    "message": "authorization headers"
  }
}
```

**_locales/ja/messages.json:**
```json
{
  "privatePageWarning": {
    "message": "このページには個人情報が含まれている可能性があります（検出理由: $REASON$）。それでも保存しますか?",
    "placeholders": {
      "reason": { "content": "$1" }
    }
  },
  "privatePageReason_cacheControl": {
    "message": "プライベートキャッシュヘッダー"
  },
  "privatePageReason_setCookie": {
    "message": "認証Cookie"
  },
  "privatePageReason_authorization": {
    "message": "認証ヘッダー"
  }
}
```

### 7. manifest.json変更

**permission追加:**
```json
{
  "permissions": [
    "tabs",
    "storage",
    "scripting",
    "identity",
    "notifications",
    "offscreen",
    "favicon",
    "unlimitedStorage",
    "webRequest"
  ]
}
```

**service-worker.ts初期化:**
```typescript
import { HeaderDetector } from './headerDetector.js';

chrome.runtime.onInstalled.addListener(() => {
  // 既存の初期化...
  HeaderDetector.initialize();
});

chrome.runtime.onStartup.addListener(() => {
  HeaderDetector.initialize();
});
```

## エラーハンドリング

### エッジケース対応

1. **webRequestリスナーが動作する前に保存リクエストが来た場合**
   - `getPrivacyInfoWithCache()`が`null`を返す
   - プライバシーチェックをスキップして通常通り保存
   - ログに`Privacy check skipped: no header data`を記録

2. **リダイレクト処理**
   - webRequestは最終的なレスポンスのURLでキャッシュに保存
   - リダイレクト元のURLは無視

3. **URLの正規化**
   - クエリパラメータやフラグメント(`#`)を含むURLもそのままキャッシュキーとして使用
   - 将来的には正規化を検討

4. **キャッシュサイズ制限**
   - 100エントリを超えた場合、最も古いエントリ(timestampが最小)を削除
   - LRU実装: 新規エントリ追加時に古いものから削除

5. **webRequestリスナーのエラー**
   - ヘッダー解析エラーは握りつぶし、ログ記録のみ
   - キャッシュへの保存失敗時も処理を継続(プライバシー保護は働かないが、記録機能は維持)

6. **Set-Cookieの誤検知軽減**
   - v1では全Set-Cookieをプライベート判定
   - 将来的には、トラッキングCookie除外フィルター(`_ga`, `_gid`, `_fbp`等)を追加可能

### ログ出力

```typescript
// headerDetector.ts
addLog(LogType.DEBUG, 'Privacy info cached', {
  url,
  isPrivate: info.isPrivate,
  reason: info.reason
});

// recordingLogic.ts
addLog(LogType.INFO, 'Privacy check result', {
  url,
  isPrivate: privacyInfo?.isPrivate,
  cacheHit: privacyInfo !== null
});

addLog(LogType.WARN, 'Private page detected', {
  url,
  reason: privacyInfo.reason
});
```

## テスト戦略

### ユニットテスト

1. **src/utils/__tests__/privacyChecker.test.ts**
   - Cache-Control: private/no-store/no-cache のパース
   - Set-Cookie存在チェック
   - Authorization存在チェック
   - 複数条件が重なった場合の優先順位
   - 異常系: 空ヘッダー、不正フォーマット

2. **src/background/__tests__/headerDetector.test.ts**
   - webRequestリスナーのモック
   - キャッシュの追加・取得・削除
   - LRU動作の検証
   - TTL期限切れの検証
   - キャッシュサイズ上限の検証

3. **src/background/__tests__/recordingLogic.test.ts** (既存に追加)
   - `PRIVATE_PAGE_DETECTED`エラーが正しく返されるか
   - force flagでプライバシーチェックがスキップされるか
   - キャッシュミス時の動作(保存継続)

### 統合テスト

**テストシナリオ:**

1. **プライベートページ検出とキャンセル**
   - Cache-Control: private のページをロード
   - 保存試行 → 警告表示
   - キャンセル → 保存されない

2. **プライベートページ検出と強制保存**
   - Cache-Control: private のページをロード
   - 保存試行 → 警告表示
   - 「保存する」選択 → force=true で保存される

3. **Set-Cookie検出**
   - Set-Cookie付きページをロード
   - 保存試行 → 警告表示

4. **通常ページ(ヘッダーなし)**
   - プライベートヘッダーなしのページをロード
   - 保存試行 → 警告なしで保存

5. **キャッシュTTL検証**
   - プライベートページをロード → キャッシュ保存
   - 6分後に同じページで保存試行 → キャッシュ期限切れで判定スキップ

### 手動テスト用リソース

**docs/test-pages/private-page-test.html:**
```html
<!DOCTYPE html>
<!-- ローカルサーバーで以下のヘッダー付きで配信 -->
<!-- Cache-Control: private, no-store -->
<!-- Set-Cookie: session=test123 -->
<html>
<head>
  <title>Private Page Test</title>
</head>
<body>
  <h1>Private Page Detection Test</h1>
  <p>このページはCache-Control: privateヘッダーとSet-Cookieを含みます。</p>
</body>
</html>
```

## パフォーマンス考慮

### メモリ使用量

- キャッシュサイズ上限: 100エントリ
- 1エントリあたりの推定サイズ: 約200バイト
- 合計メモリ使用量: 約20KB (無視できるレベル)

### CPU時間

- webRequestリスナー: ヘッダー解析のみ、ブロッキング動作なし
- ページロードへの影響: 1ms以下
- キャッシュ検索: Map.get()で O(1)、高速

### ネットワーク影響

- webRequestは既存のネットワーク通信を監視するのみ
- 追加の通信は発生しない

## セキュリティ考慮

1. **XSS対策**
   - ヘッダー値はログ出力時にサニタイズ不要(ユーザーに直接表示しない)
   - i18nメッセージでエスケープ済み

2. **プライバシー**
   - キャッシュはメモリ内のみ、chrome.storageには保存しない
   - service worker再起動でキャッシュクリア

3. **権限の最小化**
   - webRequest読み取り専用、ブロッキング動作なし

## 将来の拡張

1. **トラッキングCookie除外フィルター**
   - `_ga`, `_gid`, `_fbp`, `_utm`等を除外してSet-Cookie判定の精度向上

2. **ユーザー設定でプライバシーチェック有効/無効化**
   - settings UIに「Private page detection」トグルを追加

3. **ホワイトリスト機能**
   - 特定ドメインはプライバシー警告を無視する設定

4. **統計情報**
   - プライバシー検出回数、ブロック回数をログに記録

## まとめ

この設計により、HTTPヘッダー情報を活用した自動プライベートページ検出機能を実装します。既存のドメインフィルター機能と同様のUXパターンを採用することで、ユーザー体験の一貫性を保ちながら、より強固なプライバシー保護を実現します。webRequest APIの読み取り専用利用により、Manifest V3との互換性も維持します。
