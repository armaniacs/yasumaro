# PBI: ガバナンス/サプライチェーン/API中優先度指摘の解消（M27〜M33）

## ユーザーストーリー
開発者として、依存ライブラリのサプライチェーンリスクが管理され、バイナリデータの転送効率・エラー報告・データ整合性設定・キャッシュ戦略が適切であってほしい、なぜならこれらは長期的な保守性とセキュリティ・パフォーマンスの安定性に関わるから

## ビジネス価値
- サプライチェーンリスクの可視化により将来の脆弱性混入を早期発見できる
- Base64エンコード化によりバイナリデータ転送の効率が改善する
- エラー報告の粒度向上によりデバッグが容易になる
- WALモード設定順序・LRUキャッシュ化によりデータ整合性とパフォーマンスの安定性が向上する

## 背景（レビュー指摘）
[plans/2026-07-09-1633-review-feat-6_5.md](../plans/2026-07-09-1633-review-feat-6_5.md) の「Medium ガバナンス / サプライチェーン / API」セクション（M27〜M33）を1つのPBIとして束ねる。

| # | 指摘 | 場所 | 対処方針 |
|---|------|------|---------|
| M27 | `@subframe7536/sqlite-wasm`のサプライチェーンリスク評価不足 | `package.json:70` | バージョンピン留め、ソースコードレビュー、CIにnpm audit定期実行 |
| M28 | `htmlparser2` overrideの影響範囲が不明 | `package.json:75` | override理由をコメントまたはADRとして記録 |
| M29 | `backup_db`のUint8Array→number[]変換が非効率 | `src/background/handlers/dashboardSqliteHandlers.ts:234-240` | Base64エンコードに変更 |
| M30 | SyncTargetのエラー報告粒度が不足 | `src/background/syncTargets/SyncTarget.ts`, `gistSyncTarget.ts:56-62` | エラー文字列を戻り値に含める |
| M31 | コンテンツパネルの最大幅制限がデータパネルに不適切 | `entrypoints/options/dashboard.css:348` | データ集約パネルに個別`max-width`を設定 |
| M32 | WALモード設定が初期化の後半に配置 | `src/offscreen/sqlite.ts:327-328` | `PRAGMA journal_mode=WAL`をスキーマ実行の直前に移動 |
| M33 | プリペアドステートメントキャッシュ退避戦略がFIFO | `src/offscreen/sqlite.ts:443-450` | LRU実装に置き換え |

## BDD受け入れシナリオ

```gherkin
Scenario: 主要な依存ライブラリのバージョンが固定されCIで定期監査される（M27）
  Given package.jsonで@subframe7536/sqlite-wasmのバージョンが範囲指定ではなく固定されている
  When CIパイプラインが定期実行される
  Then npm auditが実行され既知の脆弱性があれば検出される

Scenario: package.jsonのoverride理由が追跡可能である（M28）
  Given package.jsonにhtmlparser2のoverrideが設定されている
  When 開発者がこのoverrideの理由を知りたい場合
  Then コメントまたは関連ADRを参照して理由が分かる

Scenario: バックアップDBデータがBase64で効率的に転送される（M29）
  Given backup_dbハンドラがSQLiteデータベースのバイナリを扱う
  When バックアップが実行される
  Then Uint8Array→number[]変換ではなくBase64エンコードで転送される
  And 変換前後でデータの完全性が保たれる

Scenario: 同期失敗時に具体的なエラー内容が報告される（M30）
  Given GistSyncTargetの同期処理が何らかの理由で失敗する
  When syncBatch()の結果を確認する
  Then 単なる成功/失敗ではなく、失敗理由を示すエラー文字列が戻り値に含まれる

Scenario: データ集約パネルが適切な幅で表示される（M31）
  Given ダッシュボードのデータ集約パネルを表示する
  When 画面幅が十分にある場合
  Then コンテンツパネル向けの制限ではなく、データパネルに適した個別のmax-widthが適用される

Scenario: WALモードがスキーマ実行前に有効化される（M32）
  Given SQLiteデータベースが初期化される
  When PRAGMA journal_mode=WALの設定タイミングを確認する
  Then スキーマ実行の直前に設定されており、初期化の後半で设定されることによる意図しない挙動が発生しない

Scenario: プリペアドステートメントキャッシュがLRUで退避される（M33）
  Given プリペアドステートメントキャッシュが上限に達している
  When 新しいクエリパターンのステートメントがキャッシュされる
  Then 最も長く使われていないステートメント（LRU）が退避され、頻繁に使われるステートメントはFIFOのように単純な古さだけで退避されない
```

## 受け入れ基準
- [ ] M27: `@subframe7536/sqlite-wasm`のバージョンがpackage.jsonで固定され、CIにnpm auditの定期実行が追加されている（未実装: キャレット指定のまま、npm audit定期実行なし）
- [x] M28: `htmlparser2`のoverride理由がpackage.jsonのコメントまたはADRとして記録されている（2026-07-11実態調査で確認、専用チェックスクリプトも整備済み）
- [x] M29: `dashboardSqliteHandlers.ts:234-240`のバイナリ変換がBase64エンコードに変更されている（2026-07-11実態調査で確認）
- [x] M30: `SyncTarget`インターフェースの戻り値にエラー詳細を含む型が定義され、`gistSyncTarget.ts`がそれを実装している（2026-07-11実態調査で確認）
- [ ] M31: `dashboard.css:348`のmax-width制限がデータ集約パネル専用のクラス/セレクタで個別設定されている（未実装: 共通.panelクラスのまま）
- [x] M32: `sqlite.ts:327-328`のWALモード設定がスキーマ実行の直前に移動されている（2026-07-11実態調査で確認）
- [ ] M33: `sqlite.ts:443-450`のプリペアドステートメントキャッシュがLRU戦略に置き換えられている（未実装: FIFO evictionのまま）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- （本PBIの項目は主に内部実装・設定変更のためE2E対象は限定的。M31のみダッシュボード表示確認をE2Eで行う）

### 統合テスト
- バックアップのエクスポート→インポートを通しで実行し、Base64化後もデータの完全性が保たれることを確認（M29）
- GistSyncTarget.syncBatch()を意図的に失敗させ、エラー詳細が戻り値に含まれることを確認（M30）
- SQLite初期化順序を変更後、既存のCRUD統合テストが引き続きパスすることを確認（M32）

### 単体テスト
- Base64エンコード/デコード関数の単体テスト（往復変換の正確性）（M29）
- SyncTargetのエラー型の単体テスト（M30）
- LRUキャッシュ実装の単体テスト（アクセス順序に応じた退避動作）（M33）

## 実装アプローチ
- **Outside-In**: M29, M30, M33はロジック変更のため単体テストから着手する。M27, M28, M31, M32は設定変更のため既存テストの回帰確認を主軸とする
- **Red-Green-Refactor**: 各項目は独立性が高いため個別に進める
- **リファクタリング**: M33のLRU実装は既存のFIFOキャッシュ構造を段階的に置き換える

## 見積もり
8pt（7項目合算、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: M32はPBI-09（30カラムINSERT重複解消）と同じファイル（`sqlite.ts`）の初期化順序に触れるため、実施順序を調整する
- テスタビリティ: M27はCI設定変更のため自動テストというよりCIワークフローの検証が中心
- 非機能要件: M33のLRU実装はメモリオーバーヘッドを増やしすぎないシンプルな実装（例: Map+アクセス時に再挿入）を選ぶ

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "subframe7536\|htmlparser2" package.json
grep -n "npm audit" .github/workflows/*.yml
sed -n '225,245p' src/background/handlers/dashboardSqliteHandlers.ts
cat src/background/syncTargets/SyncTarget.ts
sed -n '340,355p' entrypoints/options/dashboard.css
sed -n '320,335p' src/offscreen/sqlite.ts
sed -n '435,455p' src/offscreen/sqlite.ts
```

### 実装手順
1. M27: package.jsonの`@subframe7536/sqlite-wasm`をキャレット/チルダ範囲指定からピン留め（完全一致）に変更し、`.github/workflows/`に`npm audit`ステップがなければ追加する
2. M28: package.jsonの`overrides`セクション近くにコメントを追加、または`dev-docs/ADR/`に理由を記載したADRを作成する
3. M29: `dashboardSqliteHandlers.ts`のUint8Array→number[]変換箇所を、既存の`encryptedBackupService.ts`にある`bytesToBase64`/`base64ToBytes`相当の関数を再利用してBase64化する
4. M30: `SyncTarget`インターフェースの`sync()`/`syncBatch()`戻り値型に`error?: string`フィールドを追加し、`gistSyncTarget.ts`の失敗パスで具体的なエラーメッセージを設定する
5. M31: dashboard.cssのデータ集約パネル用に新しいクラス（例: `.data-panel`）を追加し、既存の共通`max-width`から分離する
6. M32: `sqlite.ts`の`PRAGMA journal_mode=WAL`実行をスキーマ実行（CREATE TABLE等）の直前に移動する
7. M33: 既存のプリペアドステートメントキャッシュをLRU（`Map`のアクセス時再挿入、または既存ライブラリ利用）に置き換える

### 落とし穴
- M29のBase64化は`encryptedBackupService.ts`に既に`bytesToBase64`/`base64ToBytes`が存在するため、重複実装せず共通ユーティリティとして抽出することを検討する
- M32はWALモード設定タイミングの変更が既存のマイグレーション処理と干渉しないか、既存の初期化フローを十分に確認してから行う
- M33のLRU実装変更時、既存のキャッシュヒット率を計測するテストがあれば継続して利用し、劣化していないことを確認する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（package.jsonのoverrideコメント、ADR等）
