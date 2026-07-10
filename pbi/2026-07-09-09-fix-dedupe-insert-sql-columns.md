# PBI: 30カラムINSERT文の重複解消

## ユーザーストーリー
開発者として、履歴レコードを保存するINSERT文が1箇所で定義され全バックエンドから共有されてほしい、なぜならカラム追加・変更のたびに5箇所以上を手動で同期する必要があり、見落としによるカラム不整合バグ（保存失敗やデータ欠損）が発生しやすいから

## ビジネス価値
- カラムスキーマ変更時の実装コストと不整合バグのリスクを削減する
- 将来のスキーマ変更（例: 同期ターゲット追加によるカラム増加）を安全に行えるようにする

## 背景（レビュー指摘）
- 指摘者: Maintainability Guardian, Refactoring Evangelist（重複指摘として統合）
- 場所: `src/offscreen/sqlite.ts:374/566/643`, `src/offscreen/opfsWorker.ts:334/510`, `src/offscreen/storageFallback.ts:105-139`
- 現状: 30カラムのINSERT文（またはそれに相当するオブジェクト構築ロジック）が5箇所以上に重複記述されている
- 決定事項: `schema.ts` に `INSERT_SQL` 定数とパラメータビルダー関数を定義し、全層でそれを参照する。→ この方針で行く

## BDD受け入れシナリオ

```gherkin
Scenario: 新しいカラムを1箇所追加するだけで全バックエンドの保存処理に反映される
  Given schema.ts にINSERT_SQL定数とパラメータビルダー関数が定義されている
  When 開発者がschema.tsに新しいカラムを1つ追加し、対応するパラメータビルダーを更新する
  Then sqlite.ts / opfsWorker.ts / storageFallback.ts のいずれの保存処理も、個別の修正なしに新カラムを含むレコードを保存できる

Scenario: 既存の保存機能がリファクタリング後も同じ結果を返す
  Given リファクタリング前後でinsert/insertBatchの入力データが同一である
  When sqlite.ts / opfsWorker.ts / storageFallback.ts それぞれでレコードを保存する
  Then リファクタリング前と同じカラム構成・同じ値でレコードが保存される
  And 既存の全テストが変更なしにパスする
```

## 受け入れ基準
- [ ] `src/offscreen/schema.ts`（または同等の共有モジュール）に、INSERT対象カラムの定義とSQL文生成、パラメータ配列/オブジェクト生成を行う共通関数が定義されている
- [ ] `src/offscreen/sqlite.ts` の3箇所（374/566/643付近）のINSERT文が共通関数を参照するよう置き換えられている
- [ ] `src/offscreen/opfsWorker.ts` の2箇所（334/510付近）が共通関数を参照するよう置き換えられている
- [ ] `src/offscreen/storageFallback.ts`（105-139付近）のレコード構築ロジックも同じカラム定義を参照している（SQLではなくオブジェクトの場合はカラムリストのみ共有）
- [ ] 既存の全テストがリグレッションなくパスする
- [ ] insertとinsertBatch双方が共通関数を利用している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ブラウジング履歴を記録→SQLiteバックエンド/OPFSバックエンド/フォールバックストレージそれぞれで保存され、ダッシュボードで正しく表示されることを確認（既存E2Eがあれば流用）

### 統合テスト
- `sqlite.ts`, `opfsWorker.ts`, `storageFallback.ts` それぞれの insert/insertBatch に同一の入力レコードを渡し、保存後に取得したレコードが全カラムにわたって一致することを確認

### 単体テスト
- 新設する共通関数（例: `buildInsertParams()`, `INSERT_SQL`）の単体テスト
  - 全カラムが期待順序・期待の型で含まれること
  - 省略可能カラム（nullable）がundefined/nullとして正しく扱われること
- リファクタリング前に既存のinsert関連テストが存在することを確認し、リファクタリング後も同じテストが通ることを回帰の担保とする

## 実装アプローチ
- **Outside-In**: 既存の統合テスト（3バックエンドの保存結果比較）を先に書き、現状の重複実装でも一旦パスさせてから、共通化リファクタリングを行う
- **Red-Green-Refactor**: 共通関数を先に単体テストで固め、各バックエンドを1つずつ置き換えてグリーンを維持する
- **リファクタリング**: 全置き換え後、schema.ts内の定義とTypeScriptの型（Rowの型定義）が重複していないか確認し整理する

## 見積もり
8pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし。ただし変更範囲が3ファイル・5箇所以上に及ぶため慎重な回帰テストが必要
- テスタビリティ: 各バックエンドは既存のテストダブル（wa-sqlite等のモック）を利用
- 非機能要件: SQL文字列は事前生成してキャッシュし、insertのたびに文字列結合しないようにする（パフォーマンス劣化を避ける）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "INSERT INTO" src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts
grep -n "function.*insert\|insertBatch" src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts src/offscreen/storageFallback.ts
cat src/offscreen/schema.ts 2>/dev/null | head -50
```
`schema.ts` が既に存在するか、テーブル定義（CREATE TABLE）のみを持つファイルかを確認すること。

### 実装手順
1. `schema.ts` の現在のテーブル定義から全30カラムのリストを抽出し、カラム名の配列として定義する（`COLUMN_NAMES` 等）
2. カラムリストから `INSERT INTO logs (...) VALUES (...)` のSQL文字列を生成する関数、またはSQL文自体を定数化する
3. レコードオブジェクト（TypeScript型）からパラメータ配列を生成するビルダー関数を作成する（カラム順序とレコードのプロパティ順を一致させる）
4. `sqlite.ts` の3箇所を1つずつ置き換え、都度テストを実行して回帰がないことを確認する
5. `opfsWorker.ts` の2箇所を同様に置き換える
6. `storageFallback.ts` はSQLを使わないため、カラムリスト定義のみ共有し、オブジェクト構築ロジックを共通化する（完全な統一が難しい場合はカラム順序の定義だけでも共有する）

### 落とし穴
- `sqlite.ts` と `opfsWorker.ts` はどちらもWASM SQLiteだが呼び出しAPI（bind方式）が異なる可能性があるため、パラメータビルダーの戻り値の形式（配列 vs オブジェクト）をそれぞれのAPIに合わせて調整する必要がある
- `storageFallback.ts` はSQLを使わないプレーンオブジェクトストレージのため、SQL定数をそのまま流用できない。カラム名リストのみ共有するなど無理に完全統一しない
- insertBatch内のトランザクション処理（M11指摘）と本PBIの変更が同じファイルの近い行に触れるため、担当エージェント間で実装順序を調整すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（該当する場合）
