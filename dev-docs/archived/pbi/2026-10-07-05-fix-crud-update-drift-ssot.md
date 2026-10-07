# PBI: CRUD UPDATE 組立を共有ビルダーに集約し undefined 語義の乖離を塞ぐ

## ユーザーストーリー

ストレージ保守担当者として、update の同一入力が両バックエンドで同じ行を書いてほしい。IDB と OPFS worker が UPDATE 組立を手写経していて、undefined 値の扱いが IDB=NULL 書込 / worker=skip で乖離しているから。

## 優先度

- 順位: 5/17
- RICE: 6.0（R4 / I3 / C1.0 / E2）
- 根拠: 同一 op で異なる結果になるデータ乖離。PBI-34（queryPlan）が統合した search/plain-list/purge と同型の残族
- 依存: NN01 の着地後（同一ファイル `IdbVfsBackend.ts` の編集競合回避）

## 背景（file:line 現状）

- 乖離: `src/offscreen/IdbVfsBackend.ts:170-194` — `if (f in changes) { params.push((changes[f] ?? null)) }` = undefined 値キーは NULL を書く。`src/offscreen/opfsWorker/crudHandlers.ts:61-83` — `if (val !== undefined)` = skip。同一 op で異なる行
- 手写経した文: `'UPDATE browsing_logs SET is_starred = CASE ...'`（`IdbVfsBackend.ts:205` = `crudHandlers.ts:92`）/ `'DELETE FROM browsing_logs WHERE id = ?'`（`:198` = `:86`）/ `'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0'`（`:419` = `:102`、`queryPlan.ts:588` も）
- テストの隙間: `sqliteBackendParity.realEngine.test.ts:200-201` の update は defined 値のみ（undefined 語義が未 pin）

## BDD受け入れシナリオ

```gherkin
Scenario: undefined 値キーの update 語義が両バックエンドで一致する
  Given changes に undefined 値のキーを含む update を送る
  When 両バックエンドで実行する
  Then 両方とも同一の SET 節を書き行の内容が一致する

Scenario: star toggle / live count の文が単一源から派生する
  Given 共有ビルダーが提供されている
  When 両バックエンドが toggleStar / getCount を実行する
  Then 文字列リテラルの複製が消えビルダー出力が使われる
```

## 受け入れ基準

- [x] crudStatements ビルダー（toggleStar / delete / liveCount / auditInsert）を queryPlan.ts 系に追加し両バックエンドが消費する
- [x] buildUpdateSet（fields, changes, policy）が UPDATABLE_FIELDS ループを一意に所有する
- [x] undefined 語義を fixture で pin してから統一する（skip-undefined を推奨）。期待値を黙って合わせない
- [x] 両バックエンドの同入力同結果 parametric テストを追加（undefined キー含む）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit + parity: `sqliteBackendParity.realEngine.test.ts` に undefined ケース追加、`src/offscreen/__tests__/` の既存 CRUD テストを維持
- fixture 先行: undefined 値 update の現挙動差分を再現する fixture を先に置く
- 配置: `src/**/__tests__/` + `tests/`（parity）、実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する

## 実装記録

- 変更ファイル: `src/offscreen/queryPlan.ts`（buildUpdateSet / crudStatements 新設）/ `src/offscreen/IdbVfsBackend.ts` / `src/offscreen/opfsWorker/crudHandlers.ts` / `src/offscreen/opfsWorker/auditHandlers.ts` / `src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts`（undefined 語義 fixture）
- ゲート: 対象 65 tests green / offscreen 1235 tests / type-check PASS / lint PASS / validate PASS
