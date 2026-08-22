# なぜなぜ分析 — offscreen-mutex

## 現象
`src/offscreen/offscreen.ts` に `SqliteWriteMutex` クラス（41–63行）と `sqliteWriteMutex` インスタンス（65行）が存在し、`handleOffscreenMessage` で `acquire/release` により SQLite 操作を直列化している。しかし `src/background/offscreenTransport.ts` の `ChromeOffscreenTransport.requestQueue`（`Mutex`、maxQueueSize・timeout 付き）が既にメッセージを直列化している。

## 5 Whys
1. なぜ `SqliteWriteMutex` が冗長なのか → `ChromeOffscreenTransport.msgOffscreen()` が `requestQueue.acquire()` → `sendOnce()` → `release()` の順で呼び出され、transport 層ですでに1-in-flight を保証しているため
2. なぜ transport で保証できるのか → `sendOnce` は `chrome.runtime.sendMessage` の request/response サイクル全体を `requestQueue` で囲み、response が返るまで次の acquire がブロックされるため
3. なぜ offscreen 側に Mutex が追加されたのか → VULN-016 の対策として「並列トランザクションが相互にロールバックしないよう」手作りキューを追加したが、その時点では transport の `requestQueue` が既に存在していたか、追加された transport 層との整合が取れていなかったため
4. なぜ transport 層での直列化だけで十分なのか → さらに、SQLite WASM は Worker 内で単一スレッド実行であり、offscreen document のイベントループも1つの `handleOffscreenMessage` コールバックを完了させてから次を処理するため、実質的に SQLite 操作自体が並列実行される余地はない
5. なぜ二重直列化を解消すべきなのか → locality（どの層が直列化を担保しているか）が1箇所に集中せず保守者が迷い、かつ `SqliteWriteMutex` は maxQueueSize と timeout を持たない手作りキューであり、real back-pressure のメカニズムを隠蔽しているため

→ 解: `SqliteWriteMutex` クラスとインスタンスを削除し、`handleOffscreenMessage` の `acquire/release` 呼び出しを取り除き、`dispatchSqliteMessage` を直接呼ぶ。不要な import を削除し type-check/test で検証する。
