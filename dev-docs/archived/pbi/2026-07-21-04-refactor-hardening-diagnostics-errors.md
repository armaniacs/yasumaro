# PBI: 診断結果表示の堅牢化とエラーハンドリング改善

## ユーザーストーリー
開発者およびユーザーとして、診断パネルで問題が発生したときにその原因を特定できることを望む。なぜなら、現在はエラーが握りつぶされて何の痕跡も残らず、SQLite の障害と「データが0件」という正常状態が区別できないため、問題の切り分けが困難だからである。

## ビジネス価値
- **障害切り分けの迅速化**: エラー発生時に即座に原因が分かり、デバッグ時間を短縮。
- **ユーザー信頼性向上**: 「0件」表示による誤解（データ消失と勘違い）を防止。

## BDD受け入れシナリオ

```gherkin
Scenario: SQLite障害時に「0件」ではなく「取得失敗」と表示される
  Given SQLiteが利用不可な状態である
  When 診断パネルを開いた
  Then 「記録済みURL数」の値が "0" ではなく "Unavailable" または "Error" と表示される

Scenario: 診断パネルの内部エラーが握りつぶされずにログに出力される
  Given 診断パネルのいずれかの読み込み処理で例外が発生した
  When 開発者が options ページの DevTools コンソールを確認した
  Then エラーの詳細（スタックトレースや発生箇所）が console.error で出力されている

Scenario: 診断パネルのAIテスト結果が複数プロバイダでも統一されたCSSクラスで表示される
  Given 初期設定画面と診断パネルの両方でAI接続テストを実行した
  When 結果の表示スタイルを変更するCSSを追加した
  Then 両方の画面の成功/失敗表示に同じCSSクラスが適用される
```

## 受け入れ基準
- [ ] `getLogCount()` のエラー時に `0` ではなく、呼び出し元がエラー状態を検出できる値（例: -1、または `{count: number, error?: string}` 型）を返す
- [ ] 診断パネルの `catch {}` ブロックに `console.error` 等のログ出力が追加されている
- [ ] `dashboard.ts:467` の `className = 'success'/'error'` が `'diag-success'/'diag-error'` に統一されている
- [ ] 既存の全テストがパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] SQLite障害時に「記録済みURL数」が適切なエラー表示になること
- [ ] 初期設定画面と診断パネルで成功/失敗のスタイルが統一されていること

### 統合テスト
- [ ] `getLogCount()` が SQLite 障害時にエラーを伝播すること
- [ ] 診断パネルが `getLogCount()` のエラー時に適切な代替表示を行うこと

### 単体テスト
- [ ] `getLogCount()` のエラーケース（OPFS未対応、応答タイムアウト）のテスト
- [ ] 各 `catch {}` ブロックにログ出力が追加されていることの確認（スパイテスト）

## 実装アプローチ
- **Outside-In**: まずテストケースを作成し、エラー状態が適切にハンドリングされていないことを確認する
- **Red-Green-Refactor**: 修正を加えてグリーンにし、その後 CSS クラス名を整理する

## 見積もり
2pt（小規模な修正だが、getLogCountの戻り値変更による影響範囲確認が必要）

## 技術的考慮事項
- `getLogCount()` の戻り値型を変更すると、現在の呼び出し元（診断パネル2ファイル）をすべて修正する必要がある（PBI-03で1ファイルに統合されていれば修正箇所は1箇所）
- `console.error` を追加する際は、ログが過剰にならないようレベルを適切に設定する

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "getLogCount\|catch {" src/dashboard/diagnosticsPanel.ts src/dashboard/panels/diagnostic/diagnosticsPanel.ts
grep -rn "getLogCount" src/dashboard/dashboardSqliteService.ts
grep -rn "className.*success\|className.*error" src/dashboard/dashboard.ts
```

### 実装手順
1. `getLogCount()` の戻り値型を変更し、エラー時は -1 を返すか、オブジェクト型にする
2. 診断パネル側で `getLogCount()` の戻り値をチェックし、エラー時は "Unavailable" と表示する
3. 各 `catch {}` ブロックに `console.error` を追加する
4. `dashboard.ts:467` の CSS クラス名を `diag-success`/`diag-error` に統一する
5. 影響するテストを修正する

### 落とし穴
- `getLogCount()` の戻り値型を変えると、ファイル数が多いため type-check での検出が必要
- CSS クラス名の変更は見た目に影響する。統一後もスタイルが崩れないことを手動確認する必要がある

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `getLogCount()` のエラーが呼び出し元で検出・表示可能になっている
- [ ] 各 `catch {}` ブロックにログ出力が追加されている
- [ ] CSS クラス名が統一されている
- [ ] 既存の全テストがパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
