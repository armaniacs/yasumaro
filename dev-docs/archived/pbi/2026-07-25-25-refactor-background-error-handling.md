# PBI: background/配下の重複するtry-catchパターンを共通エラーハンドリングに集約する

**作成日**: 2026-07-25
**完了日**: 2026-07-26（sqliteClient.tsでの試験導入のみ。他ファイルへの展開は見送り、フォローアップとして記録）
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🟡軽微（エラーハンドリングのラップにより、既存のログ出力形式・エラー伝播の挙動が変わらないことを慎重に確認する必要がある）

## 実装メモ（2026-07-26）

調査の結果、`sqliteClient.ts` には既に `call<T>()`（178-199行）という共通エラーハンドリングラッパーが
存在し、`init`/`insert`/`update`/`delete`/`query`等のほぼ全メソッドがこれを経由していた。つまりPBIが
提案する「共通ラッパーの試験導入」は既に大部分完了していた状態だった。

未統一だったのは `restoreDb()` と `isSqliteHealthy()` の2箇所のみ（独自の try-catch、`restoreDb` は
`console.error` を使っており他メソッドの `logError`/`addLog` 系と一貫性がなかった）。この2箇所を `call()`
経由に統一。`isSqliteHealthy()` には既存テストがなかったため新規に3件追加。

sqliteClient全54件パス。**他ファイル（`migrationService.ts`, `sessionAlarmsManager.ts`,
`service-worker.ts`, `recordingLogic.ts`）への展開は本セッションでは見送った** — それぞれ既存の
try-catchパターンが `sqliteClient.ts` の `call()` ほど統一されていない可能性があり、個別の設計判断が
必要なため、別PBIとして改めて起票することを推奨する。

---

## 背景

Checking Team レビュー（2026-07-25）の Refactoring Evangelist からの指摘。`src/background/`全体で `try {` が78件、15ファイルに分散している。特に `migrationService.ts`(8件)、`sessionAlarmsManager.ts`(7件)、`service-worker.ts`(7件)、`sqliteClient.ts`(6件)、`recordingLogic.ts`(6件) に集中しており、各所で `addLog(LogType.ERROR, ...)` + `errorMessage(error)` という似たパターンが繰り返されている。共通エラーハンドリングラッパーへの集約余地がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "try {" src/background/*.ts | wc -l
grep -c "try {" src/background/migrationService.ts src/background/sessionAlarmsManager.ts src/background/service-worker.ts src/background/sqliteClient.ts src/background/recordingLogic.ts
grep -n "addLog(LogType.ERROR" src/background/migrationService.ts
```

**このPBIは規模が大きいため、一括で全ファイルを対象にせず、まず1ファイル（例: `sqliteClient.ts`）で共通ラッパー関数を試験導入し、パターンが有効か検証してから他ファイルへ展開する。**

## 受け入れ基準（BDD）

```gherkin
Scenario: 共通エラーハンドリングラッパーが導入される
  Given withErrorLogging(fn, context) のような共通ヘルパー関数が定義されている
  When 既存の try-catch + addLog パターンをこのヘルパーで置き換える
  Then エラー発生時に元と同じログ内容（LogType, message, error詳細）が記録される

Scenario: エラーの再スロー挙動が変わらない
  Given 既存コードがエラーを再スローしていた箇所
  When 共通ラッパーに置き換える
  Then エラーは引き続き呼び出し元に伝播する（握りつぶされない）

Scenario: 段階的な移行が可能である
  Given sqliteClient.ts で共通ラッパーを試験導入した
  When 既存テストを実行する
  Then 全てパスし、他のファイルへの展開判断ができる
```

## 受け入れ基準
- [ ] `src/utils/errorHandling.ts`（または適切な場所）に共通エラーハンドリングラッパー関数を作成する
- [ ] `sqliteClient.ts` で試験的に導入し、既存のログ出力・エラー伝播の挙動が変わらないことを確認する
- [ ] 試験導入が成功したら、`migrationService.ts`, `sessionAlarmsManager.ts`, `service-worker.ts`, `recordingLogic.ts` へ順次展開する（ファイルごとに個別PRとしてもよい）
- [ ] 各ファイルの既存テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 共通ラッパーが正常系でそのまま結果を返すことを確認
- 共通ラッパーが異常系でログを記録しつつエラーを再スローすることを確認
- 既存の各ファイルのエラーハンドリングテストが回帰しないことを確認

## 実装アプローチ

1. 既存の `try-catch + addLog` パターンを分析し、共通化可能な形（関数シグネチャ、ログレベル、エラーコード引き渡し方法）を設計
2. `sqliteClient.ts` で試験導入
3. 問題なければ他ファイルへ段階的に展開

## 見積もり

3pt（設計 + 試験導入 + 検証。他ファイルへの展開は別PBIとして分割してもよい）

## 技術的考慮事項
- 依存関係: `src/utils/logger.ts`, `src/utils/errorUtils.ts`
- テスタビリティ: 既存のログ・エラーテストが土台になる
- 非機能要件: 保守性

## Definition of Done
- [ ] 共通エラーハンドリングラッパーが実装されている
- [ ] 少なくとも1ファイル（sqliteClient.ts）で試験導入され、テストがパスしている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Refactoring Evangelist指摘、「大量のtry-catchの重複」Low項目と統合）
- 対象コード: `src/background/*.ts`（15ファイル、78件のtry-catch）
