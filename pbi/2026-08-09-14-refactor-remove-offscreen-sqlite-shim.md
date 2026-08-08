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

- [x] `offscreen.ts:10-31` の import を4モジュールからの直接 import に置き換える
- [x] `init` の呼び出しを `engine.init()` に置き換える
- [x] `_resetForTesting` の参照を確認し、`engine.resetForTesting()` に置き換える
- [x] `src/offscreen/sqlite.ts` を削除する
- [x] テストが `sqlite.js` を参照していないか確認する

## 実装結果

### 起票時の調査漏れ（重要な訂正）

PBI 起票時に「importer は `offscreen.ts:31` の1箇所のみ」と書いたが、**誤りだった**。

静的 import（`from './sqlite.js'`）しか grep していなかったため、
**動的 import（`await import('../sqlite.js')`）を見落としていた**。
実際にはテスト6ファイル・計21箇所から参照されていた：

| ファイル | 参照数 |
|---|---|
| `offscreen.test.ts` | 5 |
| `sqlite-auditLog.test.ts` | 4 |
| `sqlite-query-limit-cap.test.ts` | 4 |
| `sqlite-search-fts5.test.ts` | 3 |
| `sqlite-tagfilter-length.test.ts` | 3 |
| `sqlite-migration-errors.test.ts` | 2 |

**教訓**: 削除前の到達性確認では、静的・動的の**両方**の import 構文を検索すること。

### 対応

テスト群は「init → 書き込み → 読み出し → reset」という DB ライフサイクル全体を
駆動するため、4モジュールを個別 import させるより1つのハンドルを渡す方が読みやすい。
そこで `src/offscreen/__tests__/sqliteTestApi.ts` を新設し、**テスト配下に閉じた**
集約層とした。

本番コード（`offscreen.ts`）は各モジュールから直接 import する形になり、
当初の目的（間接層の除去・非推奨注記の解消）は達成している。

### 副次的な改善

`offscreen.test.ts` の `vi.mock` は旧 shim 1つを差し替えていたが、
本番の import 先に合わせて `sqliteEngineContext` / `recordsRepo` /
`dbMaintenance` / `auditLogRepo` の**4つに分割**した。

その結果、**ルータが実際に解決する import グラフを検証する**形になり、
offscreen のテスト数が **152 → 175（+23）** に増えた。
（従来は shim をまとめてモックしていたため、到達していない経路があった）

### 検証結果

- `src/offscreen/` テスト: **175件 全通過**（23ファイル）
- `npm run type-check`: 通過
- `npm run build`: 成功（`Σ Total size: 6.76 MB`）

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
