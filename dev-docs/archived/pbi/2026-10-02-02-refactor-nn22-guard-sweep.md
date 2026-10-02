# PBI: NN22 out-of-scope guard sweep（`'error' in result` 残存 8 箇所の共有ガード寄せ）

優先度: NN22 follow-up / RICE 4.8（暫定・integrator 裁定待ち）/ SP S（0.5、small）
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「ハンドラ足場のコピー群」）
親 PBI: [2026-10-01-22-refactor-dashboard-button-scaffold.md](2026-10-01-22-refactor-dashboard-button-scaffold.md)（受け入れ基準「`'error' in result` の inline 判定が共有ガードへ置換される」は未達。実装記録 §未達 参照 — 4 ファイル内では達成だが `markdownExport.ts` / `exportLogsService.ts` / `panels/asyncData/sqliteHistoryModel.ts` / `exportImport.ts` がスコープ外として残存）
依存: なし（NN22 の `panelAction.ts` / `unwrapServiceResult` と競合しないファイル集合のみ。`settingsForm.ts` 等の NN22 済みファイルには触らない）

## ユーザーストーリー

dashboard を保守する開発者として、NN22 のスコープ外に残った inline unwrap 判定 8 箇所を共有ガード `isServiceError` へ寄せてほしい、なぜなら同一の `if ('error' in result)` 判定が 4 ファイルに分散したままだと、次に判定意味論を変える（例: falsy error の扱い）ときに NN22 済みの 20 箇所と残り 8 箇所で挙動が静かに割れるから。

## 背景（現状）

canonical ガードは `src/dashboard/dashboardSqliteService.ts:55-56`（`export function isServiceError` at `:55`、`return 'error' in result` at `:56`）。NN22 で導入した throw 系の集約口は `src/dashboard/panels/panelAction.ts:44-45`（`unwrapServiceResult` が `isServiceError` 経由で `PanelActionFailure` を throw）。

残存 8 箇所（2026-10-02 に実パス再確認。すべて `src/dashboard/` 配下）:

- `src/dashboard/markdownExport.ts:187` — batch loop 内。`if ('error' in result) { throw new Error(result.error); }`（`:187-189`）。drop-in 置換可
- `src/dashboard/markdownExport.ts:247` — `exportDateRange` 内。同一 throw パターン（`:247-249`）。drop-in 置換可
- `src/dashboard/exportLogsService.ts:44` — `queryAllData` 内。同一 throw パターン（`:44-46`）。drop-in 置換可
- `src/dashboard/exportLogsService.ts:130` — `exportDb` 内（`backupDb()` の結果）。同一 throw パターン（`:130-132`）。drop-in 置換可
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:661` — `toggleStarImpl` 内。ガード継続は `dispatch({ type: 'operationError', ... })` + `notify()` + `return`（`:662-664`）。throw ではないため `unwrapServiceResult` 化は不可、ガード判定のみ swap
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:677` — `deleteEntry` 内。ガード継続は `dispatch({ type: 'operationError', ... })` + `notify()` + `return`（`:678-680`）。同上
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:707` — `deleteSelectedEntries` の bulk loop 内。ガード継続は `error = result.error; break;`（`:708-709`、accumulate-and-break）。同上
  - 当ファイルは `isServiceError` を既に import 済み（import at `sqliteHistoryModel.ts:27`、使用例 at `:503`。検証指示の「`:503`」は import 行ではなく使用行であることを再確認済み）
- `src/dashboard/exportImport.ts:179` — `importFromJson` の結果に対する `if ('error' in result)`（`:179-183`）。**型が異なる**: `importFromJson` は `src/dashboard/importLogsService.ts:109-112` で `Promise<{ inserted: number; skipped: number; total: number } | { error: string }>` を返し、`ServiceResult<T>`（`{ data: T } | { error: string }`）ではない。成功側に `data` ラッパーが無いため、そのまま `isServiceError(result)`（引数型 `ServiceResult<T>`）には渡せない。要 D1 裁定

既存テスト（変更なしで green を保つ対象）:
- `src/dashboard/__tests__/markdownExport.test.ts`、`src/dashboard/__tests__/markdownExport-seam.test.ts`、`src/dashboard/__tests__/exportDateSsot.golden.test.ts`
- `src/dashboard/__tests__/exportLogsService.test.ts`、`src/dashboard/__tests__/logExportSignature.test.ts`
- `src/dashboard/__tests__/exportImport.test.ts`、`src/dashboard/__tests__/exportImport-r2.test.ts`
- `src/dashboard/__tests__/importLogsService.test.ts` 系（`importLogsService-validateRow.test.ts` を含む）
- `src/dashboard/panels/asyncData/__tests__/sqliteHistoryModel` 系 suites（cache / sort / pending / pagination 等、`isServiceError` mock を持つ一式）

## BDD シナリオ

```gherkin
Scenario: throw 系ガードが共有ガードを通る
  Given queryLogs / backupDb が { error } を返す
  When markdownExport / exportLogsService が結果を処理する
  Then isServiceError（dashboardSqliteService.ts:55-56）で判定され、同一メッセージの Error が throw される

Scenario: dispatch 系ガードの継続意味論が保たれる
  Given toggleStar / deleteLog が { error } を返す
  When sqliteHistoryModel が結果を処理する
  Then 判定のみ isServiceError に置換され、継続は現状どおり（operationError dispatch / accumulate-and-break）である
```

## 実装宣言

- 挙動維持: throw されるメッセージ・dispatch される action・accumulate-and-break の件数意味論は不変。ガード判定の呼び名だけを `isServiceError` へ寄せる
- `sqliteHistoryModel.ts` の 3 箇所は `unwrapServiceResult` 化しない（継続が throw ではないため）。ガード swap のみ
- `exportImport.ts:179` は D1 裁定なしに手を付けない（widen か除外かの二択）
- 新規の振る舞い・文言変更・足場抽出はしない（純粋な guard sweep、Size S）

## 受け入れ基準

- [x] A1: `src/dashboard/markdownExport.ts:187` の inline 判定が `isServiceError` 経由になり、失敗時に同一メッセージの Error が throw される
- [x] A2: `src/dashboard/markdownExport.ts:247` の inline 判定が `isServiceError` 経由になり、失敗時に同一メッセージの Error が throw される
- [x] B1: `src/dashboard/exportLogsService.ts:44` の inline 判定が `isServiceError` 経由になり、失敗時に同一メッセージの Error が throw される
- [x] B2: `src/dashboard/exportLogsService.ts:130` の inline 判定が `isServiceError` 経由になり、失敗時に同一メッセージの Error が throw される
- [x] C1: `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:661` の判定のみ `isServiceError` に置換され、継続（`operationError` dispatch + `notify()` + `return`）が不変である
- [x] C2: `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:677` の判定のみ `isServiceError` に置換され、継続（`operationError` dispatch + `notify()` + `return`）が不変である
- [x] C3: `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:707` の判定のみ `isServiceError` に置換され、継続（`error = result.error; break;` の accumulate-and-break）が不変である
- [x] D1: (b) 除外を選択 — `exportImport.ts:179` は PBI スコープから明示的に除外する（理由は実装記録に記載）
- [x] 対象 4 ファイル内の `if ('error' in result)` inline 判定が D1 の結論と整合する状態になる（除外選択時は `exportImport.ts:179` の 1 件のみ残存し除外理由が記録される）
- [x] parity テストが存在し、成功 / `{ error }` 失敗の両経路で旧 inline 判定と同一の結果（throw メッセージ / dispatch / break 件数）を返すことを固定する
- [x] `npm run type-check` と変更ディレクトリ配下の vitest が green（上記既存テスト群を変更なしで通過、またはガード置換に伴う最小限の mock 差し替えのみ）

## テスト戦略

- parity テスト必須（振る舞い追加なしのため新規 spec は parity のみ）: 旧 inline 判定と新ガード経路の入出力 parity を固定する。最低 3 系統:
  1. throw 系（`markdownExport.ts` / `exportLogsService.ts`）: `{ error }` 入力で同一メッセージ throw、正常入力で同一データ通過
  2. dispatch 系（`sqliteHistoryModel.ts:661,677`）: `{ error }` 入力で同一 `operationError` dispatch + `notify`、正常入力で success 経路
  3. accumulate-and-break 系（`sqliteHistoryModel.ts:707`）: 途中失敗で同一 `deletedCount` + `error` の組み合わせを返す
- D1 が widen 選択の場合は `exportImport.ts:179` の parity（`{ error }` → error 表示、`{ inserted, skipped, total }` → complete 表示）も追加。除外選択の場合は追加不要だが除外理由を実装記録に残す
- 既存 conformance は変更なしで green（`markdownExport.test.ts`、`markdownExport-seam.test.ts`、`exportDateSsot.golden.test.ts`、`exportLogsService.test.ts`、`logExportSignature.test.ts`、`exportImport.test.ts`、`exportImport-r2.test.ts`、`importLogsService` tests、`sqliteHistoryModel` suites）

## 実装内容

1. A1/A2: `markdownExport.ts:187,247` の `if ('error' in result) throw new Error(result.error)` を `isServiceError` 経由（throw 系は `unwrapServiceResult` の使用も可、メッセージ同一を条件）に置換する
2. B1/B2: `exportLogsService.ts:44,130` を同上パターンで置換する（`exportDb` の backend error preserve コメントの意図を維持）
3. C1/C2/C3: `sqliteHistoryModel.ts:661,677,707` の判定条件のみ `isServiceError(result)` に swap し、継続行（dispatch / break）には触らない。同ファイル `:27` の既存 import を再利用し新規 import は追加しない
4. D1 を裁定し、widen ならガード適用 + parity、除外なら理由を実装記録に残す
5. parity テストを追加し、既存テスト群で green を確認する

## 設計メモ（open design point・実装者が選択）

- **throw 系の寄せ先**: `unwrapServiceResult`（`panelAction.ts:44-45`）を使うか、`isServiceError` + 手書き throw のままにするかは実装者の選択とする。ただし `unwrapServiceResult` は `PanelActionFailure` を throw するため、現行の素の `Error` とメッセージ同一であっても型が変わる。呼び出し側が `instanceof Error` の message 以外（`name` 等）に依存していないことを確認し、選択と理由を実装記録に 1 行残す
- **D1 widen の置き場**: `isServiceError` の引数型を `ServiceResult<T>` のまま overload 追加するか、構造的 `{ error: string }` 受けに一般化するかは実装者の選択とする。`dashboardSqliteService.ts:55` の既存 caller（NN22 済み 20 箇所 + `fetchPeriodRows` / `privacySettingsPanel` / `encryptedBackupService` 等）への波及が無いことを `type-check` で確認する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録（2026-10-02 統合パス）

- D1 裁定: (b) 除外を選択。`importFromJson` の戻り型（`{ inserted, skipped, total } | { error }`）は `ServiceResult<T>`（`{ data } | { error }`）ではなく成功側に `data` ラッパーが無いため、`isServiceError` の widen は共有ガードの型契約を弱め NN22 済み 20 箇所の型安全性を損なう。`exportImport.ts:179` の 1 件残存は意図的。
- throw 系の寄せ先: `isServiceError` + 手書き `throw new Error(result.error)` を選択（`unwrapServiceResult` 不使用）。`unwrapServiceResult` は `PanelActionFailure` を throw するため Error identity（`instanceof` / `name`）が変わる。現行の素の `Error` を維持しメッセージ同一を保証する。
- C1〜C3: 判定条件のみ swap し継続行（dispatch / break）に触れていない。同ファイル `:27` の既存 import を再利用。
- mock 整合 5 件: 既定の 4 件（`markdownExport.test.ts` / `exportLogsService.test.ts` / `logExportSignature.test.ts` / `exportDateSsot.golden.test.ts`）に加え、統合パスのフルテストで `dashboard-handlers.test.ts` の `dashboardSqliteService` mock に `isServiceError` が無いことによる 8 件失敗を検出（`isServiceError` が undefined → batch loop が早期終了）。同ファイルにも同一 1 行 stub を追加し 32/32 green を確認。他の `isServiceError` 未含有 mock 4 件（`DiagnosticsCollector.test.ts` / `generalSettingsPanel-purge.test.ts`（spread のため影響なし）/ `importLogsService*.test.ts` 2 件（対象 src 未変更のため影響なし））は変更不要。
- 検証: `npx tsc --noEmit` 0 errors、`npm run lint` 0 errors、`npm test` 全 green（1000 passed / 1 skipped、15378 passed / 21 skipped）、`npm run validate` green。
- 残差: 対象 3 src ファイル内の `if ('error' in result)` は 0 件。`src/` 全体の残存は `exportImport.ts:179` の 1 件のみ（D1 除外）。
