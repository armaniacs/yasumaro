---
title: "Chrome拡張の中で SQLite + FTS5 を動かす技術 — @subframe7536/sqlite-wasm で日本語全文検索を実現した話"
emoji: "🗄️"
type: "tech"
topics: ["sqlite", "wasm", "chrome拡張機能", "fts5", "javascript"]
published: false
---

Chrome 拡張機能の中で、ローカルに SQLite を動かしたいと思ったことはありませんか。

私は Yasumaro という拡張機能を開発しています。ウェブページの閲覧履歴を AI で要約し、ローカルに保存するツールです。保存先として SQLite を選んだ理由は単純で、「ブラウザを閉じてもデータが消えない」「数万件あっても検索が一瞬」という体験を実現したかったからです。

しかし、Manifest V3 の制約の中で SQLite を動かすのは、案外面倒でした。

## Manifest V3 での課題

Chrome 拡張機能の Manifest V3 では、Service Worker（旧バックグラウンドスクリプト）がエフェメラルです。30秒ほどアイドル状態が続くと強制終了され、メモリ上の状態はすべて失われます。

そのため、Service Worker 内で SQLite のコネクションを保持することはできません。さらに、Service Worker には `window` オブジェクトがなく、DOM や File System Access API の一部も使えません。

```
Service Worker（寿命30秒）
   └── SQLite 接続 → ❌ 保持不可
```

ファイルの永続化先として OPFS（Origin Private File System）を使いたい場合も、Service Worker 内では `createSyncAccessHandle` が使えないという壁がありました。

## Offscreen Document + Web Worker の構成

これらの制約を回避するため、Yasumaro では次のような構成を取りました。

```
Service Worker
   └── postMessage ──> Offscreen Document
                          └── postMessage ──> Web Worker
                                                 └── SQLite (OPFS)
```

Service Worker は Chrome 拡張機能 API で動作し、Offscreen Document は Web API（DOM、Worker 生成）を使い、Web Worker 内で `createSyncAccessHandle` を介して OPFS にアクセスします。メッセージパッシングで三者を繋ぎ、Service Worker がすべての chrome.* API 処理を担います。

この構成自体は Manifest V3 では定番ですが、SQLite WASM の選定で大きな選択肢に悩みました。

## wa-sqlite の壁：OPFS と FTS5 が排他だった

当初は `wa-sqlite` を使用していました。これは SQLite を WebAssembly にコンパイルした有名な実装です。

問題は、OPFS 永続化と FTS5 全文検索が **同時に満たせなかった** ことです。

- OPFS 永続化には `createSyncAccessHandle` を使う **同期ビルド**（`wa-sqlite/dist/wa-sqlite.mjs`）が必要
- しかしこの同期ビルドには **FTS5 が含まれない**
- FTS5 を含むのは **非同期ビルド**（`wa-sqlite-async.mjs`）だが、こちらは OPFS の同期アクセスハンドルを使えず、IndexedDB VFS 止まりだった

結果として、OPFS パスでは検索が `LIKE` フォールバックに退化し、FTS5 のランク付き全文検索は IndexedDB パスでしか使えませんでした。

```
wa-sqlite 同期ビルド + OPFS       → FTS5 なし（LIKE検索のみ）
wa-sqlite 非同期ビルド + IndexedDB → FTS5 あり（OPFS なし）
```

## @subframe7536/sqlite-wasm での両立

この排他関係を解消したのが、[`@subframe7536/sqlite-wasm`](https://github.com/subframe7536/sqlite-wasm) です。

このパッケージは `OPFSCoopSyncVFS` と FTS5 内蔵の WASM を同一バンドルに含んでいます。Worker 内で OPFS 永続化と FTS5 MATCH の両立を実現できました。

```typescript
// Web Worker 内
import { createEngine } from './sqliteEngine.js';

const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;
const engine = await createEngine('yasumaro.db', WASM_URL);

// FTS5 仮想テーブルの作成（trigram トークナイザ）
await engine.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS browsing_logs_fts USING fts5(
    title, summary, tags,
    content='browsing_logs',
    content_rowid='id',
    tokenize='trigram'
  );
`);
```

バンドルされる WASM は SQLite 3.53.0 で、`trigram` / `unicode61` / `porter` / `ascii` のトークナイザを内蔵しています。ICU や形態素解析は非搭載ですが、ブラウザ拡張の中で日本語検索をするには十分な選択肢でした。

## 日本語検索のための trigram トークナイザ

FTS5 のデフォルトトークナイザ `unicode61` では、日本語（CJK）の検索が期待通りに動きません。実機で確認したところ、「機械学習」で検索しても 0件ヒットでした。空白で区切られない言語を1トークンに丸めてしまうためです。

そこで `trigram` トークナイザを採用しました。`trigram` は文字列を3文字ずつの連続部分文字列（3-gram）に分解します。

```
「機械学習」→ 「機械学」「械学習」
```

これにより、日本語の部分一致検索が有効化されます。ただし、2文字以下のクエリは 3-gram を形成できないため、LIKE 検索にフォールバックします。

```typescript
function sanitizeFtsTerm(query: string): string {
  // 英数字・CJK・空白のみ許可（FTS5 演算子注入対策）
  const bare = query
    .replace(/[^A-Za-z0-9぀-ゟ゠-ヿ一-鿿㐀-䶿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const charLen = [...bare].length;
  if (charLen >= 3) {
    return handleSearchFts(`"${bare}"`, limit, offset);
  }
  return handleSearchLike(query, limit, offset);
}
```

クエリをダブルクォートで phrase 検索に固定することで、FTS5 の `OR` / `AND` / `NEAR` などの演算子がユーザー入力から混入するのを防いでいます。

## 3段フォールバックの構成

万が一の場合に備え、Yasumaro では3段階のフォールバックを維持しています。

| 階層 | ストレージ | FTS5 | 用途 |
|------|-----------|------|------|
| 1 | OPFS Worker（@subframe7536/sqlite-wasm） | ✅ | 通常運用 |
| 2 | IndexedDB（wa-sqlite 非同期） | ✅ | OPFS 非対応環境 |
| 3 | chrome.storage.local | ❌（LIKEのみ） | モバイル Chrome など |

OPFS が利用できない端末（モバイル Chrome など）では、自動的に階層2または3にフォールバックします。OPFS が復旧した際には、フォールバック先のデータを自動的に SQLite にマイグレーションします。

## 既存データの移行

`@subframe7536/sqlite-wasm` 導入以前に OPFS でデータを蓄積していたユーザーにも、データを失わせません。旧 DB（`AccessHandlePoolVFS` ベース）から新スキーマへの移行スクリプトを実装し、初回起動時に自動的にレコードを再投入します。

この移行は冪等です。完了後は旧 DB ファイルを削除し、新しいエンジンへの切り替えを完了します。

## まとめ

Manifest V3 の制約と、SQLite WASM の選定という二重のハードルを越えて、Chrome 拡張機能の中で本格的な全文検索が動くようになりました。

キーとなったのは以下の3点です。

1. **Offscreen Document + Web Worker** で Service Worker の制約を回避
2. **`@subframe7536/sqlite-wasm`** で OPFS 永続化と FTS5 を同一データベースで両立
3. **`trigram` トークナイザ** で日本語の部分一致検索を実現し、短クエリは LIKE にフォールバック

ブラウザ拡張の中で「使える」検索を実現する道のりでしたが、結果としてモバイル対応やデータ移行も含めた堅牢な構成ができました。

同様の課題に直面している方の参考になれば幸いです。

---

## 関連リンク

- [@subframe7536/sqlite-wasm](https://github.com/subframe7536/sqlite-wasm)
- [Yasumaro - GitHub](https://github.com/armaniacs/yasumaro)
- [SQLite FTS5 公式ドキュメント](https://www.sqlite.org/fts5.html)
