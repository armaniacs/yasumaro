# PBI: dashboard ボタン操作の足場抽出

優先度: 15 / RICE 7.2 / 実行順: NN21 の完了後
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「ハンドラ足場のコピー群」）
依存: **NN21（死んだシーム撤去）** — 同じ `src/dashboard/generalSettings/settingsForm.ts` を触るため先に倒す

## ユーザーストーリー

dashboard の保守操作（移行・エクスポート・アーカイブ・削除）をこの先も追加する開発者として、ボタンハンドラの足場を 1 つのエンジンに抽出してほしい、なぜなら現状は 1 ボタンあたり約 30 行の「無効化 → ラベル変更 → 呼び出し → unwrap → 表示 → finally で再有効化」を 25 箇所が手書きしており、この足場の中で既に drift が起きている（purge 系だけ catch が無く、監査 export だけ `String(err)` 表記）ため、同じ修正が漏れるから。

## 背景（現状）

共通形状は `src/dashboard/panels/diagnostic/diagnosticsActions.ts:56` にコメントとして記述されているが、コードとして抽出されていない。

- `src/dashboard/panels/diagnostic/diagnosticsActions.ts:71-92, 128-154, 157-186, 189-210, 215-236, 239-268` — 4 系統（migrate / backfill / resync / cleanup）がほぼ同一の 30 行ブロック
- `src/dashboard/panels/diagnostic/archivePanel.ts:92-113, 115-144, 146-157, 159-191, 193-208, 377-386, 388-402, 404-426, 430-493, 495-519` — 10 箇所の `setBusy(true)` スコープが同形
- `src/dashboard/panels/diagnostic/exportLogsPanel.ts:21-30, 32-41, 43-52, 54-67`（+ TSV 版 `:74-110`）— 4 箇所の byte 類似
- 結果 unwrap `if ('error' in result) throw new Error(result.error)` が `archivePanel.ts:82, 100, 128, 176, 198, 218, 394, 418, 501`（9 回）、`exportLogsService.ts:44, 130`、`markdownExport.ts:187, 247` に inline 再実装。一方、共有ガード `isServiceError` は `src/dashboard/dashboardSqliteService.ts:56` に既に存在する
- `src/dashboard/generalSettings/settingsForm.ts:188-208, 210-229` — さらに 2 コピー
- 既に起きた drift: purge 系は catch 欠落（NN09 の修正対象）、`exportLogsPanel.ts:106` のみ `String(err)` で他は `errorMessage`

## BDD シナリオ

```gherkin
Scenario: ボタン操作の足場が 1 経路に集約される
  Given archivePanel と diagnosticsActions と exportLogsPanel と settingsForm の全操作ボタン
  When いずれかの操作が成功・失敗・例外を返す
  Then 無効化 → 表示 → 再有効化の順序と表示文言が全ボタンで同一である

Scenario: unwrap 判定が共有ガードを通る
  Given サービス呼び出しが { success: false, error } を返す
  When ボタン操作が結果を処理する
  Then isServiceError（dashboardSqliteService.ts:56）で判定され、errorMessage 経由で表示される
```

## 実装宣言

- 挙動維持: 既存の表示文言・ボタンラベル・呼び出し順序は不変。足場のみ共通化し、例外安全（finally での再有効化）を全員に適用する（NN09 で追加した catch を含む）
- 高階関数（例: `runPanelAction({ button, busyLabel, run, format, target })`）で骨組みのみ共有し、各操作固有の処理は引数で渡す
- unwrap 判定は `isServiceError` へ寄せる。個別の `'error' in result` 判定を残さない

## 受け入れ基準

- [x] 4 ファイル（diagnosticsActions / archivePanel / exportLogsPanel / settingsForm）の全操作が共通足場を通る
- [ ] `'error' in result` の inline 判定が共有ガードへ置換される
- [x] 例外時も finally でボタンが再有効化され、statusEl にメッセージが出る
- [x] 既存の表示文言とボタンラベルが不変
- [x] 既存テストが green

## テスト戦略

- 既存パネルの既存テストが変更なしで green であること（足場抽出は内部構造のみの変更）
- 足場自体のユニットテスト: 成功・失敗・例外の 3 経路で「再有効化される」「メッセージが出る」を 1 箇所に固定
- 検証: `npm run type-check` と `src/dashboard/` 配下の vitest

## 実装内容

1. 共通足場ヘルパの定義（dashboard 配下の中立モジュール）
2. `diagnosticsActions.ts` / `archivePanel.ts` / `exportLogsPanel.ts` / `settingsForm.ts` のハンドラを足場へ置換
3. inline unwrap 判定を `isServiceError` へ統一

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [x] コードレビュー完了（verdict KEEP — 下記追記参照）

## 実装記録（2026-10-02）

### 変更内容

- 新規 `src/dashboard/panels/panelAction.ts`: `runPanelAction(spec)` / `unwrapServiceResult` / `abortPanelAction` / `PanelActionFailure`。足場は「ボタン無効化 → busyLabel 差し替え → onBusy(true) → onStart → run → onSuccess / onError → finally で復元」の 1 経路のみ
- 25 ハンドラを `runPanelAction` へ置換（`diagnosticsActions.ts` / `archivePanel.ts` / `exportLogsPanel.ts` / `settingsForm.ts`）
- inline な `'error' in result` 判定を 20 箇所置換し、共有ガード `isServiceError`（`dashboardSqliteService.ts`）を通す `unwrapServiceResult` に集約。対象 4 ファイル内の inline 判定は 0 になった
- `markdownExport.ts` / `exportLogsService.ts` / `sqliteHistoryModel.ts` / `exportImport.ts` には inline unwrap が残るが、本 PBI のファイル集合外として**スコープ外**

### 追加テスト

- 新規 `src/dashboard/panels/__tests__/panelAction.test.ts`: 成功 / `{ error }` 失敗 / 例外 / `abortPanelAction` の 4 経路で「再有効化される」「メッセージが出る」を固定
- 既存 3 テスト（`archivePanel` / `archiveEditModal` / `diagnosticsActions`）の `dashboardSqliteService` モックに `isServiceError` を追加（未追加だと足場経由の結果読み取りが「No ... export is defined on the mock」で落ちるため）

### 意図的な挙動差分（レビュー要）

3 件、意図して入れた差分である。

1. `exportLogsPanel.ts` の監査 TSV は、throw されたエラーを `errorMessage` ではなく `String(cause)` のまま整形する。文言が変わることになるため統一していない
2. **`exportLogsPanel.ts` の JSON / MD / CSV / DB ボタンがエクスポート中に無効化されるようになった**。従来はステータス表示のみで、再有効化する対象を持っていなかった。実挙動の変更なのでレビュー対象
3. AI 接続テストは独自の onStart / onFinish を失ったため、runner の in-flight guard で押下時間が棄却されたクリックでは、ボタンが一瞬無効化されてから復帰する

### 未達（tick しない理由）

受け入れ基準「`'error' in result` の inline 判定が共有ガードへ置換される」は**未達**。4 ファイル内では達成したが、判定はファイルスコープを限定していない基準であり、`markdownExport.ts` / `exportLogsService.ts` / `panels/asyncData/sqliteHistoryModel.ts` / `exportImport.ts` に inline unwrap が残っているため。

### 検証

`npx tsc --noEmit` / `npm run lint`（error 0）/ `npm test`（999 files, 15367 tests passed）/ `npm run validate` すべて green。

### レビュー追記（2026-10-02 統合パス）

- verdict: KEEP。per-trigger isolation（ボタン単位の busy 無効化・in-flight guard・abort 経路の分離）は意図的設計であり安全。コード変更なし。
- §未達に残した guard sweep 残存分は follow-up PBI [2026-10-02-02-refactor-nn22-guard-sweep.md](2026-10-02-02-refactor-nn22-guard-sweep.md) で解消済み（`exportImport.ts:179` の 1 件は D1 除外で意図的残存）。
