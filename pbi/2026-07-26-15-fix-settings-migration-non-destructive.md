# PBI: migrateToSingleSettingsObjectの即時削除を遅延削除・バックアップ付きに変更する

**作成日**: 2026-07-26
**優先度**: High
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（設定マイグレーションのロジック変更。既存ユーザーの設定復旧経路に関わるため慎重な検証が必須）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Legacy Bridge Architect からの High指摘。`src/utils/storage/settingsStore.ts`（現状 `migrateToSingleSettingsObject()`、155行付近）は、旧per-key形式のストレージを単一 `settings` オブジェクトに移行後、per-key群を**即座に完全削除**する。これにより拡張機能のダウングレード（旧バージョンへのロールバック）が不可能になり、`settings` オブジェクト破損時に全設定が復旧不能になる。

**2026-07-26時点の再調査で、この指摘は現在も有効であることを確認した。** `settingsStore.ts:155-201`（現状の行番号は前後する可能性あり）を確認したところ、マイグレーション完了フラグ設定（`SETTINGS_MIGRATED_KEY`）の直後に `chrome.storage.local.remove(keysToRemove)` が実行されており、遅延削除やバックアップの仕組みは実装されていない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "migrateToSingleSettingsObject\|keysToRemove\|chrome.storage.local.remove" src/utils/storage/settingsStore.ts
```

per-keyの削除タイミングと、`settings` オブジェクト破損時の既存のリカバリ手段（あれば）を確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: マイグレーション後もper-keyデータがバックアップとして一定期間保持される
  Given migrateToSingleSettingsObject() が実行され settings オブジェクトへの統合が完了する
  When per-keyデータの削除タイミングを確認する
  Then per-keyデータは即座に削除されず、バックアップキー（例: legacy_settings_backup）として一定期間（例: 30日）保持される

Scenario: settingsオブジェクトが破損した場合バックアップから復旧できる
  Given settingsオブジェクトが破損している（不正なJSON、必須キー欠落等）
  When getSettings() が呼ばれる
  Then バックアップキーから設定を復元し、ユーザーの設定が失われない

Scenario: 保持期間経過後にバックアップが削除される
  Given バックアップが30日以上前に作成されている
  When 定期クリーンアップ処理が実行される
  Then バックアップキーが削除される

Scenario: 既存のマイグレーションフローが回帰しない
  Given 変更後のmigrateToSingleSettingsObject()
  When 既存のsettingsStore関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `migrateToSingleSettingsObject()` の即時 `chrome.storage.local.remove(keysToRemove)` を、バックアップキーへの退避に変更する
- [ ] `settings` オブジェクトの整合性チェック（破損検出）と、破損時にバックアップから復元するロジックを `getSettings()` に追加する
- [ ] バックアップの保持期間（例: 30日）を設定し、期間経過後に削除する定期クリーンアップ処理を追加する
- [ ] 既存の `settingsStore` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- マイグレーション後、per-keyデータが即座に削除されずバックアップキーに退避されることを確認
- `settings` オブジェクトを意図的に破損させた状態から `getSettings()` を呼び、バックアップから復元されることを確認
- バックアップの保持期間経過後、クリーンアップで削除されることを確認

### 統合テスト
- マイグレーション全体のフロー（旧形式→統合→バックアップ保持→期間経過後削除）を通しで確認

## 実装アプローチ

1. `migrateToSingleSettingsObject()` の削除処理を、バックアップキー（例: `legacy_settings_backup_<timestamp>`）への退避に変更
2. `getSettings()` に `settings` オブジェクトの整合性チェックとバックアップからの復元ロジックを追加
3. 定期クリーンアップ（既存の `dailyPurgeHandler.ts` 等と統合するか新規アラームを追加）でバックアップの保持期限を管理
4. テスト追加

## 見積もり

3pt以上（削除→バックアップ化 + 復元ロジック + 定期クリーンアップ + 回帰テスト）

## 技術的考慮事項
- 依存関係: `src/utils/storage/settingsStore.ts`, `src/background/dailyPurgeHandler.ts`（クリーンアップ統合の可能性）
- テスタビリティ: `chrome.storage.local` のモックでマイグレーション・復元・クリーンアップをテスト可能
- 非機能要件: データ整合性、後方互換性（ダウングレード耐性）

## Definition of Done
- [ ] per-keyデータがバックアップとして一定期間保持される
- [ ] 破損時のバックアップからの復元ロジックが実装されている
- [ ] 保持期間経過後の定期クリーンアップが実装されている
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Legacy Bridge Architect指摘、High）
- 対象コード: `src/utils/storage/settingsStore.ts:155-201`
