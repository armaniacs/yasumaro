# PBI: AiSummaryCleaner — 32ルール表の浅い分散を深い Cleaner moduleに

## ユーザーストーリー
開発者として、`clean(html, opts) → CleanResult` の1メソッドだけを知れば要約のクレンジングが完結する深い `AiSummaryCleaner` module がほしい、なぜなら現在の `CLEANSING_RULES` 表が `storage/defaults.ts` / `rules.ts` / `content/pageState.ts` 等10層に手書き重複し、うち3表で既定値が7ルール食い違い（v6.7.29で修正）、`buildExtractionOptions` 6フラグ→`CleanseOptions` 変換と `content/extractor.ts` 46行のキー一覧にバグが潜むが、各ルールは純粋関数としてテストしやすく真のバグの locality が無いから

## 優先度
- 順位: 03 / 05
- RICEスコア: 1050（Reach=600 / Impact=2 / Confidence=70% / Effort=0.8）
- 根拠: Reachは要約利用者（600/1000）、Impactは中（要約品質に影響）、Confidenceは[6.7.29]で7ルールの食い違いを検出済みで中程度、Effortは表の集約と migration 隠蔽で0.8人月。

## なぜなぜ分析
- **疑問**: なぜ 32ルールの既定値が3表で食い違うのか → なぜ: 同一の表が10層に手書きコピーされ、単一ソースが無いから
- **なぜ** `newUserDefault` と `defaultEnabled` が別概念なのか → なぜ: `deep`/`linkDensity` 等7ルールは新規ユーザーには有効だが既存ユーザーは `migration.ts` で無効化する段階的ロールアウトの対象で、2値が意図的に異なるが表に明記されていないから
- **解**: `AiSummaryCleaner` の seam 背後に表と二重既定値と migration を隠蔽し、`clean()` の1 seam で完結させる

## BDD受け入れシナリオ
Scenario: 32ルールの往復が1 seamで検証できる
  Given 任意の `html` と `CleanseOptions`
  When `cleaner.clean(html, opts)` を呼ぶ
  Then 期待されるクレンジング結果が返り、32ルールが正しく適用される

Scenario: 新規ユーザーと既存ユーザーの既定値が正しく分岐する
  Given `deep` ルールが `newUserDefault=true` / `defaultEnabled=false` の状態
  When 新規ユーザーと既存ユーザーで `getSettings()` を呼ぶ
  Then それぞれ正しい既定値が返る

Scenario: ルール追加が表1箇所で完結する
  Given 新しいクレンジングルールを追加する
  When `CLEANSING_RULES` 表に1行追加する
  Then `content/pageState.ts` の37分割代入や `aiSummaryCleansingSettingsV2` の5箇所を手書きで直す必要がない

## 受け入れ基準
- [ ] `AiSummaryCleaner` の外部 interface が `clean(html, opts)` のみに集約されている
- [ ] `CLEANSING_RULES` 表が単一ソース化され、`newUserDefault`/`defaultEnabled` が明記されている
- [ ] `content/pageState.ts` の37分割代入と `aiSummaryCleansingSettingsV2` の5箇所が表からの導出に置換されている
- [ ] 32ルール往復テストが `clean()` 越しにパスする

## テスト戦略
- E2E: 実際のページでコンテンツ抽出 → クレンジング → AI要約の一連の流れを検証
- 統合: `AiSummaryCleaner` + 実 `html` サンプルで32ルールの協調動作を検証
- 単体: 各ルールの純粋関数は internal seam として `clean()` 越しに間接的に検証。個別ヘルパーの単体テストは削除または内部テストに格下げ

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] 10層の手書き重複が `grep` で検出されないこと
