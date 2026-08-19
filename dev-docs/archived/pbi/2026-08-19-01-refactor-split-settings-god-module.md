# PBI: Split the residual settings god module

## ユーザーストーリー
開発者として、`settingsStore.ts` が単一責任で構成されている状態がほしい。なぜなら循環依存のないモジュールにすることで、設定関連のバグ修正や暗号化ロジックの変更が局所的に完了し、テストが容易になるから。

## 優先度
- 順位: 01 / 05
- RICEスコア: 5.40（Reach=6 / Impact=2 / Confidence=90% / Effort=2 人週）
- 根拠: settings は全 Recording + Dashboard で読み書きされる最も頻度の高いモジュール。685 行に 6 つの懸念が混在し、循環依存（`settingsStore.ts` → `sqliteClient.ts` の動的インポート）が存在する。分割により Reach が最大で Effort も中程度。

## BDD受け入れシナリオ
Scenario: settingsStore が CRUD と暗号化だけを責務とする
  Given `settingsStore.ts` から `urlWhitelist.ts` と `settingsMigration.ts` を抽出した
  When 任意の設定を取得・保存する
  Then 循環依存が存在せず、`settingsStore.ts` の責務は「設定の読み書き・暗号化・メモリキャッシュ」に限定される

Scenario: 既存の getSettings / saveSettings が後方互換を維持する
  Given 既存の import 元が `getSettings()` と `saveSettings()` を利用している
  When モジュール分割後の `settingsStore.ts` をビルドする
  Then 既存の呼び出し元は変更なしで動作し、型エラーが発生しない

## 受け入れ基準
- [x] `settingsStore.ts` から `buildAllowedUrls`、`ALLOWED_AI_PROVIDER_DOMAINS`、`isDomainInWhitelist` を `urlWhitelist.ts` に抽出
- [x] `migrateToSingleSettingsObject`、`_applyMigrationsAndDecrypt`、`tryRestoreFromBackup`、`cleanupExpiredSettingsBackups` を `settingsMigration.ts` に抽出
- [x] `purgeLegacyStorage` および `getDefaultSqliteHealthCheck` などのクォータ管理・メンテナンスロジックを `storageMaintenance.ts` 等に抽出
- [x] 動的インポートしていた `SqliteClient` への依存を完全に除去
- [x] 抽出先モジュール (`urlWhitelist.ts` / `settingsMigration.ts` / `storageMaintenance.ts`) が `settingsStore.ts` を再 import して循環依存を作らないこと
- [x] 既存の `getSettings()` / `saveSettings()` / `saveSettingsWithAllowedUrls()` / `getAllowedUrls()` のシグネチャは変更しない
- [x] 既存テストが変更なしでパスする
- [x] `urlWhitelist.ts` は `src/utils/` 配下に配置し、`settingsStore.ts` 以外からも import 可能にする

## テスト戦略
- 単体: `settingsStore.test.ts`、`settingsMigration.test.ts`、`urlWhitelist.test.ts` の既存テストがパスすること
- 統合: モジュール分割後に `getSettings()` → `buildAllowedUrls()` の呼び出しチェーンが正常に動作することを確認
- E2E: 設定画面で AI プロバイダー URL を追加→保存→再起動後も維持されること

## リスクと留意事項
- 抽出した `settingsMigration.ts` が `savedUrlStore.ts` の移行処理と再び結合しないよう、責務を「settings キーのみ」の移行に限定する
- `storageMaintenance.ts` は `settingsStore.ts` の save 処理から呼ばれるが、逆方向の import を避ける必要がある
- `urlWhitelist.ts` は `src/utils/storage/` ではなく `src/utils/` に置くことで、AI クライアントや fetch ガードからも利用可能にする

## 見積もり
2 ストーリーポイント（要チームでの見積もり）

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` のストレージセクションを更新）
- [x] `settingsStore.ts` が 350 行以下であること
