# PBI: import ガードの構造的決着（`exportImport.ts:179` の型不一致）

優先度: C1 / RICE #3 / SP S（0.5、small）
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「型安全性」）
親 PBI: [2026-10-02-02-refactor-nn22-guard-sweep.md](../dev-docs/archived/pbi/2026-10-02-02-refactor-nn22-guard-sweep.md)（D1 未達の決着。NN22 follow-up の D1 裁定なしに手を付けない制約の解除が本 PBI の発足条件）
依存: なし（対象 3 ファイルのみ。他の NN22 済み 20 箇所への波及なしを `type-check` で確認）

## ユーザーストーリー

dashboard を保守する開発者として、`exportImport.ts:179` の inline 判定の扱いを構造的に決着してほしい、なぜなら `importFromJson` の戻り型が `ServiceResult<T>` ではないまま放置されると、次のガード変更で import 経路だけ挙動が静かに割れるから。

## 背景（現状）

- 対象 1: `src/dashboard/exportImport.ts:179` — `importFromJson` の結果に対する `if ('error' in result)`（`:179-183`）。
- 対象 2: `src/dashboard/importLogsService.ts:109-112` — `importFromJson` の戻り型 `Promise<{ inserted: number; skipped: number; total: number } | { error: string }>`。成功側に `data` ラッパーが無い。
- canonical ガード: `src/dashboard/dashboardSqliteService.ts:55-56`（`export function isServiceError` at `:55`、`return 'error' in result` at `:56`）。引数型は `ServiceResult<T>`（`{ data: T } | { error: string }`）のため、そのまま渡せない。
- 既存テスト（変更なしで green を保つ対象）:
  - `src/dashboard/__tests__/exportImport.test.ts`、`src/dashboard/__tests__/exportImport-r2.test.ts`
  - `src/dashboard/__tests__/importLogsService` 系（`importLogsService-validateRow.test.ts` を含む）

## BDD シナリオ

```gherkin
Scenario: import 失敗が構造的ガードを通る
  Given importFromJson が { error } を返す
  When exportImport が結果を処理する
  Then 構造的ガード（overload または narrow guard）で判定され、現状と同一の error 表示になる

Scenario: import 成功がそのまま通過する
  Given importFromJson が { inserted, skipped, total } を返す
  When exportImport が結果を処理する
  Then 構造的ガードで正常判定され、現状と同一の complete 表示になる
```

## 実装宣言

- 挙動維持: error 表示文言・complete 表示の件数意味論は不変。変えるのはガード判定の呼び名だけ
- D1 の三択（(a) 構造的 overload 追加 (b) 専用 narrow guard (c) 型証拠付きの codified 除外）のいずれかを実装し、選択理由を実装記録に残す
- 共有ガードの型契約を弱めない（NN22 済み 20 箇所への波及なしを `type-check` で確認）
- 新規の振る舞い・文言変更・足場抽出はしない（Size S）

## 受け入れ基準

- [x] D1: 三択のいずれかが実装される — (a) `isServiceError` の構造的 overload 追加 OR (b) 専用 narrow guard の新設 OR (c) 型証拠付きの codified 除外（除外理由 + 型差分の記録）
- [x] D1 が (a)/(b) 選択の場合: `src/dashboard/exportImport.ts:179` の inline 判定が新ガード経由になり、成功 / `{ error }` 失敗の両経路で現状と同一の表示になる
- [x] D1 が (c) 選択の場合: 除外理由と型証拠（`importLogsService.ts:109-112` vs `dashboardSqliteService.ts:55-56` の型差分）が実装記録に残り、`exportImport.ts:179` の残存が意図的と明示される
- [x] parity テストが存在し、成功 / `{ error }` 失敗の両経路で旧 inline 判定と同一の結果（error 表示 / complete 表示）を返すことを固定する（(c) 選択時は parity 追加不要だが除外の型証拠テストまたは記録で代替）
- [x] `npm run type-check` が clean（0 errors）で既存 caller への波及がない
- [x] 変更ディレクトリ配下の vitest が green（上記既存テスト群を変更なしで通過、またはガード置換に伴う最小限の mock 差し替えのみ）

## テスト戦略

- parity テスト必須（(a)/(b) 選択時）: 旧 inline 判定と新ガード経路の入出力 parity を固定する。最低 2 系統:
  1. `{ error }` 入力で同一 error 表示
  2. `{ inserted, skipped, total }` 入力で同一 complete 表示
- (c) 選択時は parity 追加不要だが、除外の型証拠（型差分を示す記録または型レベルテスト）を残す
- 既存 conformance は変更なしで green（`exportImport.test.ts`、`exportImport-r2.test.ts`、`importLogsService` tests）

## 実装内容

1. D1 を裁定し、(a) overload 追加 / (b) narrow guard 新設 / (c) codified 除外のいずれかを実装する
2. (a)/(b) の場合は `exportImport.ts:179` を新ガード経由に置換し、`type-check` で波及なしを確認する
3. parity テスト（または (c) の型証拠）を追加し、既存テスト群で green を確認する

## 設計メモ（open design point・実装者が選択）

- **(a) の置き場**: `isServiceError` の引数型を `ServiceResult<T>` のまま overload 追加するか、構造的 `{ error: string }` 受けに一般化するかは実装者の選択とする。`dashboardSqliteService.ts:55` の既存 caller への波及が無いことを `type-check` で確認する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録

- 2026-10-02 実装済み。D1 は (b) 専用 narrow guard を選択。`importFromJson` の戻り型を `ImportLogsResult` として名前付けし、`isImportError` ガードを `importLogsService.ts` に新設。`exportImport.ts:179` の inline 判定を新ガード経由に置換。
- 選択理由: 成功側が bare `{ inserted, skipped, total }` で `data` ラッパーを持たないため `ServiceResult<T>` ではなく、`isServiceError` の型契約を弱めずに済む (b) が最小波及。`dashboardSqliteService.ts` は無変更。
- 新規テスト `src/dashboard/__tests__/importLogsService-guard.test.ts`（2 tests: `{ error }` / 成功形の両経路で旧 inline 判定との parity + narrow 後の型アクセス）。`exportImport-r2.test.ts` の `importLogsService` mock に `isImportError` shim を 1 行追加（ガード置換に伴う最小限の mock 差し替え）。
- ゲート: `npx tsc --noEmit` 0 errors（既存 caller への波及なし）、`npm run lint` 0 errors、全 suite 15397 passed。
