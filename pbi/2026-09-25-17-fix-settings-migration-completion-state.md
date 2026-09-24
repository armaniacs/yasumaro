# PBI: 設定移行の完了状態とバージョンキー除外の修正

種別: fix

## ユーザーストーリー

初回起動時の設定移行が途中で Service Worker 終了したユーザーとして、途中まで進んだ移行が次回起動時に再開され、設定が欠落したまま移行済みとして扱われる状態をなくしたい。同時に、Gemini API バージョンを含む通常の設定を管理画面から変更できるようにしたい。

## ビジネス価値

- 初回起動時の中断によって既存設定が欠落するのを防ぎ、設定の信頼できる移行を保証する。
- `GEMINI_API_VERSION` を通常の設定として保持し、Gemini provider のバージョン設定を変更可能にする。
- migration の中断、再開、競合を自動テストで再現し、ストレージ障害時のデータ保護を検証可能にする。
- 移行状態と CAS version を明確に分離し、ストレージの読み書き契約の誤用を防ぐ。

## 優先度

順位: 17 / 30
RICEスコア: 1.2（Reach=1 / Impact=3 / Confidence=80% / Effort=2 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 正常な設定移行を完了する
  Given 未移行の通常設定がトップレベルに存在する
  And GEMINI_API_VERSION に通常の設定値が設定されている
  And TRANCO_VERSION と PRIVACY_CONSENT_VERSION がトップレベルに存在する
  When 設定移行を実行する
  Then settings_migrated が completed になる
  And GEMINI_API_VERSION が nested settings に保存される
  And TRANCO_VERSION と PRIVACY_CONSENT_VERSION がトップレベルに残る
  And 確認済みのバックアップが存在する
  And 移行対象の legacy key が削除される

Scenario: nested settings への書き込み後に中断しても再実行する
  Given settings_migrated が pending である
  And nested settings の一部だけが保存されている
  And バックアップがまだ確認されていない
  When バックアップ作成が失敗する
  Then settings_migrated は completed にならない
  And 移行対象の legacy key は削除されない
  When バックアップ作成が成功して設定移行を再実行する
  Then 既存の nested settings を上書きせず不足分だけ補完される
  And 確認済みのバックアップを作成してから legacy key を削除する
  And settings_migrated が completed になる

Scenario: バックアップ確認後に中断した移行を再開する
  Given settings_migrated が backed_up である
  And tryRestoreFromBackup が認識する有効なバックアップが存在する
  And 一部の legacy key だけが削除されている
  When 設定移行を再実行する
  Then 残存する移行対象 key を削除する
  And settings_migrated を completed に更新する

Scenario: legacy key 削除後に中断した移行を完了する
  Given settings_migrated が legacy_removed である
  And 移行対象の legacy key が不存在である
  And 有効なバックアップが存在する
  When 設定移行を再実行する
  Then nested settings を上書きしない
  And settings_migrated が completed になる

Scenario: 旧形式の完了フラグだけが残る途中移行を修復する
  Given settings_migrated が boolean true である
  And nested settings の一部だけが保存されている
  And raw の通常設定がトップレベルに残っている
  When 設定移行を修復実行する
  Then 既存の nested settings を優先して保持する
  And 不足した設定だけを raw または有効なバックアップから補完する
  And バックアップを確認してから raw の移行対象 key を削除する
  And settings_migrated を completed に更新する

Scenario: 削除直前の legacy key 更新を削除せず移行する
  Given 移行対象の legacy key を取得済みである
  And バックアップ作成後に同じ legacy key が更新される
  When 移行対象を削除する段階へ進む
  Then 削除直前に値と CAS の世代を再取得する
  And 更新後の値を nested settings に反映してバックアップを更新する
  And 更新された legacy key を古いスナップショットとして削除しない

Scenario: 完了済み移行を変更せず再実行する
  Given settings_migrated が completed である
  And nested settings と必要なバックアップが存在する
  When 次回の設定移行判定を行う
  Then 設定移行をスキップする
  And nested settings を上書きしない
```

## 受け入れ基準

- [ ] `settings_migrated`、`settings`、`legacy_settings_backup_*` のストレージキー名を変更しない。
- [ ] `settings_migrated` に `pending`、`backed_up`、`legacy_removed`、`completed` の明示的な段階を保存できるようにする。
- [ ] 完了判定は truthy 判定ではなく `completed` との完全一致で行い、boolean `true` は未確認の旧形式として修復対象にする。
- [ ] `settings` への書き込み、有効なバックアップの確認、移行対象 legacy key の削除、`completed` の記録をこの順進め、前の段階で失敗した場合は完了にしない。
- [ ] 各段階から再実行でき、部分的な legacy key 削除や中断後の再実行でも結果を損なわない。
- [ ] `GEMINI_API_VERSION` は nested settings に移す。`TRANCO_VERSION` と `PRIVACY_CONSENT_VERSION` はトップレベルに留める。
- [ ] `${key}_version` は CAS version として扱い、schema version や `settings_migrated` と混同しない。
- [ ] キーの除外は部分一致ではなく、明示的な許可リストで判定する。
- [ ] 削除直前に移行対象を再取得し、値または CAS 世代が変化している場合は削除せず、最新値を delta 書き込みとバックアップへ反映してから再試行する。
- [ ] `settings` の full snapshot を `setAll()` に渡さず、差分だけを変更する。
- [ ] migration 状態を Service Worker の module state に保持せず、`StoragePort` 経由で永続化する。
- [ ] `SettingsRepository` は未完了段階を完了扱いせず、既存の設定読み出しと backup 復元契約を維持する。
- [ ] production の直接 migration call は引き続き deferred migration 経路から1回だけ実行される。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 未移行のストレージから deferred migration を実行し、Gemini API バージョンを含む設定の読み出しと保存までを確認する。
- migration 完了後に次回の起動を再現し、設定再実行なく同じ設定が読み出せることを確認する。
- `GEMINI_API_VERSION` の設定変更が Gemini provider の読み出し値へ反映される最小垂直スライスを確認する。

### 統合テスト

- `storage-locking.test.ts` に、nested settings 書き込み後、バックアップ作成後、legacy key 削除後、完了記録前の各中断地点からの再開を追加する。
- `settingsStore-backup.test.ts` との整合を確認し、修復中に使用するバックアップを `tryRestoreFromBackup()` が認識できること、`settings_version` を CAS state として保持することを確認する。
- `deferredMigrations.test.ts` で、未完了状態から再開でき、同一起動で直接 migration が1回だけ実行される契約を維持する。
- `SettingsRepository.test.ts` と `settingsRepository-migration-parity.test.ts` で、migration 判定、全設定の読み出し、backup 復元、通常設定と top-level state の分離を確認する。
- `privacyConsent-version.test.ts` と `trancoVersionTracker.test.ts` で、`PRIVACY_CONSENT_VERSION` と `TRANCO_VERSION` の値が移行前後で変わらないことを確認する。
- raw key の追加と更新をバックアップ作成後、削除前に发生后、最新値を保持したまま完了する競合テストを追加する。
- 復号経路の既存契約と競合しないよう、暗号化 secret を含む設定の移行テストを維持する。

### 単体テスト

- `pending`、`backed_up`、`legacy_removed`、`completed`、boolean `false`、boolean `true` の判定を検証する。
- 通常設定、`GEMINI_API_VERSION`、`TRANCO_VERSION`、`PRIVACY_CONSENT_VERSION`、CAS version、migration state、backup key の分類を検証する。
- `_version` を含む通常設定が除外されないことを検証する。
- バックアップ未確認時、legacy key の一部削除済み、値と CAS 世代の変化、不整合なバックアップをそれぞれ検証する。
- 既存 nested settings を上書きせず、不足分だけを補完する優先順位を検証する。

## 実装アプローチ

1. 正常系、中断後の再開、boolean `true` の修復、キー誤除外、削除前競合を Outside-In の自動テストとして先に追加する。
2. migration 状態を既存 `settings_migrated` キー内の文字列列挙型として定義し、`completed` のみを完了とする。
3. 通常の設定キーと top-level に残す状態を明示的に分類し、部分一致による除外を廃止する。
4. 未移行状態から `pending` を記録し、nested settings への delta 書き込み、有効なバックアップの確認、`backed_up`、再取得した legacy key の削除、`legacy_removed`、`completed` の順に処理する。
5. 各失敗点を未完了状態のまま再開できるようにし、バックアップ確認前の legacy key 削除を禁止する。
6. 削除直前の値と CAS 世代を検査し、競合時は最新値へ追従してバックアップを作り直す。
7. boolean `true` は通常の完了としてスキップせず、既存 nested settings、raw 値、有効なバックアップを照合して非破壊的に修復する。
8. `SettingsRepository` と backup 復元処理が同じ明示的完了判定とキーの配置を使うよう調整する。

## 見積もり

2 SP

## 技術的考慮事項

- ストレージキー構造は高リスク領域であり、既存キーの改名や backup family の変更は行わない。
- `settings_migrated` の保存値は boolean から段階文字列へ変わるため、boolean `false` と boolean `true` を明示的に扱う必要がある。
- `${key}_version` は schema version ではなく CAS version であり、`settings_migrated` とは別の責務を持つ。
- backup は legacy key 削除前に作成し、同じ形式で存在することを確認してから削除する。
- backup 修復は `tryRestoreFromBackup()` の既存契約と競合させず、復元元と移行先の重複管理を増やさない。
- `StoragePort` の delta 書き込みを維持し、既存 nested settings を full snapshot で上書きしない。
- Service Worker の再起動を前提に、進行状態はすべて `chrome.storage` へ保存する。
- 移行処理は StoragePort と既存 optimistic lock / CAS の共有 semantics に従い、削除操作を race-safe にする。
- async/await、ESM import の `.js` 拡張子、MV3 の制約を維持する。
- raw から nested への切替を安定化してから二重管理を統合するため、`pbi/2026-09-25-18-investigate-settings-key-single-writer.md` を前提とする。
- `pbi/2026-09-25-02-investigate-withlock-cas-deep-equal.md` と `settingsMigration.ts:55` および `settingsMigration.ts:246` の CAS semantics を共有する。
- `pbi/2026-09-25-25-fix-encryption-secret-wrapped-storage.md` と `pbi/2026-09-25-27-investigate-master-password-removal-reencrypt.md` との復号経路テストの競合を避ける。

## 実装者向け注記

### 現状コードの確認

- `src/utils/storage/settingsMigration.ts:35-39` は `settings_migrated` の truthy だけで完了を判定し、明示的な migration schema version はない。
- `src/utils/storage/settingsMigration.ts:55-58` は nested settings への書き込み直後に完了フラグを書き、`src/utils/storage/settingsMigration.ts:59-75` のバックアップ作成と legacy key 削除より先に完了状態を記録する。
- `src/utils/storage/settingsMigration.ts:43-46` と `src/utils/storage/settingsMigration.ts:59-64` の `!key.includes('_version')` は、`src/utils/storage/types.ts:33` の `GEMINI_API_VERSION`、`src/utils/storage/types.ts:219` の `TRANCO_VERSION`、`src/utils/storage/types.ts:124` の `PRIVACY_CONSENT_VERSION` にも一致する。
- `GEMINI_API_VERSION` の default は `src/utils/storage/defaults.ts:34` にある。
- production の直接 migration call は `src/background/deferredMigrations.ts:19` の1か所であり、`src/utils/storage/SettingsRepository.ts:129-150` が全設定読み出しの分岐に判定結果を使う。
- `src/utils/storage/settingsMigration.ts:231-247` の `tryRestoreFromBackup()` と、既存の backup / version テストの契約を実装時に再確認する。

### 実装手順

1. 新しい状態文字列と既存 boolean を含む migration 判定の失敗テストを追加する。
2. `GEMINI_API_VERSION` が nested settings に到達することと、consent / Tranco state がトップレベルに残る失敗テストを追加する。
3. 各ストレージ境界で失敗を注入し、state、backup、legacy key、nested settings の組み合わせを検証するテストを追加する。
4. 状態型、完了判定、キー分類を実装する。
5. delta 書き込み、backup 確認、race-safe cleanup、明示的完了の順序を実装する。
6. boolean `true` の repair 経路と `SettingsRepository` の完了判定を更新する。
7. 既存 migration、backup、provider、consent、Tranco テストと型チェック、validate を通す。

### 落とし穴

- `GEMINI_API_VERSION` を nested settings から除外すると、既定値が優先され、利用者が設定画面で変更した値を読み戻せない。
- `TRANCO_VERSION` を nested settings に移すと、Tranco UI のバージョン state が変わる。
- `PRIVACY_CONSENT_VERSION` を nested settings に移すと、privacy consent のバージョン state が変わる。
- 完了フラグを最後に移すだけでは、既に boolean `true` が残っている途中移行ユーザーを救済できない。
- backup の存在確認前に legacy key を削除すると、`tryRestoreFromBackup()` が利用可能な復旧元を失う。
- 値と CAS 世代を再取得せず古いスナップショットを削除すると、削除直前の更新を消失させる。
- full snapshot を `setAll()` に渡すと、delta 契約と既存 nested settings の保守可能性を壊す。
- migration 状態を module state に置くと、Service Worker 再起動時に進行段階を失う。
- `settings_migrated` と `${key}_version` を同じ schema version として扱うと、完了判定と CAS の責務が混在する。

## 決定事項

1. **完了状態を明示的な段階にする。** `pending`、`backed_up`、`legacy_removed`、`completed` を同じ `settings_migrated` キーに保存し、完了は `completed` の完全一致だけを可靠できる状態とする。boolean `false` は未完了として扱い、boolean `true` は旧形式として修復する。truthy 判定を残すと、新しい段階文字列まで完了扱いになる。
2. **通常設定と top-level state を名前ベースで分離する。** `GEMINI_API_VERSION` を含む通常設定は nested settings に移し、`TRANCO_VERSION`、`PRIVACY_CONSENT_VERSION`、migration state、backup namespace、CAS version record はトップレベルに残す。除外は明示的な許可リストで行い、任意の `_version` 部分一致を行わない。
3. **各段階は再入できるようにする。** `pending` では nested settings と backup の整合を検証し、`backed_up` では cleanup を再開し、`legacy_removed` では完了記録だけを確定する。これにより各ストレージ境界の終了を同じ修復経路で扱える。
4. **削除直前に候補と CAS 世代を再取得する。** 一致した候補だけを削除し、値または世代が変わった場合は削除を止めて最新値へ追従する。古いスナップショットによる削除は更新の損失につながる。
5. **boolean `true` の既存ユーザーは非破壊的に修復する。** 既存 nested settings を優先し、有効なバックアップまたは raw source から不足分だけ補完する。修復ソースがない場合は推測で上書きせず、バックアップを先に確認してから残存 legacy key を削除する。`true` を無条件に skip すると、途中まで進んだ状態を固定してしまう。

## Definition of Done

- [ ] BDD受け入れシナリオが自動テストとして実装され、正常系、各中断段階、boolean `true`、キー分類、削除前競合、完了済み skip を網羅している。
- [ ] 既存の migration、backup 復元、deferred migration、SettingsRepository、Gemini provider、privacy consent、Tranco のテストと新規テストがすべて成功する。
- [ ] `npm run type-check` と `npm run validate` が成功する。
- [ ] `settings_migrated`、`settings`、`legacy_settings_backup_*` のストレージキー構造が維持されている。
- [ ] migration 状態が `StoragePort` に永続化され、Service Worker の module state、full snapshot 書き込み、`.then()` チェーンが採用されていない。
- [ ] ESM import に `.js` 拡張子が付っており、Manifest V3 の制約を満たしている。
- [ ] `tryRestoreFromBackup()`、CAS version、暗号化 secret の復号経路との整合が確認されている。
- [ ] 実装内容とキーの配置ルールを必要な内部仕様へ反映し、コードレビューが完了している。
