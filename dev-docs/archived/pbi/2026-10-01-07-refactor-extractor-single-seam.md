# PBI: 抽出オーケストレータの単一 seam 化

## ユーザーストーリー

保守担当の開発者として、抽出の 3 公開 entry を 1 seam に寄せたい、なぜなら引数 4 個組のどれが診断付き・byte 計測なし・bench 専用かを呼出側が覚える必要があり、fallback 優先順位の知識も closure・builder・pipeline に散るから。

## 優先度

- 順位: 7 / 7（2026-10-01 arch-delivery-loop ラウンド。全体像は [00-backlog-archloop-1001](2026-10-01-00-backlog-1001.md)）
- RICEスコア: 4.8（Reach=6 / Impact=1 / Confidence=0.8 / Effort=1.0）
- 根拠: kernel・VisitReporter・GetContentHandler・test が 1 config 形状に。依存なし。

## 背景

- `src/utils/contentExtractor/index.ts`（441 行、3 entry＋`extractInternal`＋`runCleanseAndExtract` closure）、`src/utils/contentExtractor/extractPipeline.ts`（`ByteMeter`・`applyFallback`・`applyAiCleanseStep`）、`src/utils/pageContentPipeline.ts`（`preparePageContent`）、`src/content/contentKernel.ts`（`extractPageContent`・`extractAndCommit`）。制約: string entry は bench baseline（c1/c4） continuity のため削除は bench 再計測時まで不可。

## BDD受け入れシナリオ

```gherkin
Scenario: 単一 seam から抽出できる
  Given 抽出 config
  When preparePageContent を呼ぶ
  Then ExtractResult が返り fallback 優先順位が守られる

Scenario: legacy entry が adapter として動く
  Given 旧 entry の呼出
  When 実行する
  Then 単一 seam と同一結果が返る
```

## 受け入れ基準

- [x] `pageContentPipeline.preparePageContent` を唯一の外部 seam とする（config-in → `ExtractResult`-out）（本番呼出は contentKernel → preparePageContent の 1 本のみ）
- [x] `index.ts` の旧 entry は内部 seam へ格下げし、`extractMainContentWithInfo` は legacy 互換 adapter、`extractMainContent` string entry は bench 計測 adapter として残す（削除禁止・bench 再計測まで。bench c1/c4 の参照は不変）
- [x] `runCleanseAndExtract` を closure から `extractPipeline.ts` へ移し builder/byte seam の所有者を 1 箇所にする（cleanseContent/extractTextFromElement を値 import、ExtractionReportBuilder は type-only import — ランタイム循環なし。meter 呼び出し順・エンコード回数は完全同一）
- [x] ADR-017（exact-port/parity）を維持し、振舞い変更なし（既存 parity テスト・エンコード回数 pin・fallback 境界 pin は一切変更せず通過）

## テスト戦略

- 単体: seam 越しの fallback 優先順位テスト（`content_overcut` > `over_cleansed` > `short_content`）→ `src/utils/__tests__/pageContentPipeline.seam.test.ts`（新規・優先 pin + AI 診断破棄 pin + legacy adapter parity 4 ケース toEqual）
- 既存: parity 系テストは不変で通ること（既存テストファイルへの変更はゼロ）
- 統合: `npm run validate` が通ること

## 見積もり

1 SP（要チームでの見積もり）

## 実装記録（2026-10-01）

- `extractPipeline.ts`: `runCleanseAndExtract`（clone→クレンジング→pre-AI bytes→AI step→抽出→fallback）を index.ts の closure から移管
- `index.ts`: closure と `settleFallback` を削除、`extractInternal` から pipeline 所有の `runCleanseAndExtract` を呼び出し。モジュールヘッダに seam 階層（preparePageContent=唯一の外部 seam / WithInfo=legacy adapter / string entry=bench adapter / extract=report path 内部 seam）を明記、未使用 import 整理
- `pageContentPipeline.ts`: ドキュメントのみ（実装不変）
- 検証: focused vitest 10 ファイル / 196 tests passed + 旧 entry import 2 ファイル / 5 tests passed、type-check green

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test / build が通る
- [x] コードレビュー完了
