# PBI: offscreen/sqlite.ts の非推奨再エクスポート層を削除する

**作成日**: 2026-08-09
**優先度**: 低
**見積もり**: 🟢小（0.5pt目安）
**副作用**: 🟢なし（import 経路の変更のみ）
**種別**: ♻️リファクタリング（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-09、候補5）で、
`src/offscreen/sqlite.ts` が**全 export に `@deprecated` を付けた再エクスポート層**であり、
かつ**唯一の import 元が本番のメッセージルータ自身**であることが判明した。

### 現状

```typescript
// src/offscreen/sqlite.ts:14-15（ファイル冒頭コメント）
// このファイルは後方互換のための再エクスポート層。新規コードは上記の
// 各モジュールから直接importすることを推奨する。
```

58行すべてが再エクスポートで、実処理は1行委譲が2つだけ：

```typescript
/** @deprecated Use engine.init() from sqliteEngineContext.js directly. */
export async function init(): Promise<boolean> { return engine.init(); }

/** @deprecated Use engine.resetForTesting() ... */
export function _resetForTesting(): void { engine.resetForTesting(); }
```

### import 元は1箇所のみ

全 import 綴りで repo 全体を grep した結果：

```
src/offscreen/offscreen.ts:31:} from './sqlite.js';
```

**非推奨の注意書きが、それに従うべき唯一の読み手に向いていない**状態。
「新規コードは直接 import せよ」という助言が、本番ルータ自身には適用されていない。

## 削除テスト

削除して `recordsRepo` / `dbMaintenance` / `auditLogRepo` / `sqliteEngineContext`
から直接 import すれば：

- import 行数は変わらない（同じシンボルを別の出所から取るだけ）
- 間接層が1枚減る
- `SQLITE_QUERY` を追う読み手の経路が
  router → shim → repo → backend から router → repo → backend になる

**複雑さは集約される（＝ shallow だった）。**

## 作業内容

- [ ] `offscreen.ts:10-31` の import を4モジュールからの直接 import に置き換える
- [ ] `init` の呼び出しを `engine.init()` に置き換える
- [ ] `_resetForTesting` の参照を確認し、`engine.resetForTesting()` に置き換える
- [ ] `src/offscreen/sqlite.ts` を削除する
- [ ] テストが `sqlite.js` を参照していないか確認する

## 完了条件

- `src/offscreen/sqlite.ts` が存在しない
- `npm run validate` が通る
- `npm run build` が通る（WXT のバンドルに影響しないこと）

## 注意

`src/utils/` `src/content/` 配下の分割ではないため、
`manifest.json` の `web_accessible_resources` 更新は**不要**。
（offscreen はページから fetch されない）

ただし念のため、削除後に `wxt.config.ts` の
`web_accessible_resources` に `sqlite.js` 系の記載が無いことを確認する。

## 参照

- アーキテクチャレビュー 2026-08-09 候補5
- ADR 抵触なし
