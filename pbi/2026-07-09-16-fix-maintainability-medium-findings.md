# PBI: 保守性/コード品質中優先度指摘の解消（M15〜M19）

## ユーザーストーリー
開発者として、Markdownエクスポート・CRUDロジック・初期化ガード・マイグレーション処理の重複コードが整理されていてほしい、なぜなら重複が多いほど変更漏れやバグ混入のリスクが高まり、コードレビューや機能追加のコストが増大するから

## ビジネス価値
- 重複コードの整理により将来の機能追加・バグ修正の工数を削減する
- コードベースの一貫性を高め、新規参加者のオンボーディングコストを下げる

## 背景（レビュー指摘）
[plans/2026-07-09-1633-review-feat-6_5.md](../plans/2026-07-09-1633-review-feat-6_5.md) の「Medium 保守性 / コード品質」セクション（M15〜M19）を1つのPBIとして束ねる。

| # | 指摘 | 場所 | 対処方針 |
|---|------|------|---------|
| M15 | dashboard.tsに3つのほぼ同一のMarkdownエクスポート関数 | `src/dashboard/dashboard.ts:745/823/951` | パラメータ化関数にリファクタリング |
| M16 | sqlite.tsとopfsWorker.ts間でCRUDロジックが重複 | `src/offscreen/sqlite.ts`, `opfsWorker.ts` | Strategyパターンによるバックエンド選択の抽出 |
| M17 | reviewSummaryGeneratorがmodule-levelでSqliteClient/AIClientを生成 | `src/background/reviewSummaryGenerator.ts:18/194/259` | DIで注入可能に変更 |
| M18 | opfsWorker message handlerのinitガードが冗長 | `src/offscreen/opfsWorker.ts:867-956` | switch文の前で1回チェックに統一 |
| M19 | migrationServiceのtry/catchと進捗追跡が重複 | `src/background/migrationService.ts:121-168` | バッチ処理ループを共通化 |

**注記**: M17はM8（[2026-07-09-15](2026-07-09-15-fix-performance-architecture-medium-findings.md)）と同一指摘（Domain Logic ExpertとSystem Architectの重複指摘としてレビュー結果内で統合済み）。本PBIでは重複作業を避けるためM17を除外し、M15/M16/M18/M19のみを対象とする。

## BDD受け入れシナリオ

```gherkin
Scenario: 3種類のMarkdownエクスポートが共通関数のパラメータ違いとして動作する（M15）
  Given dashboard.tsに3種類のエクスポート形式（例: 全件/フィルタ済み/期間指定）がある
  When 開発者が新しいエクスポート形式のオプションを1つ追加する
  Then 共通のパラメータ化関数にオプションを渡すだけで対応でき、個別関数を複製する必要がない
  And 既存の3種類のエクスポート結果はリファクタリング前後で変化しない

Scenario: sqlite.tsとopfsWorker.tsが共通のCRUD戦略インターフェースを実装する（M16）
  Given Strategyパターンで抽出された共通CRUDインターフェースがある
  When 新しいCRUD操作（例: 新しいフィルタ条件での検索）を追加する
  Then 両バックエンドで共通のインターフェースに従って実装され、片方だけ実装漏れが起きにくい構造になる

Scenario: opfsWorkerのメッセージハンドラでinitガードが1箇所に統一される（M18）
  Given opfsWorkerが初期化前にメッセージを受信する
  When いずれかの操作タイプのメッセージが送られる
  Then switch文に入る前の1箇所のガードで未初期化エラーが返され、各case内で重複したチェックが行われない

Scenario: migrationServiceのバッチ処理ループが共通化される（M19）
  Given 複数のマイグレーションステップがそれぞれtry/catchと進捗追跡を持つ
  When 新しいマイグレーションステップを追加する
  Then 共通化されたバッチ処理ループ関数にステップ固有のロジックだけを渡せばよく、try/catchと進捗追跡コードを複製する必要がない
```

## 受け入れ基準
- [x] M15: `dashboard.ts` の3つのMarkdownエクスポート関数（745/823/951付近）が1つのパラメータ化関数に統合され、既存の呼び出し元は変更なく動作する（2026-07-12実装: `exportLocalMarkdownCore()`に統合。`handleManualLocalMarkdownExport`/`handleExportLocalMarkdown`/`handleHistoryExportLocalMarkdown`のシグネチャ・呼び出し元は変更なし。振る舞い保存テスト5件追加）
- [x] M16: `sqlite.ts` と `opfsWorker.ts` の共通CRUDロジックがStrategyパターン（または共通インターフェース+バックエンド固有実装）として抽出されている（2026-07-12実装: 完全一致していた`sanitizeFtsTerm`/`FTS_QUERY_MAX_LENGTH`を`schema.ts`に共通化。`ALLOWED_ORDER_COLUMNS`と`extractDomain`は両ファイルで実際に内容が異なっていた（sqlite.tsの方が許可列が多い、opfsWorker.tsはwww.除去あり）ため、振る舞い保存を優先し統合せず据え置き。単体テスト5件追加）
- [x] M18: `opfsWorker.ts` のメッセージハンドラのinitガードがswitch文前の1箇所に統一されている（2026-07-11実態調査で確認）
- [x] M19: `migrationService.ts` のtry/catchと進捗追跡ロジックが共通のバッチ処理ループ関数に統合されている（2026-07-11実態調査で確認）
- [ ] 全項目でリファクタリング前後の既存テストが変更なくパスする（振る舞い保存のリファクタリングであることを担保）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードから3種類のエクスポートを実行し、それぞれ正しいMarkdown出力が得られることを確認するシナリオテスト（M15）

### 統合テスト
- リファクタリング前に既存の統合テストが存在することを確認し（なければ追加）、リファクタリング後も同じ入出力になることを保証する（M15, M16, M19）

### 単体テスト
- パラメータ化されたエクスポート関数の単体テスト（オプションごとの出力差分）（M15）
- Strategyパターンの共通インターフェースに対する契約テスト（両バックエンドが同じ契約を満たすことを検証）（M16）
- initガード統一後のopfsWorkerメッセージハンドラの単体テスト（未初期化時にどの操作タイプでも同じエラーが返る）（M18）
- 共通化されたバッチ処理ループ関数の単体テスト（成功/失敗/進捗通知）（M19）

## 実装アプローチ
- **Outside-In**: 各対象について、まずリファクタリング前の既存挙動をテストで固定してから（テストがなければ先に書く）、内部実装を安全に置き換える
- **Red-Green-Refactor**: 「テスト追加→グリーン確認→リファクタリング→再度グリーン確認」のサイクルを各項目で回す
- **リファクタリング**: 本PBI自体がリファクタリングタスクのため、機能追加は行わず既存の振る舞いを保存することを最優先する

## 見積もり
8pt（4項目合算、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: M16（Strategyパターン抽出）はPBI-09（30カラムINSERT重複解消）と関連領域が重なる可能性があるため、実施順序を調整する（PBI-09を先に完了させてから着手するのが望ましい）
- テスタビリティ: リファクタリング系のため、既存テストのカバレッジが十分か事前に確認する
- 非機能要件: 振る舞いを変えないことが最重要のため、パフォーマンス特性（クエリ回数等）も変化させない

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
sed -n '735,760p;815,835p;945,965p' src/dashboard/dashboard.ts
grep -n "async function\|class" src/offscreen/sqlite.ts | head -20
grep -n "async function\|class" src/offscreen/opfsWorker.ts | head -20
sed -n '860,960p' src/offscreen/opfsWorker.ts
sed -n '110,175p' src/background/migrationService.ts
```

### 実装手順
1. **M15**: 3つのエクスポート関数の差分（フィルタ条件・見出し形式等）を洗い出し、共通関数に `options` パラメータとして切り出す
2. **M18**: opfsWorkerのメッセージハンドラで、switch文に入る直前に `if (!initialized) return errorResponse(...)` のような単一ガードを置き、各case内の重複チェックを削除する
3. **M19**: migrationServiceの各マイグレーションステップに共通するtry/catch＋進捗通知のパターンを、高階関数またはテンプレートメソッドとして抽出する
4. **M16**: sqlite.tsとopfsWorker.tsのCRUD操作（insert/query/update/delete）を比較し、共通インターフェース（型）を定義した上で、各バックエンドの実装をそのインターフェースに準拠させる（完全な統合が難しい場合は共通化できる部分のみ抽出し無理に統一しない）

### 落とし穴
- M16はバックエンド間でAPIの非同期処理方式（Web Worker経由 vs 直接呼び出し）が異なるため、無理に完全統一しようとすると却って複雑化する。共通化できる範囲を見極めること
- M15のパラメータ化は、既存の3つの関数が呼び出し元でどう使い分けられているか（UIのボタン等）を確認してから行う
- リファクタリング系のPBIは「テストが通れば完了」ではなく、実際にコード量・複雑度が削減されていることをコードレビューで確認する

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（M15: dashboard-handlers.test.ts、M16: schema-query-utils.test.ts、M18/M19: 実態調査で既存実装確認）
- [x] テストカバレッジが基準を満たす（単体テスト中心。全体スイート6964件通過）
- [ ] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（該当する場合）
