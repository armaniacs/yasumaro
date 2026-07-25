# PBI: SQLiteクライアントの更新操作に楽観的ロックを適用する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🟡軽微（更新処理にバージョン列とWHERE句条件を追加するため、既存呼び出し元での競合エラーハンドリング追加が必要）

---

## 背景

Checking Team レビュー（2026-07-25）の Data Integrity Expert からの指摘。`src/utils/optimisticLock.ts` にはバージョンベースの楽観的ロック実装（`ConflictError`, `withOptimisticLock`）が存在するが、これは **`chrome.storage.local` 向け**（`chrome.storage.local.set` のアトミック性に依存した簡易実装、コメント1-8行）である。一方 `src/background/sqliteClient.ts:211`（`insert`）、`:225`（`insertBatch`）、`:273`（`update`）にはバージョン列やWHERE句での競合検出ロジックが見当たらず、**SQLite側の書き込みには楽観的ロックが適用されていない**。

複数のService Workerインスタンス、またはオフスクリーンドキュメント経由の並行書き込みが発生した場合、Last-Write-Winsで意図しない上書きが起こりうる。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "class.*Lock\|withOptimisticLock\|ConflictError" src/utils/optimisticLock.ts
grep -n "UPDATE\|update(" src/background/sqliteClient.ts
```

SQLiteクライアントがどのテーブルに対してどんな更新操作を行っているか（`update` の呼び出し元）を洗い出し、実際に並行更新が起こりうる箇所（同一レコードへの複数経路からの更新）を特定してからスコープを決める。全テーブルへの適用は過剰な可能性があるため、実際にリスクのある更新パスに絞る。

## 受け入れ基準（BDD）

```gherkin
Scenario: バージョン列を持つレコードの更新時に競合を検出する
  Given レコードが version=1 で保存されている
  When 別のプロセスが version=1 を前提に UPDATE を試みるが、その間に別の書き込みで version=2 になっている
  Then UPDATE は0件影響（WHERE version=1が一致しない）となり、呼び出し元に ConflictError 相当が返る

Scenario: 競合がない場合は通常通り更新される
  Given レコードが version=1 で、他に並行更新がない
  When update() を呼び出す
  Then 更新が成功し、versionが2にインクリメントされる

Scenario: 呼び出し元が競合エラーを適切にハンドリングする
  Given update() が競合エラーを返す
  When 呼び出し元コードがこれを受け取る
  Then リトライまたはユーザーへの通知が行われ、サイレントなデータ喪失は起きない
```

## 受け入れ基準
- [ ] 並行更新のリスクがあるテーブル（対象を調査で特定する）に `version` カラムを追加するマイグレーションを作成する
- [ ] `sqliteClient.ts` の `update()` に `WHERE version = ?` 条件を追加し、影響行数が0の場合は競合として扱う
- [ ] 競合検出時に `optimisticLock.ts` の `ConflictError` 相当の例外を投げる
- [ ] 呼び出し元で競合時のリトライまたはエラー通知を実装する
- [ ] 既存の `sqliteClient` テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- version不一致時にUPDATEが0件影響になり競合エラーが返ることを確認
- version一致時は正常に更新されバージョンがインクリメントされることを確認

### 統合テスト
- 並行更新シナリオ（2つのPromiseが同じレコードを同時に更新しようとする）で、片方が競合エラーになることを確認

## 実装アプローチ

1. `sqliteClient.ts` の `update` が使われている全箇所を洗い出し、並行更新リスクのあるテーブルを特定
2. 対象テーブルに `version INTEGER DEFAULT 1` カラムを追加するマイグレーションを作成
3. `update()` メソッドを `WHERE id = ? AND version = ?` 形式に変更し、影響行数チェックを追加
4. 呼び出し元に競合時のハンドリングを追加

## 見積もり

3pt（マイグレーション + クライアント変更 + 呼び出し元対応 + テスト）

## 技術的考慮事項
- 依存関係: `src/utils/optimisticLock.ts` の設計パターンを参考にする
- テスタビリティ: SQLiteのin-memoryモードでの並行更新テストが必要
- 非機能要件: データ整合性

## Definition of Done
- [ ] 対象テーブルにversion列が追加されている
- [ ] update処理が楽観的ロックに対応している
- [ ] 競合時のハンドリングが呼び出し元に実装されている
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Data Integrity Expert指摘）
- 対象コード: `src/background/sqliteClient.ts:211, 225, 273`, `src/utils/optimisticLock.ts`
