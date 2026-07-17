# PBI: opfsWorker.ts の型・マイグレーション重複の解消

## ユーザーストーリー
開発者として、`opfsWorker.ts` が `BrowsingLogRecord` 型定義や ALTER TABLE マイグレーションループを独自に保持するのをやめ、`sqlite-types.ts` と `schema.ts` から共有インポートしてほしい。
なぜなら現在カラム追加に3ファイルの編集が必要で、PBI-11 の `gist_synced` 追加時に実際に drift が発生したから。

## ビジネス価値
- **保守性**: スキーマ変更（カラム追加/削除）が1ファイルの編集で両バックエンドに反映される
- **バグ防止**: 型定義の drift（opfsWorker.ts 内の `BrowsingLogRecord` が `sqlite-types.ts` とズレるリスク）を排除
- **コード量削減**: 約200行の重複コードが削除される

## BDD受け入れシナリオ

```gherkin
Scenario: opfsWorker.ts が共有型定義をインポートする
  Given opfsWorker.ts が Web Worker としてバンドルされている
  When  Worker が初期化されるとき
  Then Worker は独自の BrowsingLogRecord 型定義を持たず
  And sqlite-types.ts からインポートした型を使用している

Scenario: opfsWorker.ts が共有マイグレーションを実行する
  Given PBI #5 で抽出された shared/migrations.ts が存在する
  When  opfsWorker の initSqliteInner() が呼ばれたとき
  Then ALTER TABLE のループを独自に持たず
  And shared/migrations.ts の runMigrations() を呼び出す

Scenario: 新規カラム追加が1ファイル編集で両バックエンドに反映される
  Given browsing_logs テーブルに新規カラム new_field を追加したい
  When  schema.ts の COLUMN_NAMES と InsertableRecord に new_field を追加したとき
  Then opfsWorker.ts も sqliteEngineContext.ts も変更不要で反映される
```

## 受け入れ基準
- [ ] `opfsWorker.ts` 内の `BrowsingLogRecord` インターフェース定義（56行）が削除され、`sqlite-types.ts` からのインポートに置き換わっている
- [ ] `opfsWorker.ts` 内の `SearchResultRecord` 型が削除され、`sqlite-types.ts` の `SearchResult` をインポートしている
- [ ] `opfsWorker.ts` 内の `QueryPayload`, `SearchPayload` 型が削除され、共有型を使用している
- [ ] Worker のビルドが成功する（ESM import が Worker コンテキストで解決される）
- [ ] 既存の全テストがパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- OPFS Worker パスで履歴の記録・検索・削除が変わらず動作すること

### 統合テスト
- Worker バンドルが `sqlite-types.ts` のインポートを正しく解決すること（ビルド成功 = 統合テスト）
- Worker が起動時に共有型を使って正しくシリアライズ/デシリアライズできること

### 単体テスト
- 変更前後で Worker のメッセージハンドリングの型安全性が維持されていること

## 実装アプローチ
- **依存**: PBI #1（StorageBackend アダプタ）の完了後に着手
- **安全性**: 型定義の削除のみでランタイムロジック変更なし。型チェックが全ての保証になる

## 見積もり
2 ストーリーポイント（主に import の整理と型の置換）

## 技術的考慮事項
- **依存関係**: PBI #1 のアダプタインターフェース導入後に着手（型の整合性をアダプタで保証できる）
- **テスタビリティ**: 型チェック（`npm run type-check`）が主な検証手段
- **非機能要件**: バンドルサイズに変化なし。Worker の起動時間に影響なし
- **ADR参照**: ADR 2026-06-17 の Worker 分離アーキテクチャは維持。共有化は import の追加のみ

## 実装者向け注記

### 現状コードの確認
```bash
# Worker 内の型定義を確認
rg -n "^interface " src/offscreen/opfsWorker.ts
# 共有型との差分を確認
diff <(rg "interface BrowsingLogRecord" -A 60 src/offscreen/opfsWorker.ts) \
     <(rg "interface BrowsingLogRecord" -A 60 src/utils/sqlite-types.ts)
```

### 実装手順
1. `src/offscreen/opfsWorker.ts` から `BrowsingLogRecord` インターフェースを削除
2. `import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js'` を追加
3. `SearchResultRecord`, `QueryPayload`, `SearchPayload` を削除し、共有型で置換
4. `npm run build` で型チェックとビルド確認

### 落とし穴
- Worker 内の `import` は WXT/Vite が解決する。パスが正しいか注意（`../utils/sqlite-types.js` の `.js` 拡張子は ESM 解決に必要）
- `BrowsingLogRecord` のフィールドが `sqlite-types.ts` と Worker 内で使われている箇所で型が一致しているか確認（特に optional/nullable の扱い）

## Definition of Done
- [ ] opfsWorker.ts から重複型定義が全て削除されている
- [ ] `npm run type-check` が成功する
- [ ] `npm run build` が成功する
- [ ] 既存の全テストがパスする
- [ ] コードレビュー完了
