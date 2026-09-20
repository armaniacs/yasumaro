# Firefox 版だけ zip が 10MB あった件 — 履歴データベースが拡張の中に同梱されていた話

Yasumaro は v6.9.0 から Firefox を実験的にサポートしています。v6.9.10 をリリースしたとき、GitHub の Release ページで成果物のサイズを眺めていて、ふと気になりました。

- `yasumaro-6.9.10-chrome.zip` … 2.23 MB
- `yasumaro-6.9.10-edge.zip` … 2.23 MB（chrome と sha256 まで同一）
- `yasumaro-6.9.10-firefox.zip` … **10 MB**

3 倍どころか 4 倍以上です。「Firefox 向けには何かを諦めているのか」と思う人がいてもおかしくない。この記事は、その正体を追って、削れるところまで削った記録です。

## いそがしい人向けの結論

- 正体は **SQLite（wa-sqlite）の WASM バイナリが emscripten グルー JS に base64 で埋め込まれていたこと** でした。計 4 種類のバイナリが、glue のフォールバック参照箇所ごとに複製されて計 11 回埋め込まれ、合計で約 20MB の base64 になっていました
- ランタイムは常に `locateFile` 経由で外部ファイルを読むため、埋め込まれたバイナリは**到達不可能なデッドコード**でした。しかも拡張機能の CSP（`connect-src 'self'`）のもとでは data: URL の fetch は常に失敗するので、残しておく理由がありません
- `renderChunk` で剥がした結果、**firefox zip は 10.4MB → 2.76MB（-74%）**。chrome の zip はバイト単位で変化なし。修正は v6.9.11 としてリリース済みです
- 検証は実 dist の worker を駆動する smoke（INIT → INSERT → SEARCH → STATUS）と全 12,600 テストで確認し、release.yml に Firefox 版のサイズゲートを追加しました

## Firefox サポートの現況

まず現在地の整理から。Yasumaro の Firefox 対応は v6.9.0（2026-09-15）で入りました。当時の最大の壁は、Chrome 拡張にはある `chrome.offscreen` API が Firefox には存在しないことでした。重い同期処理（SQLite WASM）を Service Worker から隔離するために使っていた仕組みが使えない。そこで Firefox では background のイベントページと worker が直接ストレージエンジンをホストする構成に切り替えています。

現時点（v6.9.11）で Firefox でも動くものは次のとおりです。

| 機能 | Firefox |
|------|---------|
| 記録（ドメインフィルタ・プライバシー判定込み） | 動く |
| 履歴保存（SQLite + OPFS SyncAccessHandle） | 動く |
| 全文検索（FTS5） | 動く |
| PII マスキング（Rust/WASM、21 パターン） | 動く（SpiderMonkey での probe も CI で常時回帰） |
| Obsidian 同期 / ローカル Markdown 書き出し | 動く |
| Built-in AI | 非対応（Chromium の `LanguageModel` API 依存のため） |

インストールは GitHub Releases の `yasumaro-6.9.11-firefox.zip`（2.75MB）からです。CI では `firefox-storage` ジョブが VFS probe・実 dist worker smoke・PII WASM probe を毎回回していて、6.9.2 には送信者検証の回帰 hotfix も出しています。「実験的」と書きましたが、この記事を書く時点では記録から検索まで一通り使える状態まで安定化しています。

## 調査: zip を解体する

まずは zip の中身です。`wxt zip` の成果物は `dist/<ブラウザ>-mv3` ディレクトリそのものなので、展開せずにローカルビルドのサイズを見ます。

| | chromium-mv3 | firefox-mv3 |
|---|---|---|
| ディレクトリ合計 | 7.2 MB | **29 MB** |
| `background.js` | 404 KB | **7.6 MB** |
| `opfs-worker.js` | （assets 内 163 KB） | **14.0 MB** |

`opfs-worker.js` 一つで 14MB。しかも中身を見ると、minify された普通の IIFE の中に、長い base64 文字列が大量に入っています。文字数を数えてみると、こうでした。

```
opfs-worker.js（総 1,398 万文字）
  base64 ブロック: 11 個、合計 1,347 万文字
    1,978,500 文字 … wa-sqlite async ビルド（1.48MB）
    1,976,044 文字 … @subframe7536 async ビルド（1.48MB）×2
      970,196 文字 … @subframe7536 plain ビルド（727KB）×7
      744,460 文字 … wa-sqlite plain ビルド（558KB）×1
background.js（総 762 万文字）
  base64 ブロック: 4 個、合計 690 万文字
```

base64 は元のバイナリの 4/3 倍の長さになるので、1,347 万文字 ≒ 10MB のバイナリが JS の中に埋まっている計算です。サイズの逆算（1,978,500 × 3/4 = 1,483,875 バイト）で各ブロックがどのファイルかまで特定できました。同じ 727KB のバイナリが 7 回も入っている。これは「何かが重い」ではなく「同じものが重複して入っている」パターンです。

## 4 つの wasm の役割

次に、この 4 つのバイナリがどこから来て、どこで使われるのかを追いました。依存グラフをたどると、Yasumaro には 3 つの独立した SQLite 利用経路があります。

| バイナリ | 由来 | 使う経路 |
|---|---|---|
| plain ビルド（727KB、FTS5 あり） | `@subframe7536/sqlite-wasm` | OPFS worker（メインの履歴保存・検索） |
| async ビルド（1.48MB、FTS5 あり） | `@subframe7536/sqlite-wasm` | IDB バックエンド（フォールバック）＋ Firefox 向け公開アセット |
| async ビルド（1.48MB） | `wa-sqlite` 本家 | 旧形式 DB からの移行バックアップ |
| plain ビルド（558KB、FTS5 なし） | `wa-sqlite` 本家 | **どこからも使われていない（デッド）** |

移行バックアップ用の `wa-sqlite` 本家バイナリまで含め、3 つは実在する経路でした。1 つだけ、`wa-sqlite` 本家の main エントリが 型/関数だけ使われてバイナリを誰も読まない、という完全なデッドが混ざっています。

## なぜ Firefox だけ埋め込まれるのか

Chrome 側では同じコードが埋め込まれません。ここにはブラウザの違いとビルド方式の違いが重なっています。

Chrome では offscreen document がエンジンを担い、グルー JS から wasm への参照は `new URL('/assets/wa-sqlite-xxx.wasm', ...)` のような**実ファイル参照**として出力されます。Vite の `assetsInlineLimit: 0` も効いています。

一方 Firefox では、opfs-worker が unlisted エントリとして**単一ファイルの lib ビルド**になります。このビルドモードは、グルー内の `new URL()` フォールバックをすべて data: URL にインライン化します。emscripten のグルーは wasm ファイルを参照する箇所を複数持っているため、**参照箇所ごとにバイナリのコピーが一つずつ**入る。これが ×7 の正体でした。

では埋め込まれた data: URL は動くのか。答えはノーです。拡張機能の CSP は `connect-src 'self'` で、data: の fetch は常に NetworkError になります。これは v6.9.0 の時点で実機検証済みで、まさにその対策として「wasm を公開アセットに置き、INIT ペイロードで URL を上書きする」仕組み（`setSqliteWasmUrlOverride`）が入っています。ランタイムは常に `locateFile` を通って公開アセットを読む。つまりインラインされたバイナリは**最初から一度も実行されない死んだ重り**でした。

## 対策: 到達不能なら剥がす

原因が「参照されない data: URI の重量」なら、答えは一つです。wxt.config.ts に Firefox ビルド専用の `renderChunk` プラグインを足して、レンダリング時に剥がしました。

```js
renderChunk(code) {
  if (!code.includes('data:application/wasm;base64,')) return null;
  return code.replace(
    /data:application\/wasm;base64,[A-Za-z0-9+/=]{4096,}/g,
    'data:application/wasm;base64,',
  );
},
```

剥がされたフォールバックは、fetch した瞬間に失敗します。それは CSP にブロックされる現行の挙動と完全に同じです。挙動を変えずに重りだけ降ろす、というやり方です。

結果はこうなりました。

| | Before | After |
|---|---|---|
| firefox zip | 10,961,417 バイト（10.4MB） | **2,888,493 バイト（2.76MB）** |
| chrome zip | 2,467,235 バイト | 2,467,235 バイト（**バイト単位で同一**） |
| `opfs-worker.js` | 13.98 MB | 0.50 MB |
| `background.js` | 7.62 MB | 0.70 MB |

chrome がバイト単位で不変なのが個人的に気に入っている点です。この変更が Firefox ビルドだけに触れたことの証明になります。実際にリリースされた v6.9.11 の firefox zip は 2,747,817 バイトでした。

検証は 3 段階です。まず全 12,600 テストがグリーン。次に、実 dist の `opfs-worker.js` を http origin で駆動する smoke（INIT で公開アセットの URL を渡す → INSERT → SEARCH（FTS5）→ STATUS）が完走。最後に release.yml に Firefox 版のバンドルサイズゲート（15MB 上限）を追加して、再発を CI で捉えられるようにしました。

実はこのゲートが、最初の v6.9.11 リリースワークフローを一度失敗させています。ゲートを chrome ビルドの直後に置いてしまったため、**firefox ビルドが走る前の時点**でチェックが実行され、CI のクリーンな環境にはまだ `dist/firefox-mv3` が存在しない。ローカルでは firefox dist がビルド済みだったため、ローカルでは一切再現しない失敗でした。「チェックは計測対象のビルドの後ろに置く」という初歩的な順序を、CI に教えてもらった形です。

## 学び

まとめると、こんな知見が得られました。

1. **「圧縮が効かない」のか「必要なものが同梱されている」のかは、まず分解する**。base64 ブロックの文字数を数えるだけでも、1.333 倍則で元バイナリの特定まで行けます
2. **emscripten グルーは wasm 参照を複数持つ**。単一ファイルビルドでは参照箇所の数だけバイナリが複製されます。ファイルサイズの肥大化を見たら参照サイト数を疑う
3. **「死んでいるはずのコード」は CSP が保証してくれる**。data: の fetch が常に失敗する環境では、インライン payload を剥がしても到達可能な挙動は一つも変わりません。剥がす前の実機検証（v6.9.0 の NetworkError 確認）がここで効きました
4. **プラットフォーム差分はビルドモードにも現れる**。Chrome では asset として出るものが、Firefox の lib ビルドでは data: に化ける。サイズの差分調査は「ブラウザの違い」より先に「ビルドグラフの違い」を見るのが近道でした
5. **ローカルで再現しない失敗は、環境差分より先に「状態の差分」を疑う**。サイズゲートの配置ミスは、firefox dist がビルド済みのローカルでは通ってしまい、クリーンな CI でのみ落ちました。ローカルと CI の違いはブラウザや OS だけではなく「いつビルドしたか」も含みます

## 残っている課題

正直に書いておくと、まだ残りがあります。ただしこれらは**削除すべきコードとして、2026-12-17 の sunset でまとめて取り除く計画**（[issue #153](https://github.com/armaniacs/yasumaro/issues/153)）に載せました。

- Firefox では旧 wa-sqlite 形式 DB からの移行バックアップが動きません。バックアップ経路が data: インラインの wasm に依存しているためです。公開アセット化して直す選択肢もありましたが、旧形式は Firefox に配布されたことがなく到達不可能な経路であり、sunset での丸ごと削除のほうが筋がよいと判断しました
- chromium 側の wa-sqlite 本家 plain ビルド（558KB、FTS5 なし）も、誰も読まないデッドとして同時に消えます
- 利用者向けには、旧形式データベース互換コードの提供終了予告を[別記事](./legacy-db-compat-sunset-notice.md)と[通知 issue](https://github.com/armaniacs/yasumaro/issues/154) として公開しています

そしてこの修正自体は、**v6.9.11 として本日リリース済み**です。リリースの firefox zip は 2,747,817 バイト（2.75MB）。

Firefox を使いたいのにサイズが理由で躊躇していた人には、v6.9.11 から 2.75MB で待っています。
