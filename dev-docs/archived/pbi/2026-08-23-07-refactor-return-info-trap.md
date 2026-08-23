# PBI-0823a-07: contentExtractor returnInfo boolean trap 解消

## ユーザーストーリー

開発者として、`extractMainContent(..., returnInfo: boolean)` の union 返りを解消したい。なぜなら `string|ExtractResult` の呼び出し元が毎回 `typeof result === 'string'` で分岐し、`pageContentPipeline.preparePageContent` が薄いラッパなのに直接呼ぶ箇所が残存するから。

## 優先度

- **順位**: 7 / 8
- **RICE**: 96 (Reach 6 × Impact 1 × Conf 80% / Effort 2.0w)
- **根拠**: boolean trap は典型的だが Effort が大きく相対優先度は低い。
- **依存**: なし

## BDD受け入れシナリオ

```gherkin
Scenario: 呼び出し元が union 分岐せずに済む
  Given contentExtractor が分離されている
  When  単純な抽出が必要
  Then  extractMainContent() で string が返る（分岐不要）
  When  詳細情報が必要
  Then  extractMainContentWithInfo() で ExtractResult が返る
```

## 受け入れ基準

- [x] `extractMainContent()` と `extractMainContentWithInfo()` の2メソッドに分割
- [x] `pageContentPipeline.preparePageContent` を唯一の public seam に
- [x] 既存の直接呼び出し箇所を `preparePageContent` 経由に移行
- [x] `npm run type-check` / `npm test` PASS

## 見積もり

8pt（2.0人週）

## Definition of Done

- [x] 全BDDシナリオ PASS
- [x] `string|ExtractResult` union が解消
- [x] コードレビュー完了
