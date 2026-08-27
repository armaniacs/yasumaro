# PBI: content カバレッジ 90% 達成 (extractor / visitGate)

## ユーザーストーリー
開発者として、content カバレッジを 72.94% → 90% 以上に引き上げたい、なぜなら `extractor.ts:51%` / `visitGate.ts:37%` が全体 Branch 82% を押し下げ、リリースゲートの 80% 閾値を超えても品質保証が不十分だから。

## 優先度
- 順位: 1 / 4
- RICEスコア: 427（Reach=80 / Impact=2 / Confidence=80% / Effort=0.3）
- 根拠: 全ユーザの閲覧処理に影響 (Reach=80)。Statements +17pt で Branch も改善。DOM依存で E2E が必要だが既存 `content-script-recording.spec.ts` を拡張すれば Effort 0.3 で達成可能。

## なぜなぜ分析
- なぜ低いか: `extractor.ts` は `requestAnimationFrame` バッチや `scheduler.yield` を含み jsdom で実行されず、`visitGate.ts` は `chrome.tabs` なしで分岐未達
- なぜ jsdom で未達か: `PageState` / `visitGate` の threshold 判定が純粋関数だが `clock()` 注入なしでテスト不能
- なぜ E2E で補完しなかったか: `opfs-fts5-search` 等は storage 中心で content の 8フラグ組み合わせ (`RecordingPipeline.flags.test.ts` は pipeline 側) をカバーしていない
- 解: `visitGate` に `InMemory` / fake clock を注入した unit + Playwright で `loader.ts` 経由の実DOM抽出 E2E を追加

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常ページで抽出が完了する
  Given 有効な HTML ページがロードされている
  When `loader` が `extractor` を呼び出す
  Then `content` / `title` / `candidateBytes` が取得され `visitGate` で `shouldRecord=true` になる

Scenario: エッジケース — 閾値未満は記録されない
  Given `visit_duration < MIN_VISIT_DURATION` または `scroll_ratio < threshold` のページ
  When `visitGate.shouldRecord` を呼ぶ
  Then `false` を返し `validVisit` が発火しない

## 受け入れ基準
- [x] `src/content/extractor.ts` の Statements が 90% 以上に到達する (現在 51%)
- [x] `src/content/visitGate.ts` の Statements が 90% 以上に到達する (現在 37%)
- [x] `content` ディレクトリ全体の Statements / Branches が 90% 以上になる
- [x] `npx vitest run --coverage` で All files Branches が 82% → 85% 以上に改善する

## テスト戦略
- 単体: `visitGate` に `clock` 注入した 8フラグ組み合わせテスト、`pageState.toVisitGateThresholds()` の境界値テスト、`loader.ts` のスキップ判定 unit
- 統合: `extractor` の `collectKeywordElements` / `countCleanseTargets` を jsdom + `HTMLCanvasElement.getContext` mock で実行
- E2E: `testDir/e2e/content-script-recording.spec.ts` を拡張し `chrome.scripting.executeScript` 経由の実ページ抽出と `VALID_VISIT` メッセージ到達を検証

## 見積もり
3pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npx vitest run --coverage` で content 90% 以上を達成
- [x] コードレビュー完了
- [x] ドキュメント更新済み
