# PBI: パフォーマンス/アーキテクチャ中優先度指摘の解消（M7〜M14）

## ユーザーストーリー
開発者として、SQLite関連のOffscreen Document・複数クライアントインスタンス・デュアルライト方式・バッチ処理・大量データクエリが、スケーラビリティとモバイル環境の制約を考慮した設計になっていてほしい、なぜなら現状はボトルネックやリソース浪費、モバイルでの脆弱性、データ欠落リスクが複数箇所に存在するから

## ビジネス価値
- Offscreen Documentのボトルネック解消により、大量の同時操作でもレスポンス性が保たれる
- 単一SqliteClientインスタンスへの統一により保守性と一貫性を高める
- デュアルライト方式に終了条件を設けることで、いつまでも二重管理コストを払い続けることを防ぐ
- クエリ性能とモバイル環境での安定性を改善する

## 背景（レビュー指摘）
[plans/2026-07-09-1633-review-feat-6_5.md](../plans/2026-07-09-1633-review-feat-6_5.md) の「Medium パフォーマンス / アーキテクチャ」セクション（M7〜M14）を1つのPBIとして束ねる。

| # | 指摘 | 場所 | 対処方針 |
|---|------|------|---------|
| M7 | Offscreen documentが単一スレッドのボトルネック | `src/background/sqliteClient.ts:87` | 操作キュー導入または長時間操作に別Offscreen Documentを開く |
| M8 | 複数の独立SqliteClientインスタンスが散在 | `src/utils/auditLog.ts:18`, `src/background/reviewSummaryGenerator.ts:18` | 単一インスタンスをDIで注入する設計に変更 |
| M9 | デュアルライト方式に自動的な終了条件がない | `dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md` | `LEGACY_DUAL_WRITE_ENABLED`設定キーを追加して段階的に移行 |
| M10 | insertBatch: per-row SELECT changes()がO(n)余分クエリ | `src/offscreen/sqlite.ts:682-686` | COMMIT直後の1回に移動 |
| M11 | OPFS Worker handleInsertBatchに明示的トランザクションなし | `src/offscreen/opfsWorker.ts:503-561` | BEGIN/COMMITでループ全体をラップ |
| M12 | オフスクリーンドキュメント依存連鎖がモバイルで脆弱 | `src/background/sqliteClient.ts:55-80` | keepAliveメッセージ導入またはバッチ化 |
| M13 | クエリ結果が全行JSメモリにロードされる | `src/offscreen/sqlite.ts:794-828` | LIMIT強制上限またはストリーミングAPI |
| M14 | SQLite利用不可ウィンドウでのデータ欠落 | `src/background/pipeline/RecordingPipeline.ts:157-159` | 定期整合性チェックまたは保存保留メカニズム |

## BDD受け入れシナリオ

```gherkin
Scenario: 複数の記録操作が同時発生してもOffscreen Documentがブロックしない（M7）
  Given 複数の記録リクエストがほぼ同時に発生する
  When それぞれがSqliteClient経由でOffscreen Documentに処理を依頼する
  Then 操作はキューイングされ順次処理され、いずれかの操作でタイムアウトが起きない

Scenario: auditLogとreviewSummaryGeneratorが同一のSqliteClientインスタンスを利用する（M8）
  Given アプリケーションが起動している
  When auditLogとreviewSummaryGeneratorがそれぞれSQLite操作を行う
  Then 両者は同一のSqliteClientインスタンス（DIで注入されたもの）を参照している

Scenario: デュアルライトが設定キーで無効化できる（M9）
  Given LEGACY_DUAL_WRITE_ENABLED設定がfalseに設定される
  When 新しい閲覧履歴が記録される
  Then chrome.storageへの二重書き込みは行われずSQLiteのみに保存される

Scenario: insertBatchが変更件数を1回のクエリで取得する（M10）
  Given 10件のレコードをinsertBatchで保存する
  When 処理が完了する
  Then changes()相当のクエリはCOMMIT後に1回だけ実行される

Scenario: OPFS Workerのバッチ挿入がトランザクションで保護される（M11）
  Given OPFS Workerでhandleinsertbatchが10件のレコードを処理する
  When 処理の途中で例外が発生する
  Then 既に挿入された分もロールバックされ、部分的な挿入が残らない

Scenario: モバイル環境でOffscreen Documentが休止してもリクエストが失敗しない（M12）
  Given モバイル環境でOffscreen Documentがアイドル状態から復帰する必要がある
  When SQLite操作がリクエストされる
  Then keepAliveまたは再接続処理により操作が正常に完了する

Scenario: 大量データクエリがメモリを圧迫しない（M13）
  Given 10万件を超えるレコードが存在する
  When LIMIT指定なしでクエリが実行される
  Then 強制的な上限が適用され、全件が一度にメモリロードされない

Scenario: SQLite利用不可ウィンドウで記録が失われず後で復元される（M14）
  Given SQLiteが一時的に利用不可な状態でユーザーがページを閲覧する
  When SQLiteが復旧する
  Then 保留されていた記録が整合性チェックまたは保留メカニズムにより復元される
```

## 受け入れ基準
- [x] M7: Offscreen Documentへの操作が何らかのキューまたは並行制御機構を経由する（2026-07-12実装: 既存の`Mutex`クラスを`SqliteClient.msgOffscreen()`に適用し、Offscreen Documentへのリクエストを直列化。単体テスト1件追加）
- [x] M8: `auditLog.ts` と `reviewSummaryGenerator.ts` がmodule-levelでSqliteClient/AIClientを生成せず、DI経由で受け取る設計に変更されている（2026-07-12実装: `sqliteClient.ts`に`getSharedSqliteClient()`シングルトンファクトリを新設。`service-worker.ts`/`auditLog.ts`/`reviewSummaryGenerator.ts`の3箇所の独立インスタンス生成を共有インスタンス参照に統一。単体テスト2件追加、既存モック2件を更新）
- [x] M9: `LEGACY_DUAL_WRITE_ENABLED` 設定キーが追加され、falseの場合chrome.storageへの二重書き込みがスキップされる（2026-07-12実装済み、コミット92dea19）
- [x] M10: `sqlite.ts` のinsertBatchがper-rowでSELECT changes()を呼ばず、COMMIT後の1回のみに変更されている（2026-07-11実態調査で確認、実体はopfsWorker.ts側）
- [x] M11: `opfsWorker.ts` のhandleInsertBatchがBEGIN/COMMITで明示的にラップされている（2026-07-11実態調査で確認）
- [x] M12: Offscreen Documentへの依存呼び出しにkeepAliveまたはバッチ化の仕組みが導入されている（2026-07-12実装: `SqliteClient.msgOffscreen()`に1回の自動リトライを追加。接続エラー時に`offscreenAlive`をリセットしてDocumentを再作成後、再送信。単体テスト2件追加。モバイル実機での休止/復帰検証は自動テスト対象外）
- [x] M13: クエリ結果取得にLIMIT強制上限が適用される（2026-07-12実装: `MAX_QUERY_LIMIT=100000`を新設し`query()`/`search()`/`queryAuditLog()`で`Math.min()`によりクランプ。単体テスト3件追加）
- [x] M14: SQLite利用不可期間のデータ欠落に対する整合性チェックまたは保留メカニズムが実装されている（2026-07-12実装: `src/background/pendingSqliteQueue.ts`を新設。`saveSqliteStep`のinsert失敗時にレコードを`chrome.storage.local`へ保留し、Service Worker起動時（`handleStartup`）に自動再試行。単体テスト6件追加）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 大量データ投入後のダッシュボード表示がタイムアウトせず完了するシナリオテスト（M7, M13）

### 統合テスト
- 複数の同時insert/insertBatchリクエストがキューイングされ全て成功することの統合テスト（M7）
- `LEGACY_DUAL_WRITE_ENABLED=false` 時にchrome.storageへの書き込みが発生しないことの統合テスト（M9）
- insertBatch中に例外を注入し、OPFS Worker側でロールバックされることの統合テスト（M11）
- SQLite利用不可→復旧のシナリオで保留データが復元されることの統合テスト（M14）

### 単体テスト
- `auditLog.ts`, `reviewSummaryGenerator.ts` がDI経由でSqliteClientを受け取ることの単体テスト（M8）
- insertBatchのchanges()呼び出し回数を検証する単体テスト（M10）
- LIMIT強制上限のクエリビルダーの単体テスト（M13）

## 実装アプローチ
- **Outside-In**: 各項目のうち影響範囲の大きいM7/M8/M9を先に統合テストから着手し、M10〜M14は既存テストの回帰を担保しながら個別に対応する
- **Red-Green-Refactor**: 各項目は独立性が高いため、担当を分けて並行実装しても良い（ファイルの重なりに注意: M10とM11は近い行のため同時編集時は調整）
- **リファクタリング**: DI導入（M8）はアーキテクチャ変更を伴うため、既存のテストダブル注入パターンと整合させる

## 見積もり
13pt（8項目合算、要チームでの見積もり。規模が大きい場合はM7/M8/M9（アーキテクチャ変更）とM10-M14（局所修正）で2つのPBIに分割することも検討）

## 技術的考慮事項
- 依存関係: M9はADR（`dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md`）に記載の設計方針を確認してから実施すること
- テスタビリティ: Offscreen Document間の通信はメッセージパッシングのモックが必要
- 非機能要件: M12はモバイル固有の挙動のため実機またはモバイルエミュレーションでの検証が望ましい（自動テストでは限界がある旨をDoDに明記）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
sed -n '1,120p' src/background/sqliteClient.ts
grep -n "new SqliteClient\|new AIClient" src/utils/auditLog.ts src/background/reviewSummaryGenerator.ts
cat dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md
sed -n '670,700p' src/offscreen/sqlite.ts
sed -n '495,565p' src/offscreen/opfsWorker.ts
sed -n '150,165p' src/background/pipeline/RecordingPipeline.ts
```

### 実装手順
1. M9（設定キー追加）から着手する：`StorageKeys` に `LEGACY_DUAL_WRITE_ENABLED` を追加し、デュアルライト箇所の条件分岐に組み込む
2. M10: `sqlite.ts` のinsertBatchループ内の `SELECT changes()` 呼び出しを削除し、COMMIT直後に1回だけ呼び出すよう修正する
3. M11: `opfsWorker.ts` のhandleInsertBatchをBEGIN/COMMITで囲む
4. M8: `auditLog.ts`, `reviewSummaryGenerator.ts` のmodule-levelインスタンス生成を関数引数またはコンストラクタ注入に変更する
5. M13: クエリ実行箇所にデフォルトLIMIT（例: 1000件）を強制適用する
6. M7, M12, M14はアーキテクチャレベルの変更のため、既存のOffscreen Document通信パターン（`chrome.runtime.sendMessage`等）を調査した上で設計を固めてから実装する

### 落とし穴
- M10とM11は同じファイル群の近い行を触るため、実装順序と担当を明確にしないとマージコンフリクトが起きやすい
- M8のDI化は呼び出し元が多岐にわたる可能性があるため、影響範囲を`grep`で事前に洗い出すこと
- M7/M12/M14は設計変更を伴うため、実装前にチームでアプローチを合意すること（本PBIでは方向性のみ記載し、詳細設計は着手時に確定する）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（M12のモバイル実機検証は自動テスト対象外として明記のとおり除外。他は単体テストで担保）
- [x] テストカバレッジが基準を満たす（単体テスト: sqliteClient-shared-instance, sqliteClient-queue, sqliteClient-keepalive, pendingSqliteQueue, lifecycleHandlers-pendingQueue, sqlite-query-limit-cap。全体スイート6969件通過）
- [ ] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [ ] ADR更新済み（M9のデュアルライト終了条件について。ADR自体は別セッションのM9実装コミットで対応済みか要確認）
