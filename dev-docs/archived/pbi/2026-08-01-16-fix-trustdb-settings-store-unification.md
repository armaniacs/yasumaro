# PBI: trustDb/trancoConsentManagerの個別キー直接アクセスをsettingsオブジェクト経由に統一する

**作成日**: 2026-08-01
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（trustDbのストレージアクセス経路の変更。tranco_domainsの実データ形式・値は変えない）

---

## 背景

Checking Team レビュー（`plans/2026-08-01-1903-review-yasumaro.md`）の Legacy Bridge Architect からの High指摘「settings単一オブジェクト移行がtrustDbの個別キー直接読み書きデータを破壊する」。事実確認の結果、**個別キー削除・非経由アクセスの事実は正確だが、「Safety Mode警告が機能しなくなる」という結論は誇張**と判明した。

### 事実確認で判明したこと

- `migrateToSingleSettingsObject()`（`settingsStore.ts`）は `StorageKeys` に含まれ `_version` を含まず暗号化キーでもない全キー（`tranco_domains` を含む）を集約対象とする。ただし**既に別PBI（`2026-07-26-15-fix-settings-migration-non-destructive.md`、アーカイブ済み）で対策済み**であり、現在は即時削除ではなく `LEGACY_SETTINGS_BACKUP_KEY_<timestamp>` へのバックアップ退避に変更されている。
- `src/utils/trustDb/trustDb.ts`（911-913, 945-946行、ローカル定数 `STORAGE_KEY_TRANCO_DOMAINS = 'tranco_domains'`）と `src/utils/trustDb/trancoConsentManager.ts`（111, 121-129行）は、`settingsStore` の `settings` オブジェクトを経由せず、`chrome.storage.local` の `tranco_domains` キーを直接 `get`/`set`/`remove` している。この非経由アクセスの事実は正確。
- **誇張と判定された点**: Safety Mode の即時判定を行う `isTrancoDomain()` はメモリ上の `this.state.trancoSet` を参照するのみで、`getSavedTrancoDomains()`（`tranco_domains` ストレージキー由来）を都度呼ばない。`tranco_domains` は「旧リスト保持用」のバックアップデータであり、影響が出るのは `checkTrancoUpdate()` による新旧差分計算フロー（更新通知UI等）に限定される。「Safety Mode警告が次回リフレッシュまで機能しなくなる」は誇張。

とはいえ、**trustDb系のストレージアクセスが `settingsStore` の移行ロジックと構造的に不整合である**こと自体は残存する設計課題であり、将来 `migrateToSingleSettingsObject()` の集約対象キー判定ロジックが変わった場合に同様の問題が再発しうる。本PBIはこの構造的不整合の解消のみをスコープとする（Safety Mode機能自体の修正は不要）。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "STORAGE_KEY_TRANCO_DOMAINS\|tranco_domains" src/utils/trustDb/trustDb.ts src/utils/trustDb/trancoConsentManager.ts
grep -n "isTrancoDomain\|trancoSet\|getSavedTrancoDomains" src/utils/trustDb/trustDb.ts
grep -n "keysToRemove\|LEGACY_SETTINGS_BACKUP_KEY" src/utils/storage/settingsStore.ts
```

`isTrancoDomain()` が `trancoSet`（メモリ上のSet）のみを参照し、`tranco_domains` ストレージキーの読み込みとは独立して動作していることを再確認する。これにより本PBIのスコープが「差分表示・バックアップ用途の整合性」に限定されることを理解した上で着手すること。

## 受け入れ基準（BDD）

```gherkin
Scenario: trustDbがsettingsオブジェクト経由でtranco_domainsを読み書きする
  Given trustDbがtranco_domainsの保存済みリストを取得する
  When getSavedTrancoDomains()が呼ばれる
  Then chrome.storage.localの個別キーではなくgetSettings()経由でtranco_domainsを取得する

Scenario: trancoConsentManagerもsettingsオブジェクト経由でtranco_domainsを読み書きする
  Given trancoConsentManagerがtranco_domainsを更新する
  When 該当の保存処理が呼ばれる
  Then saveSettings()経由でtranco_domainsが更新される（個別キーへの直接setは行わない）

Scenario: settings移行後もtranco_domainsのデータが失われない
  Given migrateToSingleSettingsObject()が実行され旧per-keyデータがバックアップされる
  When trustDbがtranco_domainsを読み込む
  Then settingsオブジェクトから正しくtranco_domainsのデータが取得できる

Scenario: 既存のtrustDb関連テストが回帰しない
  Given 変更後のtrustDb/trancoConsentManager
  When 既存のtrustDb関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `trustDb.ts` の `tranco_domains` 個別キーへの直接 `get`/`set` を、`getSettings()`/`saveSettings()` 経由のアクセスに置き換える
- [ ] `trancoConsentManager.ts` の `tranco_domains` 個別キーへの直接 `get`/`set`/`remove` を同様に置き換える
- [ ] 既存ユーザーが個別キー形式で `tranco_domains` を保持している場合の移行パス（初回読み込み時にsettingsオブジェクトへ統合する等）を用意する
- [ ] 既存の `trustDb` / `trancoConsentManager` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 統合テスト
- `migrateToSingleSettingsObject()` 実行後、`trustDb` が `tranco_domains` を正しく読み込めることを確認
- 個別キー形式のレガシーデータが存在する状態から、settingsオブジェクト経由への移行が正しく行われることを確認

### 単体テスト
- `getSavedTrancoDomains()` が `chrome.storage.local.get('tranco_domains')` ではなく `getSettings()` を呼ぶことを確認（モックで検証）
- `trancoConsentManager` の保存処理が `saveSettings()` を呼ぶことを確認

## 実装アプローチ
- **Outside-In**: 統合テスト（移行後の読み込み）から開始し失敗を確認 → 単体テスト（アクセス経路）→ 実装
- **Red-Green-Refactor**: 各レイヤーでTDDサイクルを適用

## 見積もり

2pt（trustDb.ts / trancoConsentManager.ts の2ファイルでのアクセス経路変更 + 移行パス確認 + 回帰テスト）

## 技術的考慮事項
- 依存関係: `src/utils/storage/settingsStore.ts`, `src/utils/trustDb/trustDb.ts:911-913,945-946`, `src/utils/trustDb/trancoConsentManager.ts:111,121-129`
- テスタビリティ: `chrome.storage.local` / `getSettings`/`saveSettings` のモックで検証可能
- 非機能要件: データ整合性（settings移行ロジックとの構造的一貫性）
- Safety Mode（`isTrancoDomain()`）自体の判定ロジックはメモリ上の `trancoSet` に依存し本PBIの変更対象外。本PBIは差分表示・バックアップ用途のデータ経路統一のみを扱う

## 落とし穴
- `migrateToSingleSettingsObject()` の集約対象キー判定（`StorageKeys` に含まれ `_version` を含まず暗号化キーでない）は、`tranco_domains` を暗黙に含んでいる。今回の変更でtrustDb側をsettings経由に統一すれば、この暗黙の依存関係が明示化され、将来同様の不整合が再発しにくくなる。

## Definition of Done
- [x] `trustDb.ts` / `trancoConsentManager.ts` が `tranco_domains` をsettingsオブジェクト経由で読み書きしている
- [x] レガシー個別キーからの移行パスが実装されている
- [x] 全テストがパスする
- [x] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-08-01-1903-review-yasumaro.md`（Legacy Bridge Architect指摘、High #2）
- 対象コード: `src/utils/storage/settingsStore.ts:189-193,214-233`, `src/utils/trustDb/trustDb.ts:911-913,945-946`, `src/utils/trustDb/trancoConsentManager.ts:111,121-129`
- 事実確認: 個別キー非経由アクセスの事実は正確。「Safety Mode警告機能停止」という結論は誇張（`isTrancoDomain()`はメモリ上の`trancoSet`依存でこのストレージキーとは独立）
- 既存対策済みPBI: `dev-docs/archived/pbi/2026-07-26-15-fix-settings-migration-non-destructive.md`（settingsStore側の即時削除→バックアップ退避化は対応済み。本PBIはtrustDb側の残存課題のみを扱う）

## 実装メモ（2026-08-01完了）

- **スコープ拡張の判断**: `updateTrancoVersion()` が `tranco_version` と `tranco_domains` を同一の `chrome.storage.local.set()` 呼び出しで同時に書き込んでいたため、`tranco_domains` だけをsettings経由に切り替えると1関数内で2つの異なるストレージ経路が混在してしまう。`tranco_version` も `StorageKeys` に定義済みでsettingsオブジェクトの型に含まれていたため、本PBIのスコープを両キーに広げて統一した
- `src/utils/trustDb/trustDb.ts`: `getSavedTrancoVersion()` / `updateTrancoVersion()` / `getSavedTrancoDomains()` を `getSettings()`/`saveSettings()`（動的import、`settingsStore.ts`との循環参照回避のため）経由に変更。未使用になった`STORAGE_KEY_TRANCO_VERSION`/`STORAGE_KEY_TRANCO_DOMAINS`定数を削除
- `src/utils/trustDb/trancoConsentManager.ts`: `saveOldTrancoDomains()` / `getOldTrancoDomains()` / `clearOldTrancoDomains()` を `saveSettings()`/`getSettings()` 経由に変更。`clearOldTrancoDomains()`は「キー削除」ではなく「空配列への設定」に意味が変わる（settingsオブジェクトにはキー削除の概念がないため）。`resetAll()`はconsent系3キーの`chrome.storage.local.remove()`（スコープ外、現状維持）と`clearOldTrancoDomains()`呼び出しに分離
- `isTrancoDomain()`・Safety Mode判定自体（メモリ上の`trancoSet`依存）は変更していない
- テスト: `trustDb.test.ts`は`settingsStore.js`を`vi.mock`し独立したモックストアで検証するよう書き換え（`getSettings()`のモジュールスコープキャッシュ`cachedSettings`がテスト間で状態を持ち越す問題があり、`chrome.storage.local`直接モックでは対応できなかったため）。`trancoConsentManager.test.ts`は既存の`mockStorage` Mapを`settingsStore`モックからも参照する形にして一貫性を保った。`clearOldTrancoDomains`/`resetAll`のアサーションを「キー削除」から「空配列設定」の新仕様に更新
- `npm run validate`（型チェック + vitest全件7336件、既存テストの修正のみで純増減なし）成功、`npm run build` 成功
