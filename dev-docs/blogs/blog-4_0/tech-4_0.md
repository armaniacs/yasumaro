# Obsidian Smart History v4.0 技術解説 — v3からv4への内部アーキテクチャの変化

利用者向けのリリースノートは [blog-4_0.md](blog-4_0.md) をご覧ください。こちらは「なぜそう作ったか」に興味のある方向けの技術的な補足です。

---

## TypeScript完全移行の実態

### なぜJavaScriptのままではいけなかったか

v3系では、拡張機能全体が素のJavaScript（ES Modules）で書かれていました。動作上の問題はなかったんですが、コードが大きくなるにつれて3つの問題が積み重なってきました。

- `chrome.storage.local.get()` の戻り値が `any` 扱いで、取り出したデータの形が保証できない
- Service Worker・Content Script・Popup・Dashboard 間でデータを受け渡す際、メッセージの payload 形式がドキュメントにしか存在せず、実装と乖離しやすい
- 設定オブジェクトのキー名ミスがランタイムまで検出できない

TypeScript移行後は、これらが**コンパイル時に検出**されるようになりました。たとえば `StorageKeys` を enum で定義したことで、ストレージのキー名をハードコードする箇所がなくなり、リネームも安全に行えます。

### nodeNext モジュール解決と `.js` 拡張子問題

TypeScript で ES Modules を扱うときに必ずハマるのが import の拡張子問題です。`tsconfig.json` で `"moduleResolution": "nodeNext"` を採用したため、TypeScriptソースからの import でも `.js` 拡張子を明示しなければなりません。

```typescript
// NG: TypeScriptファイルなのに .ts と書いてはいけない
import { getSettings } from '../utils/storage.ts';

// OK: ビルド後の出力先 .js を指定する
import { getSettings } from '../utils/storage.js';
```

ビルド後の `dist/` 内でそのまま動作するための書き方です。最初は直感に反しますが、Chrome 拡張機能の Service Worker が ES Modules をネイティブで扱う制約上、このスタイルが一番問題が少ない選択でした。

### テスト基盤: jsdom + @peculiar/webcrypto

Chrome拡張機能のテストは jsdom で擬似 DOM を構築しますが、jsdom の `crypto` 実装は不完全で `SubtleCrypto`（AES-GCM 暗号化に使用）が動きません。

解決策として `@peculiar/webcrypto` を `jest.setup.ts` で注入しています。

```typescript
// jest.setup.ts
import { Crypto } from '@peculiar/webcrypto';

Object.defineProperty(global, 'crypto', {
  value: new Crypto(),
  writable: true,
});
```

`global.crypto = new Crypto()` だと jsdom がすでに `crypto` を定義しているため上書きできません。`Object.defineProperty` で `writable: true` を明示することが必要です。これに気づくまでちょっと時間がかかりました。

---

## プライベートページ検出の仕組み

### HTTPヘッダー監視のタイミング問題

拡張機能が HTTP レスポンスヘッダーを取得するには `chrome.webRequest` API を使います。ただし Manifest V3 では Service Worker が常駐しないため、**ページが読み込まれる前にリスナーが登録されていなければならない**というタイミング制約があります。

`HeaderDetector` クラスが Service Worker 起動時に即座に `chrome.webRequest.onHeadersReceived` リスナーを登録し、検出結果を LRU キャッシュ（最大100エントリ、TTL5分）に保存するようにしました。

```
[ページ読み込み]
      ↓
[webRequest.onHeadersReceived]  ← HeaderDetector がここで検出・キャッシュ
      ↓
[Content Script がスクロール/滞在時間を計測]
      ↓
[VALID_VISIT メッセージ → Service Worker]
      ↓
[recordingLogic がキャッシュを参照] ← この時点でページは既に読み込み済み
```

記録処理が走る頃にはページ読み込みは終わっているので、キャッシュ経由で結果を引き渡すしかないんですよね。

### 判定するヘッダーの選定理由

| ヘッダー | 判定対象の値 | 判定する理由 | 除外する値と理由 |
|---------|------------|------------|----------------|
| Cache-Control | `private`, `no-store` | CDNやプロキシに保存させない＝個人向けコンテンツ | `no-cache`：ニュースサイト等でも常用され誤検出が多い |
| Set-Cookie | 存在するだけで判定 | 認証セッションの存在を示す | — |
| Authorization | 存在するだけで判定 | HTTP認証で保護されたリソース | — |

`no-cache` を除外したのは、警視庁・国税庁など多くの公官庁サイトが `Cache-Control: no-cache` を返しているからです。これを含めると正規の公開ページが大量にスキップされてしまうことが実際のテストで分かりました。「プライベートなページを守る」のが目的なので、公開情報を誤って弾くほうが問題です。

### URLの正規化とキャッシュミス問題

v4.0 RC で見つかったバグです。`HeaderDetector` は URL をキャッシュキーとして保存する際に末尾スラッシュ除去・フラグメント除去を行っていましたが、`recordingLogic` 側では生のURLでキャッシュを検索していました。

```
キャッシュに保存: "https://example.com/path"         ← HeaderDetector が正規化
検索キー:        "https://example.com/path#section"  ← recordingLogic が生URL使用
                                                     ↑ ミスマッチ → キャッシュ未ヒット
```

`normalizeUrlForCache()` を `RecordingLogic` に追加し、検索時も同じ正規化を適用することで修正しました。「プライバシー保護が効いていない」という症状だったので、発見したときはちょっとヒヤッとしました。

---

## 楽観的ロックによるストレージ競合対策

### なぜ必要だったか

Chrome 拡張機能の Service Worker は複数の非同期処理が並走します。たとえば自動記録とユーザーの手動削除が同時に走った場合、`chrome.storage.local.get()` → 値を変更 → `chrome.storage.local.set()` のパターンでは**後勝ち上書き**が発生し、変更が失われます。

v3系ではこの問題をある程度許容していましたが、記録履歴機能の追加により `savedUrlsWithTimestamps` が重要なデータになったため、v4.0 で楽観的ロックを導入しました。

### 実装: Read-Modify-Write + バージョン検証

```typescript
// withOptimisticLock の動作原理
while (attempt < maxRetries) {
    // 1. 現在の値とバージョン番号を同時に読む
    const { [key]: currentValue, [versionKey]: currentVersion } =
        await chrome.storage.local.get([key, versionKey]);

    // 2. 新しい値を計算（純粋関数）
    const newValue = updateFn(currentValue);

    // 3. 値とバージョン+1を同時に書く
    await chrome.storage.local.set({ [key]: newValue, [versionKey]: currentVersion + 1 });

    // 4. 書いたバージョンが残っているか確認
    const { [versionKey]: confirmedVersion } = await chrome.storage.local.get(versionKey);
    if (confirmedVersion === currentVersion + 1) return newValue; // 成功

    // 競合: 別プロセスが書き込んだ → リトライ
    await sleep(attempt * retryDelay);
    attempt++;
}
```

`chrome.storage.local` への書き込み自体はアトミックですが、「読んでから書くまでの間」は保護できません。バージョン番号を使った Check-Then-Act でこのウィンドウを検出し、リトライします。

### `maskedCount` / `recordType` が消えるバグ

楽観的ロックを導入した後も、`setSavedUrlsWithTimestamps()` に別の問題が潜んでいました。

この関数は `Map<string, number>`（URL→タイムスタンプのみ）を受け取ってストレージに書き込むのですが、変換時に `recordType` と `maskedCount` フィールドを**単純に捨てていました**。

```typescript
// 修正前（問題のあるコード）
const entries = Array.from(urlMap.entries()).map(([url, timestamp]) => ({ url, timestamp }));
// ↑ recordType も maskedCount も消える

await withOptimisticLock('savedUrlsWithTimestamps', () => entries, ...);
// ↑ 更新関数が currentEntries（現在のストレージ値）を無視している
```

修正後は楽観的ロックの `updateFn` 内で現在のストレージ値を読み、既存フィールドを引き継ぐようにしました。

```typescript
// 修正後
await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
    const existingMap = new Map(currentEntries.map(e => [e.url, e]));
    return Array.from(urlMap.entries()).map(([url, timestamp]) => {
        const existing = existingMap.get(url);
        const entry: SavedUrlEntry = { url, timestamp };
        if (existing?.recordType !== undefined) entry.recordType = existing.recordType;
        if (existing?.maskedCount !== undefined) entry.maskedCount = existing.maskedCount;
        return entry;
    });
}, ...);
```

同じ問題が `storage.ts` と `storageUrls.ts` の2か所に独立して存在していたため、両方修正しました。2つのファイルに同一関数が存在している状況自体は将来の技術的負債です。

---

## 手動保存フローの maskedCount 引き継ぎ

### 2段階フロー（PREVIEW → SAVE）の設計

ポップアップからの手動保存は、プレビュー → 確認 → 保存の2ステップになっています。

```
[ポップアップ: 記録ボタン押下]
    ↓
PREVIEW_RECORD → Service Worker
    ↓ pipeline.process(content, { previewOnly: true })
    ↓ PII マスク処理 → maskedCount 計算
    ← { processedContent, maskedCount, maskedItems }
    ↓
[ポップアップ: 「内容の確認」ダイアログ表示]
    ↓ ユーザーが「送信する」をクリック
SAVE_RECORD → Service Worker
    ↓ pipeline.process(content, { alreadyProcessed: true })
    ↓ PII マスク処理をスキップ → maskedCount = 0 のまま ← ここが問題だった
    ← { success: true }
```

`alreadyProcessed: true` の場合、`useMasking: false` になるためプレビュー時に計算した `maskedCount` が再計算されず `0` になります。「手動保存でマスクバッジが記録されない」の原因はここでした。

### 修正: maskedCount をメッセージで引き継ぐ

```typescript
// popup/main.ts: SAVE_RECORD 送信時に maskedCount を含める
result = await sendMessageWithRetry({
    type: 'SAVE_RECORD',
    payload: {
        title: tab.title,
        url: tab.url,
        content: finalContent,
        force: force,
        maskedCount: previewResponse.maskedCount  // ← 追加
    }
});
```

```typescript
// recordingLogic.ts: alreadyProcessed 時は渡された値を優先
const resolvedMaskedCount = precomputedMaskedCount ?? pipelineResult.maskedCount ?? 0;
```

`??` でフォールバックチェーンを組むことで、通常の自動記録フロー（`precomputedMaskedCount` が undefined）には影響を与えません。

---

## APIキーの自動暗号化

v3.x で導入した設計ですが、v4.0でも維持している部分なので改めて説明しておきます。

### 透過的暗号化の設計

APIキーは `saveSettings()` 呼び出し時に自動的に暗号化され、`getSettings()` 呼び出し時に自動的に復号されます。呼び出し側（`popup.ts`・`aiClient.ts`・`obsidianClient.ts`）は暗号化の存在を意識しません。

```
[getSettings()]
    ↓
chrome.storage.local.get('settings')
    ↓ { gemini_api_key: "encrypted:iv=...,data=..." }
    ↓ 暗号化キーを判定（"encrypted:" プレフィックス）
    ↓ PBKDF2(secret, salt, 100000 iterations) → AES-GCM 復号
    → { gemini_api_key: "AIzaSy..." }  ← 呼び出し側はこれだけ見る
```

### 暗号鍵の管理

暗号鍵はランダムな secret と salt を `chrome.storage.local` に保存し、PBKDF2 で導出します。

Chrome の extension storage は OS のキーチェーンとは独立しているため、secret 自体も暗号文と同じ場所に保存されます。厳密な意味での「鍵と暗号文の分離」ではありませんが、単純な平文保存よりもブラウザのデベロッパーツールからの意図しない閲覧を防ぐ効果があります。設定のエクスポート時にマスターパスワード暗号化を組み合わせることで、ファイル保存時の安全性を補っています。

---

## 記録履歴のリアルタイム更新

ダッシュボードの History パネルは初期化時にストレージを一度読み込むだけでした。新しい記録が追加されてもページを再読み込みしないと反映されない、という状態だったんですね。

`chrome.storage.onChanged` はストレージへの書き込みをリアルタイムに通知してくれます。`savedUrlsWithTimestamps` キーへの変化だけを監視し、変化があった場合のみ再取得・再描画するようにしました。

```typescript
const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    if (!('savedUrlsWithTimestamps' in changes)) return;  // 関係のない変化を無視

    getSavedUrlEntries().then(updated => {
        entries = updated.slice().sort((a, b) => b.timestamp - a.timestamp);
        applyFilters();
    });
};
chrome.storage.onChanged.addListener(onStorageChanged);
```

`changes` オブジェクトには `newValue` も含まれているので再取得せずに直接使うこともできますが、`getSavedUrlEntries()` を経由することで型安全性と一貫性を保っています。

---

## 今後の課題

### `storage.ts` と `storageUrls.ts` の重複

`setSavedUrlsWithTimestamps`・`getSavedUrlsWithTimestamps` などの関数が2つのファイルに存在しています。段階的なリファクタリングの過程でこうなってしまいました。現状は `recordingLogic.ts` が `storage.ts` 版を、`storageUrls.ts` 版は別の呼び出し元が使っています。将来的には一方に統合したいと思っています。

### 楽観的ロックの検証ロジック

現在の実装は「書き込み後にバージョンを再読して一致するか確認」していますが、厳密には別プロセスが同じバージョンに上書きした場合に誤って成功と判定する可能性があります。Chrome拡張機能の実用上この頻度は無視できますが、より堅牢にするには書き込みと検証をアトミックに行う仕組みが必要です。Firestore のトランザクションに相当するものですが、`chrome.storage` にはそういった機能がないため、現状の設計が現実的な妥協点です。
