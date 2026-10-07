# PBI: trustChecker の alert 設定を SettingsRepository 経由に寄せ移行での消失を塞ぐ

## ユーザーストーリー

警告設定をダッシュボードで変更するユーザーとして、設定が settings 移行の後も生き残ってほしい。trustChecker が生 chrome.storage.local で移行対象キーの読み書きをしており、移行が生コピーを削除した後に既定値へ黙って戻るから。

## 優先度

- 順位: 4/17
- RICE: 8.0（R4 / I3 / C1.0 / E1.5）
- 根拠: DESIGN_SPECIFICATIONS §5.1.1 が名指しする open audit の実害（「Adding a raw-owned key to StorageKeys without classifying it here deletes user state on the next migration」）
- 依存: なし

## 背景（file:line 現状）

- 生読み: `src/utils/trustChecker.ts:69-74`（4 キーを生 get、inline `?? DEFAULT` フォールバック付き）/ 生書き: `:109-125`
- キーは移行対象: `ALERT_FINANCE` / `ALERT_SENSITIVE` / `ALERT_UNVERIFIED` / `SAVE_ABORTED_PAGES` は StorageKeys 値（`src/utils/storage/types.ts:142-145`）で TOP_LEVEL_ONLY_KEYS 未分類（`settingsMigration.ts:143-163`）
- 移行が生コピーを削除: `settingsMigration.ts:346`（remove）→ SW 起動時に `deferredMigrations.ts:11` が実行
- 消費者: `src/dashboard/settings/trustSettings.ts:410-411,465-466` / `src/background/pipeline/steps/checkTrustDomainStep.ts:23`（記録ごとに生読み）
- 影響: 移行後に TrustChecker の生 get は inline defaults のみ → ユーザーの警告トグルが黙ってリセット、次の dashboard 保存で blob と乖離した生キーを再作成

## BDD受け入れシナリオ

```gherkin
Scenario: 移行後も警告設定が生き残る
  Given ダッシュボードで alertFinance=false を保存済み
  When settings 移行が完了する
  Then TrustChecker は blob の値を読み既定 true に戻らない

Scenario: 警告設定の書き込みが blob に着地する
  Given trustChecker が SettingsRepository 経由になっている
  When saveAlertSettings を呼ぶ
  Then 生トップレベルキーを作らず blob 側の値を更新する
```

## 受け入れ基準

- [x] trustChecker の読み書きを SettingsRepository（getMany / set）経由に寄せる
- [x] 生 `chrome.storage.local.get/set` の 4 キー参照を削除
- [x] inline `?? DEFAULT` フォールバックを削除（DEFAULT_SETTINGS が唯一の既定源）
- [x] 既存の trustChecker / trustSettings テストを追従させる
- [x] 移行後も設定が生き残る往復テストを追加
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/utils/__tests__/trustChecker*`（配置は実在テストに追従）に移行往復ケース追加
- fixture 先行: 移行済みストレージで生読みが defaults に戻る現バグを再現してから直す
- 配置: `src/**/__tests__/`、fixture は `testDir/storageMock.ts` 再利用、実時間待ちは使わない

## 見積もり

1.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [x] 手動確認: 実ブラウザでの移行シナリオ（旧プロファイルからの upgrade）は開発環境に旧データがないため自動 pin のみで DoD とする

## 実装記録

- 変更ファイル: `src/utils/trustChecker.ts`（読み書きを SettingsRepository 経由に寄せ、getMany 結果は分割代入既定で型絞り）/ `src/utils/__tests__/trustChecker.test.ts`（移行往復テスト）
- ゲート: 対象 36 tests green / type-check PASS / lint PASS / validate PASS
