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

- [x] `settings_migrated`、`settings`、`legacy_settings_backup_*` のストレージキー名を変更しない。
- [x] `settings_migrated` に `pending`、`backed_up`、`legacy_removed`、`completed` の明示的な段階を保存できるようにする。
- [x] 完了判定は truthy 判定ではなく `completed` との完全一致で行い、boolean `true` は未確認の旧形式として修復対象にする。
- [x] `settings` への書き込み、有効なバックアップの確認、移行対象 legacy key の削除、`completed` の記録をこの順進め、前の段階で失敗した場合は完了にしない。
- [x] 各段階から再実行でき、部分的な legacy key 削除や中断後の再実行でも結果を損なわない。
- [x] `GEMINI_API_VERSION` は nested settings に移す。`TRANCO_VERSION` と `PRIVACY_CONSENT_VERSION` はトップレベルに留める。
- [x] `${key}_version` は CAS version として扱い、schema version や `settings_migrated` と混同しない。
- [x] キーの除外は部分一致ではなく、明示的な許可リストで判定する。
- [x] 削除直前に移行対象を再取得し、値または CAS 世代が変化している場合は削除せず、最新値を delta 書き込みとバックアップへ反映してから再試行する。
- [x] `settings` の full snapshot を `setAll()` に渡さず、差分だけを変更する。
- [x] migration 状態を Service Worker の module state に保持せず、`StoragePort` 経由で永続化する。
- [x] `SettingsRepository` は未完了段階を完了扱いせず、既存の設定読み出しと backup 復元契約を維持する。
- [x] production の直接 migration call は引き続き deferred migration 経路から1回だけ実行される。

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

- [x] BDD受け入れシナリオが自動テストとして実装され、正常系、各中断段階、boolean `true`、キー分類、削除前競合、完了済み skip を網羅している。（`src/utils/storage/__tests__/settingsMigration-completion-state.test.ts` に 31 テスト）
- [x] 既存の migration、backup 復元、deferred migration、SettingsRepository、Gemini provider、privacy consent、Tranco のテストと新規テストがすべて成功する。（`npx vitest run` 全体: 14183 passed / 2 failed。失敗 2 件は並列セッション側の `src/background/__tests__/obsidianClient-failureTaxonomy.test.ts` の 30s タイムアウトで、単体実行では 12/12 成功する。設定移行とは無関係。）
- [x] `npm run type-check` と `npm run validate` が成功する。（`validate:json` / `lint` 0 errors / `check-innerhtml-escape` / `check-deprecated-aliases` / `type-check` / `test` すべて通過）
- [x] `settings_migrated`、`settings`、`legacy_settings_backup_*` のストレージキー構造が維持されている。
- [x] migration 状態が `StoragePort` に永続化され、Service Worker の module state、full snapshot 書き込み、`.then()` チェーンが採用されていない。
- [x] ESM import に `.js` 拡張子が付っており、Manifest V3 の制約を満たしている。
- [x] `tryRestoreFromBackup()`、CAS version、暗号化 secret の復号経路との整合が確認されている。（移行が書いた `legacy_settings_backup_*` を `tryRestoreFromBackup()` が実際に復元できることをテストで固定。CAS は `settings_version` の世代検知と `StorageTransaction` の `withLock`。鍵リングはトップレベル許可リストに残すため暗号化 secret の復号経路に影響しない。）
- [ ] 実装内容とキーの配置ルールを必要な内部仕様へ反映し、コードレビューが完了している。（仕様反映は完了: `dev-docs/DESIGN_SPECIFICATIONS.md` §5.1.1 キーの配置 / §5.1.2 設定移行ステートマシン。formal なレビューパスは未実施。）

---

## 実施記録（2026-09-26）

### 現状の実測（着手時）

| 箇所 | 実測した挙動 |
|------|-------------|
| `settingsMigration.ts:48-51` | `chrome.storage.local.get(SETTINGS_MIGRATED_KEY)` の truthy 判定のみでスキップを決める。schema version は存在しない |
| `settingsMigration.ts:67-70` | nested settings へ delta 書き込みの直後に `settings_migrated: true` を書く |
| `settingsMigration.ts:71-87` | その後でバックアップ作成と legacy key 削除。→ 完了記録が両者より先 |
| `settingsMigration.ts:55-58` / `:71-76` | `Object.values(StorageKeys).includes(key) && !key.includes('_version') && !isEncryptionKey(key)`。`gemini_api_version`（`types.ts:34`）・`privacy_consent_version`（`:130`）・`tranco_version`（`:223`）の 3 つが誤って除外される。CAS record（`settings_version` 等）は StorageKeys 値でないため別の理由で除外される |
| `defaults.ts:34` | `GEMINI_API_VERSION` の default は `'v1beta'`（`gemini_api_version` が nested に入らないと利用者が変更した値を読み戻せない） |
| `deferredMigrations.ts:19` | production の直接 call は 1 か所。返値が truthy のときだけ `logInfo` |
| `SettingsRepository.ts:132` | `if (result['settings'] && result['settings_migrated'])` — truthy 判定 그대로。新しい段階文字列も完了扱いになる |
| `settingsMigration.ts:243-260` | `tryRestoreFromBackup()` は `legacy_settings_backup*` の最大キーの `data` を取り出し、`withOptimisticLock('settings', ...)` で restore する |

### 5 Whys

1. **なぜ完了フラグがバックアップと削除より先に書かれるのか** — 移行を「1 回の書き込み」として modelled し、非同期境界（`withOptimisticLock` の後、`chrome.storage.local.set` の後、`remove` の前）でプロセスが落ちても矛盾しないことを検出する手段がなかった。`settings_migrated` が表現できるのは「移行が走る」か「移行が成功した」の 2 値だけで、後者を置く場所が早期になっていた。
2. **なぜその順序でも「一度しか Migrate されない」前提で設計されたのか** — MV3 の Service Worker が任意に終了するという事実を、逐次 `await` の列が隠していた。各 `chrome.storage.local` 呼び出しは短時間で終わるため中断を前提にせず、バックアップを典型的な最初（完了フラグ）の直後に置いた。チェックポイントを置くという発想自体がなかった。
3. **なぜ truthy フラグだけで完了判定できたのか** — 記録される値が boolean しかなく、判定側は `if (result[KEY])` という truthiness を書くしかない。**段階という概念がドメインに存在しなかった**ため、`pending` と `completed` の区別がデータモデルとして表現されなかった。
4. **なぜ `_version` を含むキーの分類が誤るのか** — 命名規則を「意味の代用」にしていた。`{key}_version` は CAS の世代カウンター、`gemini_api_version` は利用者が変更する一般設定 —— という 2 つの意味が同一の文字列パターンに落ちる。`!key.includes('_version')` は前者を排除するために後者も落とし、`defaults.ts:34` の通常設定が nested に入らないという害が silent に現れる。
5. **根本原因** — **移行が「1 回の原子的操作」ではなく「中断しうる多段階の列」であることが契約で表現されておらず、完了が単一の真偽値として記録されていたこと。** チェックポイントが契約上の概念として無いまま、実装の副作用として「最後に `true` を書く」だけで中断耐性を表現しようとしていた。加えて、キー配置の規則が所有権ではなく文字列パターンで決まっていたため、削除が破壊的操作であることの重大性も表現されていなかった。

### 採用した migration version 方式

- `SETTINGS_MIGRATION_SCHEMA_VERSION = 2` を導入。`settings_migrated` の保存値を **boolean から** `{ schemaVersion, stage }` のレコード**に変更（キー名 `settings_migrated` は不変）。`stage` は `pending` → `backed_up` → `legacy_removed` → `completed` の単調増加列。
- 完了判定は **version 比較**。`isSettingsMigrationComplete(raw)` は `stage === 'completed' && schemaVersion >= 2` のみ true。version 1 = 旧 boolean 契約、version 0/欠損 = 未検証。将来 version 3 が出たときも completed 判定は false にならない（downgrade しない）。
- schema version を `GEMINI_API_VERSION` 等と衝突しない**格納位置**を選んだ: version 用の新ストレージキーを増やさず、既存 `settings_migrated` の**値**の中に持たせた。CAS の `${key}_version` とも責務が分離している（CAS は `StorageTransaction` が `settings_version` として管理し、本 PBI は読み取りのみ）。

### 旧形式の完了記録の読み替え方針

`settings_migrated: true` は **「完了」ではなく「未検証」** として扱う。根拠: 旧実装はバックアップ前に `true` を書いていたため、`true` は「移行が最後まで到達した」証拠にならない。

読取経路と移行経路で意図的に判定を分ける:

| 経路 | 述語 | legacy `true` の扱い | 理由 |
|------|------|----------------------|------|
| 移行（`migrateToSingleSettingsObject`） | `isSettingsMigrationComplete` | **未完了** → 修復経路へ | 破損した途中移行を救済する必要がある |
| 読取（`SettingsRepository.getAll`） | `isSettingsBlobAuthoritative` | **authoritative とみなす** | 既存ユーザーの blob を捨てて scattered 経路へ落とさない。修復は deferred migration が先に走らせる |

修復経路は非破壊: 既存 nested settings を最優先で保持し、不足分だけを raw / 有効なバックアップから補完し、**バックアップを確認してから**残存 legacy key を削除し、最後に `completed` を記録する。raw もバックアップも無い key は推測で上書きしない。

### 完了記録を移した後の正確な順序

```
1. read settings_migrated                → completed なら即 return false（書き込みゼロ）
2. collect legacy keys                  → StorageKeys 値 かつ トップレベル許可リスト外
3. record stage 'pending'                ← ここで中断しても未完了 = 次回再実行される
4. delta merge into settings             ← 既存 nested を上書きせず不足分だけ
5. create + read-back verify backup      ← tryRestoreFromBackup() が読める形でなければ中断
6. record stage 'backed_up'              ← ここで中断しても未完了。raw は残る
7. re-read values & CAS generation
   ├─ 変化あり → 最新値を delta 上書き + backup 更新 → 7 へ (最大 3 回)
   └─ 変化なし → 8 へ
8. remove remaining legacy keys          ← 破壊的操作。中断しても blob と backup に写っている
9. record stage 'legacy_removed'         ← ここで中断しても未完了
10. final scan: migratable key が 1 つでも残るなら return false（completed を書かない）
11. record stage 'completed'             ← 最後に 1 回だけ
```

### version 管理キーの分類変更（文字列マッチ → 実値判定）

旧: `Object.values(StorageKeys).includes(key) && !key.includes('_version') && !isEncryptionKey(key) && key !== SETTINGS_MIGRATED_KEY`

新: `isMigratableStorageKey(key)` = `STORAGE_KEY_VALUES.has(key) && !TOP_LEVEL_ONLY_KEYS.has(key)`

- `STORAGE_KEY_VALUES` は `Object.values(StorageKeys)` の実値集合。CAS record（`settings_version` / `savedUrls_version`）、`settings` blob、`settings_migrated`、`legacy_settings_backup_*`、他モジュールのキーは「StorageKeys 値でない」ことで排除される — 名前パターンではなく。
- `TOP_LEVEL_ONLY_KEYS` は明示的許可リスト。エントリごとに、所有モジュールが raw `chrome.storage.local` を読んでいる証拠がある:
  - 鍵リング 5 キー（`encryptionSession.ts`）
  - `privacy_consent_version`（`privacyConsent.ts:492`）
  - `tranco_version`（`trancoConsentManager.ts`）
  - `trust_db:json`（`TrustDbKernel.ts:121` で raw read、`:210` で raw `withOptimisticLock` 書き込み。`DEFAULT_SETTINGS` / `restorableSettings` / `settingsSchemas` のいずれにも無く blob 側 reader が無いため、本 PBI で追加）
- 結果として `gemini_api_version` は初めて nested settings に入り、`defaults.ts:34` のデフォルトが上書きされる異常が解消する。

### 変更ファイル

- `src/utils/storage/settingsMigration.ts` — ステートマシン本体、`isSettingsMigrationComplete` / `isSettingsBlobAuthoritative` / `isMigratableStorageKey` / `parseSettingsMigrationState`、`StoragePort` seam、バックアップ検証、削除前競合検知
- `src/utils/storage/SettingsRepository.ts` — 読取判定を `isSettingsBlobAuthoritative` へ
- `src/utils/storage/storagePort.ts` — `StoragePort.remove?`（破壊操作の seam）、`ChromeStoragePort` / `InMemoryStoragePort` に実装
- `src/utils/storage/storageTransaction.ts` — `deepEqual` を export（削除前の値比較で CAS と同じ canonical 意味論を使う）
- `src/utils/storage/__tests__/settingsMigration-completion-state.test.ts` — 新規（31 テスト）
- `src/utils/__tests__/storage-locking.test.ts` — 旧 boolean 前提の 2 アサーションを versioned 記録へ更新
- `dev-docs/DESIGN_SPECIFICATIONS.md` — §5.1.1 キーの配置ルール、§5.1.2 設定移行ステートマシン

### 中断段階ごとのテストが保証していること

| テスト | 保証 |
|--------|------|
| `records completion strictly after the backup write and the legacy-key removal` | ジャーナル順で「backup 書込 < legacy 削除 < completed 記録」。核心の順序逆転が再発しない |
| `never records completion when the backup write fails, and finishes on the next run` | バックアップ失敗時: stage=`pending`・未完了判定・raw キー生存・**次回実行で完了** |
| `stops at backed_up when the removal fails, and finishes on the next run` | 削除失敗時: stage=`backed_up`・バックアップ 1 件・**次回実行で完了し、バックアップを重複作らない** |
| `resumes a partially removed legacy set without overwriting the blob` | 途中まで削除済みの再実行: 残存 key のみ削除、**既存 nested を上書きしない**、completed へ |
| `completes a legacy_removed run by recording the stage only` | 削除後・完了記録前に落ちた状態: **nested も CAS 世代も触らず** completed だけ記録 |
| `follows a raw key that changed between the backup and the removal` | 削除直前の更新: **削除せず**最新値を nested と backup に反映してから削除。最新のバックアップが最新値を保持 |
| `gives up without recording completion when the raw key keeps changing` | 競合が継続しても **completed を書かない**（raw キーと最新値が生存）→ 次回 start が再試行 |
| `skips a completed migration without touching anything` | 完了済みは 0 書き込みでスキップ、blob を上書きしない |
| `keeps the nested settings, backfills the gaps, and only then removes the raw keys` | boolean `true` の非破壊修復: 既存 nested 優先・不足分補完・raw 削除・completed |
| `upgrades a legacy boolean with nothing left to migrate without creating a backup` | 残存 raw 無しの boolean `true` はバックアップを作らず versioned 記録へ |
| `SettingsRepository — an unfinished stage is not an authoritative blob` | `pending`/`backed_up`/`legacy_removed` では raw キーが読み取りに混ざる（未完了を完了扱いしない）。`completed` では混ざらない |

### 残課題（本 PBI の範囲外 — 別 PBI が必要）

raw `chrome.storage.local` を読むモジュールが複数あり、**同じクラスのデータ損失ベクタが残っている**。いずれも PBI 2026-09-25-18（single writer）の対象:

- `privacy_consent` / `privacy_consent_denied_count` / `privacy_consent_last_denial_time`（`privacyConsent.ts:72,404,414` が raw read）— 現状は移行で nested へ移動・削除され、consent state を失う
- `recording_triggers` / `min_visit_duration` / `min_scroll_depth` / `snapshot_interval_minutes`（`recordingTriggerManager.ts:74,125,150` が raw read/write）— 同じく移動・削除される
- `tranco_version` の split-brain: `TrancoConsentManager` は raw 読、`TrancoVersionTracker.getSavedTrancoVersion()` は blob 読

