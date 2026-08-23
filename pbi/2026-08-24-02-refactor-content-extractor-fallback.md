---
name: contentExtractor 神オーケストレータから fallback 判定を抽出
type: refactor
priority: 2
rice:
  reach: 15
  impact: 2
  confidence: 0.8
  effort: 1.25
  score: 19.2
depends_on: []
---

## 現象
`src/content/extractor.ts` の `extractMainContent` が約481行で、fallback 判定（candidates 有無 × cleanse on/off × short_content/over_cleansed）の分岐がほぼコピペ重複（`L270-306` と `L352-389`）。`loadSettings` が32 rule の storage→CleansingConfig 変換を再発明し `optionBuilder.ts` と二重 SSOT。

## なぜなぜ分析
1. なぜ fallback 判定が重複するのか → 1つの linear pipeline ではなく clone→cleanse→aiCleanse→textExtract を分岐で組んでいる
2. なぜ loadSettings を再実装するのか → optionBuilder の存在を呼び出し側が知らなかった
3. なぜ leverage が低いのか → クレンジングルール追加時に2箇所修正が必要
→ 解: `resolveFallbackPolicy` / `resolveByteStats` を抽出し linear pipeline に。`loadSettings` を `buildExtractionOptions` + `PageState` factory に委譲し optionBuilder を唯一の adapter に。

## 受け入れ基準
- fallback 判定のコピペ分岐が除去されている
- `optionBuilder` が CleansingConfig 構築の単一ソース
- `src/content/__tests__/extractor.test.ts` 等が合格

## BDD シナリオ
```gherkin
Scenario: クレンジングで空になったら short_content fallback に戻る
  Given 抽出結果が over_cleansed と判定される
  When  resolveFallbackPolicy(result) を評価
  Then  short_content パスを返す

Scenario: 候補が0件なら即 fallback
  Given  candidates が空
  When  resolveFallbackPolicy(result) を評価
  Then  fallback を返す（cleanse を試みない）
```

## DoD
- [ ] resolveFallbackPolicy / resolveByteStats を抽出
- [ ] loadSettings を optionBuilder に委譲
- [ ] type-check / lint / test が PASS

## 結果: deferred（見送り）
主要な重複（32 cleansing rule）は既に `CLEANSING_RULES` から導出され SSOT 化済み（`extractor.ts` の `loadSettings` コメント参照）。残る 481 行 `extractMainContent` からの fallback 判定抽出は content extraction の中核を跨ぐ高リスク変更で、既存の抽出テスト網羅を前提とした慎重な検証が必要。今回のループではリスクを避けるため見送り。次スプリントで `resolveFallbackPolicy` の純粋関数化を単独で着手する。
