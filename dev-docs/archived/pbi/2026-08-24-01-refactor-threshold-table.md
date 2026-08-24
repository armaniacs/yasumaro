# PBI-01: Threshold手動clamp列挙をテーブル駆動に

優先度: 1位 / RICE 42.0 (Reach 7 × Impact 2 × Conf 90% / Effort 0.3w)
種別: refactor
依存: なし
ファイル触接: `src/content/extractor.ts:169-200`, `src/content/pageState.ts`, `src/utils/aiSummaryCleaner/rules.ts`
Effort: 0.3w (Small)

## 背景

PBI a8cc83fbで32 rule flagは`CLEANSING_RULES.map`導出に置換済みだが、threshold 7件（linkRatioThreshold / shortTextThreshold / shortSeqCount / linkParaThreshold / fallbackRatio / fallbackMinBytes / contentDedupThreshold）は手動`if (s[STORAGE.*] !== undefined) cfg.* = clamp(...)`が7連打で残留。boundsとdefaultが`THRESHOLD_DEFAULTS` / `DEFAULT_CLEANSING_CONFIG` / extractor clampの3箇所に分散し、閾値追加時に3ファイル同期が必要。deletion testでSettingsLoaderを消すと30行のclamp ladderが再出現するshallow module状態。

## 目的

threshold定義を単一テーブル`THRESHOLD_RULES`に集約し、extractorの7連打を1ループのテーブル駆動に置換する。閾値追加が1行で完結し、bounds変更が1箇所で完結する状態にする。

## なぜなぜ分析

1. なぜ7 thresholdが手動列挙か → booleanKeysはPBI a8cc83fbで導出したがthresholdは対象外だったため
2. なぜ対象外だったか → THRESHOLD_DEFAULTSがrules.tsにあり、CleansingConfigのthresholdがpageState.tsにあり、extractor clampが別ファイルにあるという3分散をSSOTとして認識していなかったため
3. なぜ認識していなかったか → rule flagは`CLEANSING_RULES`という明示的テーブルがあったがthresholdは数値のバラ定数として扱われテーブル化されていなかったため
4. なぜテーブル化されていなかったか → thresholdは「範囲検証付き数値」という追加メタ（min/max/default）を持つため単純なmap対象に見えなかったため
5. なぜ追加メタが障壁だったか → `{storageKey, prop, min, max, default}`の5要素タプルを型安全に定義する設計がなく、手動ifの方が早く見えたため

→ 解: `THRESHOLD_RULES: Array<{storageKey, prop, min, max, default}>`をrules.tsまたはpageState.tsに定義し、extractorでは`for (const t of THRESHOLD_RULES) cfg[t.prop]=clamp(...)`の1ループに置換。既存booleanKeys導出と同型にする。

## 受け入れ基準 (BDD)

### Scenario 1: 閾値テーブル導出（ハッピーパス）

- **Given** `THRESHOLD_RULES`が`{storageKey, prop, min, max, default}`の7要素で定義されている
- **When** 新しいthreshold（例: `contentDedupThreshold`）のboundsを変更する
- **Then** 変更箇所は`THRESHOLD_RULES`の1行のみで、extractor.tsのclampロジックは触らずに反映される
- **And** `DEFAULT_CLEANSING_CONFIG`の既定値と`THRESHOLD_DEFAULTS`が同一テーブルから導出される

### Scenario 2: 範囲外値のclamp（境界ケース）

- **Given** chrome.storageに`AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD = 999`が保存されている
- **When** `loadSettings()`が実行される
- **Then** `pageState.cleansingConfig.aiSummaryCleansingLinkRatioThreshold`は`100`にclampされる
- **And** `FALLBACK_RATIO = -5`は`0`に、`SHORT_TEXT_THRESHOLD = 0`は`1`にclampされる

### Scenario 3: 未定義時のデフォルトフォールバック

- **Given** chrome.storageにthresholdキーが存在しない
- **When** `loadSettings()`が実行される
- **Then** 各thresholdは`THRESHOLD_RULES`の`default`値（例: linkRatio 70, shortText 30）が適用される
- **And** 既存の7 threshold全てでデフォルトが正しく設定される

### Scenario 4: 型安全なprop導出

- **Given** `THRESHOLD_RULES`の`prop`が`keyof CleansingConfig`として型付けされている
- **When** 存在しないprop名をテーブルに追加しようとする
- **Then** TypeScriptがコンパイルエラーを出す

## DoD

- [ ] `THRESHOLD_RULES`テーブルが定義され7 thresholdが網羅されている
- [ ] `src/content/extractor.ts`の7連打ifが1ループに置換されている
- [ ] `DEFAULT_CLEANSING_CONFIG` / `THRESHOLD_DEFAULTS`が同一テーブルから導出または整合がテストで保証されている
- [ ] 既存テスト（extractor / pageState / contentExtractor）が全PASS
- [ ] `npm run type-check` PASS
- [ ] 新規テストで境界clamp（999→100, -5→0等）が検証されている

## 技術メモ

- 配置先は`src/utils/aiSummaryCleaner/rules.ts`が自然（既に`THRESHOLD_DEFAULTS`と`CLEANSING_RULES`がある）。pageState.tsからimportする形でも可だが、rules.tsに集約してpageState側はre-exportでも良い。
- `contentDedupThreshold`は`parseFloat(String(...))`で処理されているが、他thresholdと同様に`Number(...)` + clampに統一するか、テーブルに`parser`フィールドを追加する検討。
- 参考: `src/content/extractor.ts:136-155`のbooleanKeys導出パターンを踏襲する。
