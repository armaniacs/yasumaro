# PBI: pageState シャローコピー汚染

## ユーザーストーリー
開発者として、`PageState` の `cleansingConfig` 初期化がシャローコピー汚染せずに独立したコピーを保持するようにしたい、なぜなら `DEFAULT_CLEANSING_CONFIG` の配列プロパティ（`contentStripKeywords` / `aiSummaryCleansingCustomPatterns`）がシャローコピーで共有され、1インスタンスの `push` / 代入がデフォルト値と他インスタンスを汚染し、クレンジング判定の非決定的なバグになるから。

## 優先度
- 順位: 6 / 17
- RICEスコア: 320（Reach=20 / Impact=1 / Confidence=80% / Effort=0.05）
- 根拠: `PageState` は content script 注入ごとに生成されるが、テストではケースごとに new され汚染が検出されにくい。Reach=20（content script 利用者とテスト）。Impact=1（クレンジング誤判定・デフォルト汚染は局所）。Confidence=80%（`{ ...DEFAULT_CLEANSING_CONFIG }` がシャローであることは確実だが、実害の再現は配列書き換え経路に依存）。Effort=0.05（1行修正）。

## なぜなぜ分析
- なぜ汚染するか: `src/content/pageState.ts:109` で `cleansingConfig: CleansingConfig = { ...DEFAULT_CLEANSING_CONFIG }` とスプレッド代入しており、トップレベルのプリミティブは複製されるが配列は参照コピーになるため
- なぜ配列が共有されるか: `DEFAULT_CLEANSING_CONFIG` の `contentStripKeywords`（17要素）と `aiSummaryCleansingCustomPatterns`（空配列）がオブジェクトリテラルとして共有され、PageState インスタンス間で同一配列オブジェクトを指すため
- なぜ気づかなかったか: 通常の `loadSettings` は `pageState.cleansingConfig[prop] = s[key] as string[]` で配列を置換するため汚染が顕在化しにくく、`push` 的な部分更新やテストでの直接変更経路のみで発現するため
- 解: `structuredClone(DEFAULT_CLEANSING_CONFIG)` または `{ ...DEFAULT_CLEANSING_CONFIG, contentStripKeywords: [...DEFAULT_CLEANSING_CONFIG.contentStripKeywords], aiSummaryCleansingCustomPatterns: [...DEFAULT_CLEANSING_CONFIG.aiSummaryCleansingCustomPatterns] }` で深い複製に修正

## BDD受け入れシナリオ
Scenario: ハッピーパス — 新しい PageState は独立した配列を持つ
  Given `DEFAULT_CLEANSING_CONFIG.contentStripKeywords` が 17 要素である
  When `new PageState()` を 2 回生成し、一方の `cleansingConfig.contentStripKeywords.push('__test__')` を実行する
  Then 他方の `cleansingConfig.contentStripKeywords` は `__test__` を含まず、`DEFAULT_CLEANSING_CONFIG` も汚染されない

Scenario: 境界 — 空配列プロパティも独立して複製される
  Given `aiSummaryCleansingCustomPatterns` が空配列である
  When 1つの PageState で `cleansingConfig.aiSummaryCleansingCustomPatterns = ['a']` を代入する
  Then 別インスタンスと `DEFAULT_CLEANSING_CONFIG.aiSummaryCleansingCustomPatterns` は空配列のままである

Scenario: 回帰 — loadSettings 後の配列置換が他インスタンスに影響しない
  Given 2つの PageState インスタンスが存在する
  When 片方で `loadSettings` 相当の配列置換を行う
  Then もう片方の配列は元のままである

## 受け入れ基準
- [x] `src/content/pageState.ts:109` の初期化がシャローコピーではなく独立コピーになっている（`structuredClone` または配列スプレッドによる複製）
- [x] `contentStripKeywords` と `aiSummaryCleansingCustomPatterns` の両方がインスタンス間で参照共有されない
- [x] `DEFAULT_CLEANSING_CONFIG` がいずれの PageState 変更でも汚染されない
- [x] `npm run type-check` がパスする
- [x] 既存テスト `src/content/__tests__/pageState.test.ts` がパスする（必要に応じて汚染回帰テストを1件追加）

## テスト戦略
- 単体: `PageState` の独立性テスト — 2インスタンス生成 → 片方 push → もう片方と DEFAULT が汚染されないことを `expect(...).not.toContain` で検証。`structuredClone` 使用時は `contentStripKeywords` の要素数・内容が維持されることも検証
- 統合: `loadSettings` 経由で配列が置換された後に別インスタンスが影響を受けないこと
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
