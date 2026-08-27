# PBI: TextSimilarity 深いモジュールの抽出

## ユーザーストーリー
開発者として、`contentDeduplicator:22` と `sentenceExtractor:34` の重複 `splitSentences/containsJapanese/getBigrams/toWordSet/jaccardSimilarity` を `textSimilarity` 深いモジュールに一本化したい、なぜなら byte 同一ロジックのコピペで二重保守になり、`sentenceExtractor` の `Map<string,number[]>` キーで同文重複が潰れるバグが `toWordSet` の言語間閾値 `0.3` と組み合わさって再現困難だから。

## 優先度
- 順位: 4 / 7
- RICEスコア: 200（Reach=40 / Impact=1.5 / Confidence=70% / Effort=0.20）
- 根拠: `contentDedup` と `sentenceExtractor` は全抽出で実行。`Map` キー潰れは日本語 bi-gram で顕在化し閾値 `0.3` が言語間で非自明に変動。

## なぜなぜ分析
- なぜ重複か: 両者の `splitSentences/containsJapanese/getBigrams/toWordSet/jaccardSimilarity` は byte 同一ロジックのコピペ
- なぜ気づかないか: 各モジュール単体テストでは重複文の `Map` キー潰れが再現しない
- 解: `src/utils/text/tokenizer.ts` + `similarity.ts` に一本化。`contentDeduplicator` と `sentenceExtractor` は import するだけに。`Map<string,idx>` で重複文を分離

## BDD受け入れシナリオ
Scenario: ハッピーパス — 重複文が正しく分離される
  Given 同文が2つあるテキストを渡す
  When `buildSentenceGraph` を呼ぶ
  Then 頂点が潰れずに 2つの独立した頂点として扱われる

Scenario: エッジケース — 日本語 bi-gram が正しく混ざらない
  Given 日本語と英語が混在する文を渡す
  When `toWordSet` を呼ぶ
  Then `words` と `bigrams` が無差別に混ざらず、閾値 `0.3` が言語間で安定する

## 受け入れ基準
- [ ] `toWordSet`/`splitSentences`/`jaccardSimilarity` が `src/utils/text/tokenizer.ts` + `similarity.ts` に一本化されている
- [ ] `contentDeduplicator` と `sentenceExtractor` はそれを import するのみ
- [ ] `Map<string,idx>` で重複文が分離されている

## テスト戦略
- 単体: `tokenizer` の `splitSentences`/`toWordSet` の重複文テスト
- 単体: `similarity` の `jaccard` の言語間閾値テスト
- 統合: `contentDeduplicator` と `sentenceExtractor` の連携テスト
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
