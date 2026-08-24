# PBI-05: StorageKeys Slice B — Cleansing+Thresholds facade

優先度: 1位 / RICE 63.0 (Reach 7 × Impact 2 × Conf 90% / Effort 0.20w)
種別: refactor
依存: THRESHOLD_RULES(6.7.76) / ServiceContainer(6.7.77) — enabler完了、依存なし
ファイル触接: `src/utils/storage/SettingsRepository.ts`, `src/utils/aiSummaryCleaner/rules.ts`, `src/content/pageState.ts`
Effort: 0.20w (S)

## 背景

`CLEANSING_RULES` 32行と`THRESHOLD_RULES` 7行は`rules.ts`でSSOT化されたが、`SettingsRepository`が束ねるfacade未実装で`extractor.ts:169`のthresholdループ、`pageState.ts:59`の`THRESHOLD_CONFIG_DEFAULTS`導出、`aiSummaryCleansingSettingsV2.ts`の40 boolean導出が3箇所で同一SSOTを再適用。88箇所の`StorageKeys.`直参照のうち40+7キーは`SettingsRepository`経由の1 `getMany`で集約可能だが、手書き`?? DEFAULT_SETTINGS`が各所に分散。THRESHOLD_RULES enablerで0.4w削減済みだがfacade未実装でleverage未回収。

## 目的

`SettingsRepository`に`getCleansingConfig(): CleansingConfig`と`getThresholds(): CleansingThresholds`を追加し、40+7キーの取得を1 `getMany([...CLEANSING_RULES.map+THRESHOLD_RULES.map])` + `DEFAULT_SETTINGS` fallback内包で完結させる。`pageState`と`extractor`の二重導出を1 seamに集約する。

## なぜなぜ分析

1. なぜ40+7キーが3箇所で再導出されるか → CLEANSING_RULES/THRESHOLD_RULESはSSOT化されたがSettingsRepositoryが束ねるfacade未実装で各所が個別にループしていたため
2. なぜfacade未実装か → THRESHOLD_RULES集約(PBI-01)時にfacadeはスコープ外で、threshold 7連打の1ループ化のみが完了したため
3. なぜスコープ外だったか → 7 thresholdsの`{storageKey,prop,min,max,default}`テーブル化が先に必要で、facadeはそのテーブル完了後に設計すべきだったため
4. なぜ設計が遅れたか → `SettingsRepository.getMany`が`DEFAULT_SETTINGS` fallbackを内包(`SettingsRepository.ts:181`)することは既に実装されていたが、40+7キーのbulk getをfacadeで束ねる設計がなく、call site毎の`??`が短期的には動いていたため
5. なぜ束ねる設計がなかったか → `CLEANSING_RULE_DEFAULTS`と`THRESHOLD_DEFAULTS`が`defaults.ts`と`rules.ts`に分散し、`getCleansingConfig`の1 seamで両方を統括する認識がなかったため

→ 解: `SettingsRepository`に2 facadeを追加し、`CLEANSING_RULES`/`THRESHOLD_RULES`の`storageKey`配列を`getMany`で一括取得、fallbackは`DEFAULT_SETTINGS`を単一参照で完結。`pageState`の導出はrepo経由の初期化に一本化。

## 受け入れ基準 (BDD)

### Scenario 1: 1 seamで40+7キー取得（ハッピーパス）

- **Given** `CLEANSING_RULES` 32行と`THRESHOLD_RULES` 7行がSSOTとして定義されている
- **When** `await repo.getCleansingConfig()`と`await repo.getThresholds()`を呼ぶ
- **Then** 各呼び出しは1回の`getMany`で完結し、未設定キーは`DEFAULT_SETTINGS`の既定値で補完される
- **And** 呼び出し元は`StorageKeys.`直参照と`??` fallbackを書かずに済む

### Scenario 2: 未設定時のデフォルト補完

- **Given** `chrome.storage.local`に`AI_SUMMARY_CLEANSING_RECOMMEND_ENABLED`が不在
- **When** `getCleansingConfig()`を実行する
- **Then** `cleansingConfig.aiSummaryCleansingRecommend`は`DEFAULT_SETTINGS[StorageKeys.AI_SUMMARY_CLEANSING_RECOMMEND_ENABLED]`の既定値(true)で補完される

### Scenario 3: threshold clampの集約

- **Given** `getThresholds()`が`THRESHOLD_RULES`の`storageKey`配列を`getMany`で取得する
- **When** 閾値キーに範囲外値（例: linkRatio 999）が保存されている
- **Then** `getThresholds()`内で`THRESHOLD_RULES`の`min/max`でclampされ、呼び出し元での個別clampが不要になる

### Scenario 4: 既存テストの維持

- **Given** 既存の`SettingsRepository`テストと`pageState`テストが存在する
- **When** リファクタ後のコードでテストを実行する
- **Then** 全テストがPASSし、`DEFAULT_CLEANSING_CONFIG`と`THRESHOLD_DEFAULTS`の既定値が一致する

## DoD

- [ ] `SettingsRepository`に`getCleansingConfig()`と`getThresholds()`が存在し、`CLEANSING_RULES`/`THRESHOLD_RULES`の`storageKey`を`getMany`で一括取得している
- [ ] `pageState.ts`の`THRESHOLD_CONFIG_DEFAULTS`/`DEFAULT_CLEANSING_CONFIG`導出が`getCleansingConfig`/`getThresholds`経由に一本化されているか、少なくとも二重導出がテストで検出可能になっている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS（8394件）
- [ ] 新規テストで40+7キーのbulk取得とデフォルト補完が検証されている

## 技術メモ

- `SettingsRepository.ts:176-184`の`getMany`は既に`DEFAULT_SETTINGS` fallbackを内包。`getCleansingConfig`は`CLEANSING_RULES.map(r=>r.storageKey)`と`THRESHOLD_RULES.map(r=>r.storageKey)`を`getMany`で一括取得し、返却オブジェクトを`CleansingConfig`に整形する。
- `pageState.ts:59-78`の`THRESHOLD_CONFIG_DEFAULTS`は`THRESHOLD_RULES`から導出済みだが、`DEFAULT_CLEANSING_CONFIG`との二重導出を`getCleansingConfig`のテストで比較してdetector化する。
- 参考: `src/content/extractor.ts:169-174`のthresholdループは`getThresholds()`に置換可能だが、content isolated worldのため`extractor.ts`は`chrome.storage.local`直読みを維持し、バックグラウンド側のfacadeは`SettingsRepository`経由の`getMany`で一括取得する。
