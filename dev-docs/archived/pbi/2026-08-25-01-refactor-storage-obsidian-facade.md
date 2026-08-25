# PBI-01: StorageKeys Slice A — Obsidian/AI/Privacy facade

優先度: 1位 / RICE 32.0 (Reach 9 × Impact 2 × Conf 80% / Effort 0.45w)
種別: refactor
依存: —（Slice B完了、ServiceContainer完了でenabler満たし）。Slice Cの前提
ファイル触接: `src/utils/storage/SettingsRepository.ts`, `src/utils/storage/types.ts`, `src/background/serviceContainer.ts`
Effort: 0.45w (M)

## 背景

Slice BでCleansing 40+7キーは`getCleansingConfig`/`getThresholds`に集約されたが、Obsidian 6キー（API_KEY/PROTOCOL/HOST/PORT/DAILY_PATH/ENABLED）・AI 15キー（GEMINI/OPENAI系/PROVIDER）・Privacy 5キーは191箇所の`settings[StorageKeys.X] ?? fallback`分散のまま。`getMany`は`DEFAULT_SETTINGS` fallbackを内包するのに未利用。`grep StorageKeys` 1015箇所中68ファイルが直参照。1キー変更で6ファイル編集のn×m債務が残る。

## 目的

`getObsidianConfig()`/`getAiProviderConfig()`/`getPrivacyConfig()`を`SettingsRepository`に追加し、各facadeは`getMany([...keys])` 1回 + `DEFAULT_SETTINGS`単一参照で完結させる。`ServiceContainer`に`settingsRepository`を`singleton:true`登録しテストは`override`で差替可能にする。

## なぜなぜ分析

1. なぜ47箇所が直参照か → Slice BでCleansingは集約されたがObsidian/AI/Privacyはfacade未実装で各所が`??`していたため
2. なぜfacade未実装か → Cleansing 40+7キーのSSOT化が先に必要で、Obsidian/AIはその後に設計すべきだったため
3. なぜ後に設計すべきだったか → `THRESHOLD_RULES`/`CLEANSING_RULES`のテーブル化が先に必要で、facadeはそのenabler完了後に束ねるのが自然だったため
4. なぜ束ねるのが自然か → `DEFAULT_SETTINGS` fallbackを`getMany`が内包することは既に実装されていたが、facadeで束ねないとcall site毎の`??`が短期的には動いていたため
5. なぜ短期的には動いていたか → `settings[StorageKeys.X] ?? 'https'`が各所で動くが、デフォルト変更時に6ファイル同時編集が必要なn×m債務はテストで検出されなかったため

→ 解: 3 facadeを`SettingsRepository`に追加し`getMany`で1回取得、fallbackは`DEFAULT_SETTINGS`を単一参照で完結。`ServiceContainer`に`settingsRepository`を登録。

## 受け入れ基準 (BDD)

### Scenario 1: Obsidian facade（ハッピーパス）

- **Given** `StorageKeys.OBSIDIAN_*` 6キーが`SettingsRepository`にfacadeとして束ねられている
- **When** `await repo.getObsidianConfig()`を呼ぶ
- **Then** 1回の`getMany`で完結し、未設定キーは`DEFAULT_SETTINGS`の既定値（protocol `https`, port `27124`, dailyPath `092.Daily/{YYYY}-{MM}-{DD}.md`）で補完される
- **And** 呼び出し元は`settings[StorageKeys.OBSIDIAN_API_KEY] ?? ''`を書かずに`config.apiKey`で取得できる

### Scenario 2: AI facade

- **Given** AI 15キーが`getAiProviderConfig()`に束ねられている
- **When** `await repo.getAiProviderConfig()`を呼ぶ
- **Then** `priorityList`/`provider`/`modelKey`が1 `getMany`で取得され、inline fallback `|| 'gemini'`が不要になる

### Scenario 3: 既存テストの維持

- **Given** 既存の`SettingsRepository`テストが存在する
- **When** リファクタ後のコードでテストを実行する
- **Then** 全テストがPASSし、`DEFAULT_SETTINGS`とfacadeの既定値が一致する

## DoD

- [ ] `SettingsRepository`に`getObsidianConfig()`/`getAiProviderConfig()`/`getPrivacyConfig()`が存在する
- [ ] `ServiceContainer`に`settingsRepository`が`singleton:true`で登録されている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS（8394件）
- [ ] 新規テストで3 facadeのbulk取得とデフォルト補完が検証されている

## 技術メモ

- Layer違反回避: `SettingsRepository`はL1、Obsidian/AIはbackground/AppCoreだが、facadeのkeys配列は`StorageKeys`列挙でローカル定義し`aiSummaryCleaner`等のAppCoreモジュールはimportしない。THRESHOLD_RULES同様のミラー定数化で対応。
- `createBackgroundServices.ts`で`container.register('settingsRepository', () => new SettingsRepository(new ChromeStorageAdapter()), {singleton:true})`を追加。
