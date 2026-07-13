# PBI: sqliteClient.call() のエラー伝播改善

## ユーザーストーリー
開発者として、`SqliteClient.call()` が失敗時に `null` ではなく構造化されたエラー情報を返してほしい。
なぜなら現在すべての障害（タイムアウト、offscreen ドキュメント喪失、ディスクI/Oエラー、クォータ超過）が `null` に潰され、ダッシュボードに「履歴の読み込みに失敗しました」という一律のメッセージしか表示できないから。

## ビジネス価値
- **UX改善**: ユーザーに具体的なエラーメッセージを表示できる（例: 「データベースの初期化中です。しばらくお待ちください」vs「ディスク容量が不足しています」）
- **デバッグ容易性**: エラーの種類が呼び出し元で判別可能になり、問題特定が高速化
- **回復可能性**: 一時的なエラー（offscreen 再起動中など）と永続的なエラーを区別し、自動リトライの判断が可能になる

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系は success:true を返す
  Given SQLite データベースが正常に動作している
  When  dashboardSqliteService.queryLogs() が呼ばれたとき
  Then  { success: true, rows: [...], total: N } が返される

Scenario: タイムアウト時に具体的なエラーを返す
  Given Service Worker からの応答が10秒以内に返らない
  When  dashboardSqliteService.queryLogs() が呼ばれたとき
  Then  { success: false, error: "Dashboard SQLite request timed out" } が返される

Scenario: バックエンドエラー時にエラーメッセージが伝播する
  Given OPFS Worker がディスクI/Oエラーを返した
  When  dashboardSqliteService.queryLogs() が呼ばれたとき
  Then  { success: false, error: "disk I/O error" } のような具体的なエラーメッセージが返される

Scenario: データベース未初期化時に初期化中であることを伝える
  Given SQLite データベースが未初期化である
  When  dashboardSqliteService.queryLogs() が呼ばれたとき
  Then  { success: false, error: "Database not initialized" } が返され
  And  エラーメッセージに初期化待機のヒントが含まれる
```

## 受け入れ基準
- [ ] `SqliteClient.call()` の戻り値が `T | null` から `{ success: true; data: T } | { success: false; error: string }` に変更されている
- [ ] `dashboardSqliteService.ts` の全関数が `null` チェックではなく `response.success` で分岐する
- [ ] `sqliteHistoryPanel.ts` のエラー表示が具体的なメッセージを反映する
- [ ] ダッシュボードのエラー表示が「読み込みに失敗しました」から具体的な理由に変わる（最低3パターン: タイムアウト / DB未初期化 / ストレージエラー）
- [ ] 既存の全テストがパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで SQLite 未初期化時に具体的なエラーメッセージが表示されること
- ダッシュボードでタイムアウト時にリトライを示唆するメッセージが表示されること

### 統合テスト
- `SqliteClient.call()` → `dashboardSqliteService` のチェーンでエラー情報が失われず伝播すること
- Service Worker の `DASHBOARD_SQLITE` ハンドラが `SqliteClient` のエラーを正しくシリアライズしてダッシュボードに返すこと

### 単体テスト
- `call()` が各エラーケースで正しい error 文字列を返す（offscreen 不在 / タイムアウト / オペレーションエラー）
- `dashboardSqliteService.queryLogs()` が `{ success: false }` を受け取ったときに適切にハンドリングする

## 実装アプローチ
- **互換性維持**: 呼び出し元の全箇所を修正する（約20箇所の `null` チェック）。TypeScript の型で漏れを検出
- **段階的**: まず `call()` の型を変更 → コンパイルエラー箇所を修正 → ダッシュボードのエラー表示を改善

## 見積もり
1 ストーリーポイント（極小変更。戻り値の型変更 + 呼び出し元修正）

## 技術的考慮事項
- **依存関係**: 独立。他のPBIと並列で着手可能
- **テスタビリティ**: 変更は純粋に関数の戻り値型の変更。既存テストのモックが戻り値 `null` を期待している場合は修正が必要
- **非機能要件**: パフォーマンス影響なし（オブジェクトのアロケーションが1つ増えるのみ）
- **ADR参照**: 特になし

## 実装者向け注記

### 現状コードの確認
```bash
# call() の現在のシグネチャと全呼び出し箇所
rg -n "call\(" src/background/sqliteClient.ts
rg -n "= await.*call\(" src/background/
# null チェックしている全箇所
rg -n "=== null" src/dashboard/dashboardSqliteService.ts
rg -n "!result" src/dashboard/dashboardSqliteService.ts
```

### 実装手順
1. `src/background/sqliteClient.ts`:
   ```ts
   // Before
   private async call<T>(fn: () => Promise<T>): Promise<T | null> {
   // After
   private async call<T>(fn: () => Promise<T>): Promise<{ success: true; data: T } | { success: false; error: string }> {
   ```
2. エラーメッセージの分類: タイムアウト / offscreen 不在 / 操作エラー の3種類に分類
3. `dashboardSqliteService.ts` の全関数を修正（約20関数）:
   ```ts
   // Before
   if (result === null) return null;
   // After
   if (!result.success) {
     console.error('queryLogs failed:', result.error);
     return null;
   }
   ```
4. `sqliteHistoryPanel.ts` のエラー表示を改善（`state.error` に具体的なメッセージを設定）

### 落とし穴
- `dashboardSqliteProtocol.ts` のレスポンス型との整合性。`DashboardSqliteResponseFor<S>` は既に `{ success: false; error: string }` を含むため、大きな変更は不要なはず
- Service Worker のハンドラ（`dashboardSqliteHandlers.ts`）が `SqliteClient` の新しい戻り値型を受け取って `sendResponse` に渡す際のマッピング

## Definition of Done
- [ ] `call()` が structured error を返す
- [ ] 全呼び出し元が新しい戻り値型に対応
- [ ] ダッシュボードのエラー表示が3パターン以上に対応
- [ ] 既存の全テストがパスする
- [ ] `npm run type-check` が成功する
- [ ] コードレビュー完了
