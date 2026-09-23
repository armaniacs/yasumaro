# PBI: パイプラインの要約ソース優先順位を selectPipelineText selector に単一所有させる

種別: refactor

## ユーザーストーリー

記録パイプラインを保守する開発者として、要約ソースの優先順位を `selectPipelineText` という単一の selector に集約してほしい。なぜなら優先順位の判定が `extractSentencesStep` と `formatMarkdownStep` の2箇所に分散しており、片側だけ修正されると同一入力から異なる要約が出力される drift が起きるから。

## 優先度

- 順位: 1
- RICEスコア: 32 (Reach 8 / Impact 2 / Confidence 1.0 / Effort 0.5週)
- 根拠: 全記録の要約生成に影響する。drift 実績は `visitPayload` と同型であり、抽出側の等価物として先に単一所有化が必要である。

## ビジネス価値

要約生成の一貫性が保証され、記録される要約と markdown に出力される要約の乖離が構造的に起きなくなる。優先順位の変更点が1箇所に集まるため、将来のソース追加や順序変更時の修正漏れと回帰調査のコストが削減される。

## BDD受け入れシナリオ

```gherkin
Scenario: 抽出文が存在する場合は抽出文を優先する
  Given context に extractedSentences と sanitizedSummary と privacyResult.summary と truncatedContent が全て存在する
  When selectPipelineText により要約テキストを解決する
  Then extractedSentences を join した文字列が選択される

Scenario: 抽出文が無い場合は sanitizedSummary を優先する
  Given context の extractedSentences が空であり sanitizedSummary と privacyResult.summary が存在する
  When selectPipelineText により要約テキストを解決する
  And extractSentencesStep と formatMarkdownStep を同一 context で実行する
  Then 両 step が同一の sanitizedSummary 由来テキストを選択する

Scenario: 上位ソース欠落時は順にフォールバックし最後は固定文言になる
  Given context の extractedSentences と sanitizedSummary が空である
  When selectPipelineText により要約テキストを解決する
  Then privacyResult.summary があればそれを選択し無ければ truncatedContent を選択する
  And 全て空の場合は Summary not available. と byte 等価の文言を返す
```

## 受け入れ基準

- [x] `selectPipelineText(context)` が純粋 selector として1 module に新設され優先順位を単一所有している
- [x] 優先順位 `extractedSentences > sanitizedSummary > privacyResult.summary > truncatedContent` が selector のみで定義されている
- [x] `extractSentencesStep` と `formatMarkdownStep` が選択ロジックを持たず selector への委譲のみになっている
- [x] `formatMarkdownStep` の `Summary not available.` フォールバック文言が変更前と byte 等価であることが golden pin で保証される
- [x] 同一 context に対して両 step が同一テキストを選択することが parity テストで検証される
- [x] 配置決定 (`contentExtractor` 配下または `pipeline` 配下) が design-it-twice の記録とともに確定している

## テスト戦略（t_wadaスタイル・parity/golden pin 先行）

Outside-In で進める。まず現行2箇所の選択結果を固定する parity テストと、`Summary not available.` の byte 等価を固定する golden pin を先に書く (Red)。次に `selectPipelineText` を実装し (Green)、両 step を委譲に置き換えた後も parity と golden が全件 Green のままであることを確認する (Refactor)。単体では優先順位表の全分岐 (4ソースの有無の組み合わせと空文字列境界) を検証し、統合では同一 context を両 step に通して選択結果の一致を検証する。E2E は対象外とし、既存パイプライン統合テストの green で代替する。

## 実装アプローチ

1. 現行の2箇所の分岐を parity テストとして固定し、`Summary not available.` の golden pin を追加する
2. 純粋関数 `selectPipelineText(context)` を1 module に新設する
3. 優先順位 `extractedSentences > sanitizedSummary > privacyResult.summary > truncatedContent` を selector 内に単一所有させる
4. `extractSentencesStep` の入力選択と `formatMarkdownStep` の summary 解決を selector への委譲に置き換える
5. 配置 (`contentExtractor` 配下または `pipeline` 配下) は実装時に design-it-twice で比較裁定し、選択理由を記録に残す

## 見積もり

2pt (0.5週)

## 技術的考慮事項

- `selectPipelineText` は純粋関数とし、logging や storage への副作用を持たせない。`RecordingContext` の読み取り専用入力から文字列のみを返す
- 空文字列と undefined は同値の欠落として扱い、呼び出し側の `||` 連鎖と同等の falsy 判定を selector 内に閉じ込める
- `formatMarkdownStep` のフォールバック文言は表示文字列であり、ピリオド1文字の差異も回帰になるため byte 等価を維持する
- 配置は依存方向で決める。`pipeline` 配下に置けば step 側の import が短くなり、`contentExtractor` 配下に置けば抽出ドメイン知識側に寄る。循環参照を作らない方を選ぶ

## 実装者向け注記

- `src/background/pipeline/steps/extractSentencesStep.ts:38-40` に入力選択が分散している。コメントの priority 宣言 (`sanitizedSummary > privacyResult.summary > truncatedContent`) と実装 `const contentToExtract = sanitizedSummary || privacyResult?.summary || truncatedContent || '';` がこの step 側に閉じている
- `src/background/pipeline/steps/formatMarkdownStep.ts:21-30` に要約解決が分散している。`extractedSentences` 優先分岐の後に `sanitizedSummary || privacyResult?.summary || 'Summary not available.'` の二重定義があり、前者と順序の責務が重複している
- `src/utils/contentExtractor/types.ts:36-67` の `ExtractResult` は 20超の optional field (`content`、`cleansedReason`、`hardStripRemoved`、`aiSummaryCleansedReason`、`fallbackReason`、`originalContent` など) を列挙するだけで、どの field を要約ソースとして優先するかの順序を所有していない。優先順位の置き場所はここではなく新設 selector である
- 故障シナリオ: 優先順位が片側だけ修正されると、録画される要約と markdown に出る要約が同一入力で異なる。これは `visitPayload` 問題の抽出側等価物である

## Definition of Done

- [x] 全BDDシナリオが実装されパスしている
- [x] コードレビューが完了している
- [x] 統合検証が green である
