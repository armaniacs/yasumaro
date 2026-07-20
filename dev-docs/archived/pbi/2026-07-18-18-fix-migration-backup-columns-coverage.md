# PBI: IDB VFS移行バックアップのカラム網羅性を31カラムに拡張

## ユーザーストーリー
開発チームとして、wa-sqlite → @subframe7536 移行時のバックアップ処理が全カラムを保存してほしい、なぜなら現状は31カラム中12カラムしかSELECTしておらず、移行失敗時の復元で診断情報が失われるから

## ビジネス価値
- 移行失敗時のデータ復元における情報欠落を防ぐ
- 特にH4（修正済み）で対応された `convertFallbackRecord()` の31フィールド対応と一貫性を持たせる

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/offscreen/sqliteEngineContext.ts:32-35` — `MIGRATION_BACKUP_COLUMNS` 定数が12カラムのみ列挙: `url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced, gist_synced`
- 同ファイルで `import { ... buildInsertParams } from './schema.js'` されており、`schema.ts` に全カラムを定義する `COLUMN_NAMES` 相当の定数が存在する可能性が高い（要確認）
- 関連して既に修正済みのH4（`convertFallbackRecord()` を11→31フィールドに拡張）と同じ思想の対処

```bash
# 実装前の必須調査コマンド（全31カラムの正確なリストを取得）
grep -n "COLUMN_NAMES\|export const.*COLUMNS" src/offscreen/schema.ts
sed -n '1,50p' src/offscreen/schema.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: 移行前バックアップが全カラムを含む
  Given wa-sqlite形式のDBが存在し、移行処理をトリガーする
  When 移行前バックアップ（pre-migration backup）を実行する
  Then バックアップペイロードは31カラム全てを含む

Scenario: 移行失敗時の復元で診断カラムがNULLにならない
  Given 移行が失敗し、バックアップからの復元処理が実行される
  When 復元されたレコードを確認する
  Then 診断カラム（is_starred, is_deleted, obsidian_synced, gist_synced以外の残り19カラムも含む）に元の値が保持されている
```

## 受け入れ基準
- [ ] `MIGRATION_BACKUP_COLUMNS`（`src/offscreen/sqliteEngineContext.ts:32-35`）を全31カラム（`schema.ts` の `COLUMN_NAMES` 相当）に拡張
- [ ] バックアップ・復元のペイロード型（`MigrationBackupPayload` 等）が全カラムを扱えることを確認
- [ ] 既存の移行フロー（正常系）が引き続き動作する

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要（緊急時のみ実行される処理のため、統合テストで代替）

### 統合テスト
- 移行バックアップ→復元のラウンドトリップテストを追加し、全31カラムの値が保持されることを検証（既存のH4関連テストがあれば参考にする）

### 単体テスト
- `MIGRATION_BACKUP_COLUMNS` の定数値が `schema.ts` の全カラムリストと一致することを検証するテスト（定数の網羅性チェック）

## 実装アプローチ
- **Outside-In**: まず「バックアップ→復元後に全カラムの値が一致する」統合テストをRedで書き、`MIGRATION_BACKUP_COLUMNS` 拡張でGreenにする

## 見積もり
1pt（1〜2時間）

## 技術的考慮事項
- 依存関係: `schema.ts` の既存カラム定義との整合性
- テスタビリティ: バックアップ/復元ロジックは純粋な変換関数として切り出されていれば容易にテスト可能
- 非機能要件: パフォーマンス影響は軽微（side-effects.md M4判定で確認済み、緊急時のみ実行）

## 落とし穴
- カラム順序が `INSERT` 文のプレースホルダ順と一致している必要がある場合、単純にカラムを追加するだけでなく、対応する値の取得・デフォルト処理も合わせて実装すること（H4の `convertFallbackRecord()` 拡張時の実装パターンを参考にする）

## Definition of Done
- [ ] `MIGRATION_BACKUP_COLUMNS` が全31カラムに拡張されている
- [ ] バックアップ/復元ラウンドトリップの統合テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
