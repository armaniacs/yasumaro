# PBI: 死コード除去（migration.ts / storage.ts shim / trancoConsent chain / inMemoryTransport 移動）

種別: refactor
状態: 実装済み（2026-09-28）

上流: 大局的コードレビュー 2026-09-28 テーマ3。本番から参照されないコードが grep の信頼性と重複排除の判断を曇らせている。

## ユーザーストーリー

コードベースを grep して正本を探す開発者として、死んだモジュールに誘導されず、正本だけがヒットする状態を目指す。

## 優先度

- 順位: 2 / 7
- RICE スコア: 24.0（Reach=8 / Impact=1.5 / Confidence=100% / Effort=0.5）
- 根拠: 候補1と同点だが、実害修正を優先して順位2。削除自体は機械的で確実。後続 PBI の調査精度が上がるため早めに消化する

## 現状と問題（file:line 証拠付き）

- `src/utils/migration.ts`（338行）: 全 export（`migrateToLightweightFormat` / `migrateUblockSettings` / `restoreFromMigrationBackup` / `initializeTrancoVersion` / `migrateJpLayoutDefault` / `migrateCategoryBDefault` / `migrateWhitelistExtractionDefault`）の本番 import がゼロ。参照は自身の `__tests__` のみ
- `src/utils/storage.ts`（150行の retired shim）: 本番 import ゼロ。唯一の利用者 `src/utils/trustDb/trancoConsentManager.ts:119,133,151`（`await import('../storage.js')`）自体も本番 import ゼロ（`settingsMigration.ts:148` の言及はコメントのみ）。「shim を消せない理由」は事実と乖離している
- `src/background/inMemoryTransport.ts`: 本番参照ゼロ（参照は `src/background/__tests__/inMemoryTransport.test.ts` のみ）。`dev-docs/TEST_DOUBLES_DIVERGENCE.md:19` が乖離を文書化している
- `eslint.config.js:57-69,135` の `no-restricted-imports` が `storage.js` を禁止しており、削除時はルールも合わせて整理する必要がある

## BDD 受け入れシナリオ

```gherkin
Scenario: 死コードが存在しない
  Given 上記4ファイルを削除（または testDir へ移動）する
  When リポジトリ全体で `rg 'utils/migration\.js|utils/storage\.js|inMemoryTransport|trancoConsentManager'` を実行する
  Then 本番コードのヒットがゼロである

Scenario: 禁止ルールと文書が同期する
  Given ファイルを削除・移動する
  When `npm run lint` と関連テストを実行する
  Then eslint.config.js の禁止エントリが整理され、TEST_DOUBLES_DIVERGENCE.md の記述が現状と一致する
```

## 受け入れ基準

- [x] `src/utils/migration.ts` を削除する（`__tests__` も同時に削除する）
- [x] `src/utils/storage.ts` を削除し、`eslint.config.js` の対応する禁止エントリを削除する
- [x] `src/utils/trustDb/trancoConsentManager.ts` を削除する（`trancoVersionTracker.ts:12` の型参照も同時に解消する）
- [x] `src/background/inMemoryTransport.ts` とそのテストを `testDir/fakes/` へ移動し、`TEST_DOUBLES_DIVERGENCE.md` のパス記述を更新する
- [x] CHANGELOG・blogs・既存アーカイブ PBI 内の歴史的言及は変更しない（履歴は残す）

## テスト戦略

- 単体: 削除対象のテストファイルも同時に削除する。残存テスト全体が green であること
- 検証: `npm run validate` + 上記 BDD の `rg` による不存在確認

## 見積もり

0.5 SP

## Definition of Done

- [x] BDD シナリオに対応する確認が通る
- [x] `npm run validate` が通る
- [x] `00-INDEX.md` の関連記述（shim 残置の理由など）があれば更新する
