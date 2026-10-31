# PBI: raw-owned ストレージキー監査の完了

## ユーザーストーリー
保守担当者として、StorageKeys に生読み書きされるキーの分類監査がほしい、なぜなら分類漏れは次回マイグレーションでのデータ消失という実害に直結するから

## 優先度
- 順位: 5 / 9（全候補）
- RICEスコア: 3.2（Reach=1 / Impact=2 / Confidence=80% / Effort=0.5人週）
- 根拠: DESIGN_SPECIFICATIONS.md §5.1.1 が自認する open work であり、未完了のままではデータ消失のリスクが明文化された状態が続く。StorageKeys に生読み書きされるキー（chrome.storage.local を直接 get/set するキー）を追加した際に TOP_LEVEL_ONLY_KEYS への分類漏れがあると、次回の設定マイグレーション（migrateToSingleSettingsObject）でその所有モジュールの唯一のコピーが削除され、ユーザー状態が消える。RICE 同点（3.2）の DESIGN_SPECIFICATIONS 現行化と比べ、データ消失という実害を未然に防ぐリスク軽減効果で上位とした

## ビジネス価値
- 次回の設定マイグレーションで、生所有キー（暗号素材、プライバシー同意、Tranco 版、信頼DB など）が誤って削除されてユーザー状態が消える事故を未然に防ぐ
- 監査 pin テストが CI のガードとして常時動作し、以後に追加される生所有キーの分類漏れを自動検出できる
- 測定方法: 監査 pin テストが常時緑で、Red 側（未分類キーを足すと失敗する）が明示的に確認されていること。走査で抽出した生所有キー数と分類表の整合（分類漏れ 0 件）

## BDD受け入れシナリオ

```gherkin
Feature: raw-owned ストレージキーの分類監査

  Scenario: 監査で生所有キーの分類を完了する
    Given src/ 全体の chrome.storage.local 直接読み書き箇所の走査が済んでいる
    When 抽出した生所有キーを TOP_LEVEL_ONLY_KEYS に分類する
    Then 未分類の生所有キーが 0 件になり監査 pin テストが緑になる

  Scenario: 未分類の生所有キーは pin テストが失敗する
    Given 生読み書きする新しいキーが StorageKeys に存在する
    When そのキーを TOP_LEVEL_ONLY_KEYS に分類せずに監査 pin テストを実行する
    Then pin テストが失敗して分類漏れが検出される

  Scenario: マイグレーションで生所有キーが保護される
    Given 生所有キーが TOP_LEVEL_ONLY_KEYS に分類済みである
    When migrateToSingleSettingsObject を実行する
    Then 生所有キーの唯一のコピーは削除されず保持される
```

## 受け入れ基準
- [x] src/ 全体（テストは除外）で chrome.storage.local を直接読み書きする箇所の走査リストが完成している
- [x] 未分類の生所有キーが抽出され、TOP_LEVEL_ONLY_KEYS への分類が完了している（分類漏れ 0 件）
- [x] 監査 pin テストが実装され、生所有キーを StorageKeys に追加して分類漏れのままにした場合に失敗することが Red/Green で確認されている
- [x] pin テストは既存の manifest SSOT pin（src/__tests__/manifest.test.ts）・layer-direction pin（src/__tests__/tagcooccur-layer-direction.test.ts）と同じ作法で配置されている
- [x] 分類判定は名前パターンや substring テストではなく、所有モジュールが直接読み書きするかで行われている
- [x] settings_migrated ステートマシン（§5.1.2）との整合が確認されている

## テスト戦略

### E2Eテスト
- 実施しない。本 PBI はストレージキー分類の監査とガード整備であり、UI・マニフェストの変更を伴わない
- 既存の E2E スイートが引き続き緑であることのみ確認する

### 統合テスト
- マイグレーション経路で生所有キーが保護されることを検証する: migrateToSingleSettingsObject 実行後も生所有キーの値が保持され、削除されないこと
- settings_migrated ステートマシン（§5.1.2）の遷移前後で生所有キーが欠落しないことを確認する

### 単体テスト
- 分類関数（isMigratableStorageKey）の表駆動テスト
- 既存の分類済み契約表（§5.1.1）の 8 キーと、走査で新規に見つかったキーを表に含めて網羅する
- 似た名前でも直接読み書きしないキー（gemini_api_version のようなユーザー設定）が migratable のままであることを対比で確認する

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること:

```bash
grep -rn "chrome.storage.local" src/ --include="*.ts" | grep -v __tests__
grep -rn "TOP_LEVEL_ONLY_KEYS" src/
```

既存実装の状況: src/utils/storage/settingsMigration.ts には TOP_LEVEL_ONLY_KEYS と分類関数 isMigratableStorageKey が既に存在し、src/utils/storage/__tests__/settingsMigration-completion-state.test.ts に分類の単体テストがある。本 PBI はゼロからの新規実装ではなく、走査による網羅確認、§5.1.1 契約表と実装の差分確認、監査 pin の追加で監査を完了させる作業として着手すること。

### 実装手順
Outside-In 順（pin → 統合 → 単体 → 実装）の縦スライスで進める:
1. pin: 監査ガードテストを先に書き、未分類の生所有キーを StorageKeys に仮追加した状態で Red を確認する（manifest SSOT pin・layer-direction pin と同じ作法。配置は src/utils/storage/__tests__/ 配下の *-pin.test.ts に倣う）
2. 統合: マイグレーション経路のテストを追加し、生所有キーが保護される状態を定義する
3. 単体: 分類関数（isMigratableStorageKey）の表駆動テストを追加・拡充する
4. 実装: 走査で抽出した生所有キーを TOP_LEVEL_ONLY_KEYS に分類し、Green を確認する
5. 監査結果（走査リストと分類表）を DESIGN_SPECIFICATIONS.md §5.1.1 に反映し、open work を解消する

### 落とし穴
- 分類は名前パターンではなく「その所有モジュールが chrome.storage.local を直接読み書きするか」で判定する。substring テスト（key.includes のような分類）は §5.1.1 が明示的に禁止している。過去の `!key.includes('_version')` は gemini_api_version まで誤って除外した前例がある
- 分類漏れの実害は即時には現れない。TOP_LEVEL_ONLY_KEYS への追加漏れは次回の migrateToSingleSettingsObject 実行時に「所有モジュールの唯一のコピーの削除」として顕在化する
- 現行の分類済み契約表（§5.1.1）を起点に差分として扱うこと: encryption_salt / encryption_secret / hmac_secret / master_password_salt / master_password_hash（keyring storage/encryptionSession.ts）、privacy_consent_version（storage/privacyConsent.ts）、tranco_version（trustDb/trancoConsentManager.ts）、trust_db:json（trustDb/TrustDbKernel.ts）
- settings_migrated ステートマシン（§5.1.2）との整合を確認する。分類変更がマイグレーション済み判定の前提を壊さないこと

## 見積もり
1pt目安（0.5人週相当）

## Definition of Done
- [x] 監査結果（走査リストと分類表）が完成
- [x] pin テストが実装され Red/Green 確認済み
- [x] コードレビュー完了
- [x] ドキュメント更新済み
