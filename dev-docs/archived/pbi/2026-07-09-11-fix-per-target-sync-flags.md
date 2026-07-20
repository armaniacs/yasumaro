# PBI: 同期ターゲットごとの独立した同期済みフラグ導入

## ユーザーストーリー
ユーザーとして、GistとObsidianの両方に同期する設定にしている場合、片方への同期が完了しても、もう片方への同期対象から除外されないようにしてほしい、なぜなら現在は共有の `obsidian_synced` カラムを使っているため、Gistが先にレコードを同期すると `obsidian_synced=1` が設定されてしまい、Obsidian側の同期フィルタで対象外となりレコードが永久に同期されなくなるから

## ビジネス価値
- 複数の同期ターゲット（Obsidian, Gist, 将来追加されるターゲット）を併用するユーザーのデータ欠落を防ぐ
- 同期状態の可観測性を高め、「どのターゲットに同期済みか」を正確に把握できるようにする

## 背景（レビュー指摘）
- 指摘者: Legacy Bridge Architect（[plans/2026-07-09-1633-review-feat-6_5.md](../plans/2026-07-09-1633-review-feat-6_5.md) High指摘4件目）
- 場所: `src/background/obsidianSyncService.ts:54`, `src/background/syncTargets/gistSyncTarget.ts:53`
- 現状: `ObsidianSyncService.sync()` と `GistSyncTarget.sync()` の両方が同じ `sqliteClient.update(logId, { obsidian_synced: 1 })` を呼び出し、`syncBatch()` の未同期フィルタも共通の `obsidian_synced` カラムを参照している。そのため片方が先に同期すると、もう片方の未同期判定から漏れる。
- 決定事項: 同期ターゲットごとに独立したカラム（例: `gist_synced`, `obsidian_synced`）を追加する。→ **スキーマ変更が必要** → この方針で変更する

## BDD受け入れシナリオ

```gherkin
Scenario: GistとObsidian両方が有効な場合、それぞれ独立に同期される
  Given ユーザーがGist同期とObsidian同期の両方を有効にしている
  And 未同期のログレコードが1件存在する
  When Gist同期バッチが先に実行されそのレコードをGistへ同期する
  Then そのレコードのgist_syncedが1になる
  And そのレコードのobsidian_syncedは0のままである
  When 続けてObsidian同期バッチが実行される
  Then そのレコードはObsidian未同期としてバッチ対象に含まれる
  And 同期が成功するとobsidian_syncedも1になる

Scenario: 既存の同期済みレコード（マイグレーション前データ）が正しく扱われる
  Given マイグレーション前のスキーマでobsidian_synced=1が設定された既存レコードがある
  When スキーマがgist_synced/obsidian_syncedの2カラムに移行される
  Then 既存レコードのobsidian_syncedの値は保持される
  And gist_syncedは未同期を示すデフォルト値（0）で初期化される

Scenario: 片方のターゲットのみ有効な場合は従来通り動作する
  Given ユーザーがObsidian同期のみを有効にしている
  When 未同期レコードに対しObsidian同期バッチが実行される
  Then obsidian_syncedカラムのみに基づいて対象レコードが選択され、同期後に1が設定される
```

## 受け入れ基準
- [ ] SQLiteスキーマに `gist_synced` カラムが追加され、マイグレーションが実装されている
- [ ] `GistSyncTarget.sync()` が `obsidian_synced` ではなく `gist_synced` を更新するよう修正されている
- [ ] `GistSyncTarget.syncBatch()` の未同期フィルタが `gist_synced` を参照するよう修正されている
- [ ] `ObsidianSyncService` は引き続き `obsidian_synced` カラムを使用し、変更の影響を受けない
- [ ] 既存データに対するマイグレーションで `gist_synced` カラムが妥当なデフォルト値（0）で追加される
- [ ] 30カラムINSERT重複解消PBI（[2026-07-09-09-fix-dedupe-insert-sql-columns.md](2026-07-09-09-fix-dedupe-insert-sql-columns.md)）のカラム定義にも新カラムが反映される（依存関係として明記）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードでGist同期とObsidian同期を両方有効化し、1件のログが両方に同期されることを確認するシナリオテスト（可能であれば）

### 統合テスト
- `ObsidianSyncService.syncBatch()` と `GistSyncTarget.syncBatch()` を同一のSQLiteインスタンスに対して順不同で実行し、両方が独立して全レコードを同期できることを確認
- マイグレーション実行後、既存レコードの `obsidian_synced` が保持され `gist_synced` がデフォルト値であることを確認

### 単体テスト
- `GistSyncTarget.sync()` が `gist_synced` を更新することの単体テスト
- `GistSyncTarget.syncBatch()` の未同期フィルタが `gist_synced` のみを見ることの単体テスト
- スキーマ・マイグレーションの単体テスト（新カラム追加、デフォルト値）

## 実装アプローチ
- **Outside-In**: 統合テスト（Gist/Obsidian同時運用シナリオ）を先に書き、現状の相互汚染バグが再現することを確認してから実装する
- **Red-Green-Refactor**: スキーマ変更→マイグレーション→GistSyncTarget修正の順にテストを固めながら進める
- **リファクタリング**: 将来的な同期ターゲット追加を見越し、`SyncTarget` インターフェースに同期フラグカラム名を持たせる設計を検討する（本PBIのスコープ内で無理に一般化しない）

## 見積もり
5pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 30カラムINSERT重複解消PBI（PBI-09）とカラム定義を共有する箇所が重なるため、実装順序の調整が必要（本PBIを先に実施しカラムを確定させてからPBI-09を実施する、または両者で同じスキーマ定義箇所を編集することを認識しておく）
- テスタビリティ: SQLiteのマイグレーション機構（既存の `migrationService.ts` 等）を利用
- 非機能要件: マイグレーションは既存データを破壊しないこと（ALTER TABLE ADD COLUMNで対応可能な想定）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -rn "obsidian_synced" src/
grep -rn "CREATE TABLE\|ALTER TABLE" src/offscreen/schema.ts 2>/dev/null src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts
grep -rn "class.*SyncTarget\|interface SyncTarget" src/background/syncTargets/
```
現在のマイグレーション実装パターン（`src/background/migrationService.ts` や `src/offscreen/` 内のバージョン管理）を確認し、新カラム追加の作法を踏襲すること。

### 実装手順
1. スキーマ定義（`schema.ts` 等）に `gist_synced INTEGER DEFAULT 0` カラムを追加する
2. 既存DBに対するマイグレーション（`ALTER TABLE logs ADD COLUMN gist_synced INTEGER DEFAULT 0`）を追加する
3. `GistSyncTarget.sync()` 内の `sqliteClient.update(logId, { obsidian_synced: 1 })` を `{ gist_synced: 1 }` に変更する
4. `GistSyncTarget.syncBatch()` の `result.rows.filter((r) => !r.obsidian_synced)` を `!r.gist_synced` に変更する
5. `SqliteClient.update()` および `query()` の型定義（Row型）に `gist_synced` を追加する
6. 30カラムINSERT重複解消（PBI-09）のタスクと連携し、共通INSERT定義にも反映する

### 落とし穴
- `sqliteClient.query()` の戻り値の型（Row型）に `gist_synced` を追加し忘れると、TypeScriptの型チェックは通っても実行時にフィールドが存在せず正しくフィルタできない可能性がある
- OPFS Worker側（`opfsWorker.ts`）でも同様のupdate/queryロジックが重複している可能性があるため、Gist同期がOPFSバックエンド経由でも動作するか確認すること
- マイグレーションのバージョン番号を既存のマイグレーション履歴と衝突しないよう採番すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（スキーマ変更をADRまたはDESIGN_SPECIFICATIONS.mdに記録）
