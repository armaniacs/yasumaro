# PBI: offscreen のリスナー登録前に送られたメッセージが拒否される

## ステータス: ✅ 完了（2026-09-16）

## ユーザーストーリー

Yasumaro の利用者として、拡張機能を起動した直後の操作が「Database connection lost」で失敗しないでほしい。なぜなら初回の保存や検索がタイミング次第で弾かれると、ユーザーには何が悪かったのか分からないまま失敗だけが残るから。

## 背景

PBI 2026-09-16-01 の残課題として起票。当初は「アーカイブ作成中に offscreen が破棄される」問題として記述していたが、**実測の結果その前提は誤りだった**ため本 PBI は全面的に書き直されている。

## 実測で判明した原因

`archive_create` の失敗時に、送信側の状態を記録して確認した。

```
+2ms    send failed   → Could not establish connection. Receiving end does not exist.
                        hasDocumentAfterFailure: true     ← ドキュメントは存在する
                        aliveBeforeEnsure: false          ← フラグの陳腐化でもない
                        msSinceDocumentCreated: 2         ← 生成直後
+140ms  probe(50ms)   → error: null   ← 同じドキュメントが正常に受信
+206ms  probe(200ms)  → error: null
+1007ms probe(1000ms) → error: null
```

Service Worker の再起動も起きていない（transport インスタンスの生成は1回のみ）。

**offscreen document は破棄されていなかった。生成直後でリスナーが未登録だっただけ**である。`Receiving end does not exist` はドキュメントの不在ではなく、受信リスナーの不在を指していた。

### なぜリスナーが未登録だったのか

`src/offscreen/offscreen.ts` はリスナー登録を `factoryReady`（OPFS ワーカーファクトリの動的 import）の解決後に行っていた。

```ts
void factoryReady.then(() => {
    chrome.runtime.onMessage.addListener(handleOffscreenMessage);
});
```

一方 `chrome.offscreen.createDocument()` が解決するのは「ドキュメントが生成された」ことだけで、**中のスクリプトが実行を終えたことも、リスナーが登録されたことも保証しない**。送信側はこれを「準備完了」と見なして即座に送るため、その隙間に落ちる。

根本は、**送信側と受信側のどちらも「準備完了」を定義しておらず、暗黙の前提が食い違っていた**こと。

### なぜ G5 でだけ表面化したのか

- G5 は SW 起動直後に `archive_create` が走る唯一のテスト。他は offscreen が温まった状態で実行されるため踏まない
- `msgOffscreen` は失敗時に1回リトライするが、`archive_create` は `noRetry: true` でそれを無効化している

`noRetry` は「タイムアウトは失敗を意味しない（実行済みかもしれない）」という正しい設計判断であり、今回のケースには**該当しない**（リスナー未登録で弾かれた送信は offscreen に一度も到達していないため）。ただし判定を文言に依存させるのは脆いので、`noRetry` 側には手を入れていない。

## 対処

リスナーをモジュール評価時に**同期登録**するよう変更し、ファクトリの待機はハンドラ内に移した。ハンドラは元々非同期なので、早く届いたメッセージは拒否されず待たされる。

```ts
// 登録は同期
chrome.runtime.onMessage.addListener(handleOffscreenMessage);

// ハンドラ内で必要になった時点で待つ
await factoryReady;
```

## 破棄された当初案（いずれも前提が誤っていた）

参考として記録する。実測前の推測に基づくもので、**どれも今回の原因には無関係**だった。

- **冪等キーの導入** — 再試行を安全にする案。しかし初回が到達していないため再試行以前の問題だった
- **keepalive** — offscreen の生存を保証する案。破棄されていないので不要
- **操作の分割** — 中断からの再開を可能にする案。中断していないので不要

「アーカイブ中は記録しない」ロックの案も検討したが、データ競合ではなく初期化順序の問題であり解決しない。なお SQLite 操作は `OffscreenTransportBase` の Mutex で既に直列化されている。

## 検証

- `src/offscreen/__tests__/offscreen-listener-registration.test.ts` を追加。モジュール評価時点で登録済みであることを固定した。旧実装に戻すと2件が失敗することを確認済み
- G5 が通過（修正前は failed）。`--repeat-each=3` で3回とも安定
- `archive-recommended-verification` 7件すべて通過、flaky ゼロ
- `npm run validate` 12,079 件グリーン

## 受け入れ条件

```gherkin
Given offscreen document が生成された直後である
When リスナー登録の完了前にメッセージが送られる
Then メッセージは拒否されず、処理が完了する

Given 記録処理が実行中である
When アーカイブ作成を実行する
Then アーカイブ作成と記録の両方が成功する

Given CI の test ジョブ
When archive 系 e2e を実行する
Then G5 を含むすべての spec がリトライなしで通過する
```

## 備考

ローカル再現には `CI=1` が必要（spec が `CI` または `DISPLAY` の有無で skip 判定するため）。

関連: [[2026-09-16-01-fix-archive-e2e-flaky]]（本 PBI の前提となる調査）
