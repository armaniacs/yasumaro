# PBI: 2026-08-02-05-fix-sqlite-unique-constraint-validation

## ユーザーストーリー
データベースエンジニアとして、閲覧履歴の保存時に発生しうるユニーク制約違反（URLと作成日時の重複）が正しくハンドリングされ、データが二重に登録されないことを保証したい、なぜこそ同一ページへの短時間での連続アクセスやリトライ処理が発生した際、DBに重複レコードが作成されると、集計結果の不整合やストレージの浪費につながるから

## ビジネス価値
- **データ整合性の維持**: 閲覧履歴のユニーク性が担保され、分析や検索結果に重複データが現れないことを保証する
- **ストレージ効率の向上**: 不要な重複レコードの蓄積を防ぎ、DBサイズを最適に保つ

## BDD受け入れシナリオ

```gherkin
Scenario: Prevent Duplicate Record Insertion
  Given A browsing log record with (url="https://example.com", created_at=1722500000) already exists in DB
  When Another record with the exact same url and created_at is inserted
  Then The database uses "INSERT OR IGNORE" to prevent a crash
  And Only one record with that (url, created_at) pair exists in the database
  And The operation returns success without throwing a constraint violation error

Scenario: Allow Different Records with Same URL
  Given A browsing log record with (url="https://example.com", created_at=1722500000) already exists in DB
  When A record with the same url but different created_at (e.g., 1722500001) is inserted
  Then Both records are successfully stored in the database
  And The database contains two distinct records for the same URL
```

## 受け入れ基準
- [ ] `src/offscreen/recordsRepo.ts` の `insert` または `insertBatch` メソッドにおいて、`INSERT OR IGNORE` または相当する重複排除ロジックが正しく機能していることを検証するテストを実装すること
- [ ] 同一のユニークキーを持つデータを連続して挿入した際、例外が発生せず、レコード数が増加しないことを確認すること
- [ ] ユニークキーの一部（例: URLのみ）が同じで、他（例: created_at）が異なる場合は正しく挿入されることを確認すること

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] (適用外: DB操作の低レイヤー検証であるため統合/単体テストで対応)

### 統合テスト
- [ ] 実際のSQLite DB（またはインメモリDB）を使用して、ユニーク制約違反が発生するケースを再現し、期待通りに無視されることを検証するテスト

### 単体テスト
- [ ] `recordsRepo.ts` の挿入メソッドに対する境界値テスト（空文字URL、極端なタイムスタンプなど）

## 実装アプローチ
- **Outside-In**: `recordsRepo.insert` を呼び出し、DBの状態を検証するテストから書き始め、必要に応じてSQLクエリ（`INSERT OR IGNORE` 等）を最適化する
- **Verification by Count**: 挿入前後のレコード数を `SELECT COUNT(*)` で比較し、重複挿入時にカウントが増えていないことをアサートする

## 見積もり
2ストーリーポイント

## 技術的考慮事項
- 依存関係: `src/offscreen/recordsRepo.ts`, `src/offscreen/storageFallback.ts`
- テスタビリティ: SQLiteのユニーク制約をテストするために、一時的なテスト用DBファイルを作成して検証する
- 非機能要件: 重複チェックによる挿入パフォーマンスへの影響を最小限にする

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "INSERT OR IGNORE" src/offscreen/recordsRepo.ts
```
`recordsRepo.ts` のコメントに `INSERT OR IGNORE` を使用している旨の記載があるが、実際の SQL 文で正しく実装されているか、また `storageFallback.ts` (OPFS不可時の代替) でも同様の重複排除が行われているか確認が必要。

### 実装手順
1. `src/offscreen/__tests__/recordsRepo-constraints.test.ts` を新規作成
2. 同一キーのデータを2回挿入し、レコード数が1件であることを検証するテストを実装
3. URLが同じで時間が異なるデータを挿入し、レコード数が2件になることを検証するテストを実装
4. `storageFallback.ts` でも同様の整合性が保たれているかテストを追加

### 落とし穴
- SQLiteのバージョンによって `INSERT OR IGNORE` の挙動が異なる場合があるため、ターゲット環境での動作を確認すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] DBに重複レコードが作成されないことが証明される
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
