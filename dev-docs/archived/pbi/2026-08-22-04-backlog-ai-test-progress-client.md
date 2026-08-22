# PBI (backlog): AI 接続テスト進捗 protocol の client 抽出 — 第2消費者出現時の引き金付き

## ユーザーストーリー
開発者として、TEST_AI 進捗の broadcast listener・改造メッセージガード・runId 相関を `aiTestProgressClient` という deep module に抽出したい、なぜなら protocol 処理が generalSettings 専用モジュールに閉じ込められており、2つ目の UI 面（popup のクイックテスト等）が出た時点で複製を強いられるから

## 優先度
- 順位: 4 / 4（pass 2）— **保留（backlog）**
- RICEスコア: 10（Reach=20 / Impact=0.5 / Confidence=50% / Effort=0.5人週）
- 根拠: 現消費者は connectionTests.ts（434行）の1件のみで deletion test 不合格（1 adapter = hypothetical seam）。第2消費者の出現が real seam の成立条件。即時実施は YAGNI

## 保留条件（トリガー）

以下が発生したら本 PBI を着手する:
1. `connectionTests.ts` が450行を超えてさらに膨張する

> 旧トリガー「popup へのAI接続クイックテスト追加」「diagnosticsPanel への
> TEST_AI 再実行ボタン追加」は却下済み（see
> [2026-08-23-ai-test-progress-client-extraction-rejected.md](../dev-docs/ADR/2026-08-23-ai-test-progress-client-extraction-rejected.md)）。
> 第2消費者が現れる見込みがなくなったため real seam 成立条件は現状満たせない。

## BDD受け入れシナリオ（着手時に RED 化する）

```gherkin
Scenario: subscribe で進捗を受け取り unsubscribe で止める
  Given aiTestProgressClient.subscribe(runId, onProgress) が呼ばれた
  When AI_TEST_PROGRESS broadcast が該当 runId で届く
  Then onProgress に検証済み progress が渡り、unsubscribe 後は呼ばれない

Scenario: 改造メッセージが弾かれる
  Given 悪意ある context から不正 shape の progress broadcast が届く
  When subscribe 中の client が受信する
  Then isAiTestProgressMessage ガードにより onProgress は呼ばれない（現行ガードと同一基準）

Scenario: runId 相関とタイムアウト
  Given 複数タブが異なる runId でテスト中である
  When 自 runId 以外の progress が届く
  Then 破棄され、タイムアウト経過時は onProgress へ timeout 完了が通知される
```

## 受け入れ基準（着手時）
- [x] `src/dashboard/aiTestProgressClient.ts` が subscribe/unsubscribe インターフェースで新設され、listener 登録・shape ガード・runId 相関・timeout を内包する
- [x] `connectionTests.ts` から protocol 関連コード（isAiTestProgressMessage / listener 登録 / 相関処理）が削除され、orchestration + DOM のみになる（435行→404行）
- [x] ガードの単体テストが client モジュール側に移行され、既存テスト件数が維持される（新規8件、既存1889件全パス）
- [x] ~~第2消費者（popup 等）が client 経由で進捗表示を実装できていること（real seam の証明）~~ 対象外化（[2026-08-23-ai-test-progress-client-extraction-rejected.md](../dev-docs/ADR/2026-08-23-ai-test-progress-client-extraction-rejected.md) で popup/diagnosticsPanel の第2消費者化を却下済み。現時点で real seam は成立していないが、行数トリガー発火に伴う実装判断として着手した）
- [x] `npm run type-check` / `npm test` がパスする

## テスト戦略（着手時）
- 単体: subscribe/unsubscribe ライフサイクル、ガード境界（欠損フィールド/過大 index/非文字列 model）、runId 相関
- 統合: connectionTests × client（progress 表示更新）、第2消費者 × client
- E2E: 一般設定で AI 接続テスト実行 → 進捗表示 → 完了までの一連

## 見積もり
1pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（保留中）。着手時は `aiTestResultView.ts`（formatting 専用、84行）との役割分担を維持し、client はデータ受信のみ・view は描画のみに分ける
- 現状のガード実装: `connectionTests.ts:158-179` の `isAiTestProgressMessage`。ブロードキャストは全 extension context に届くため防御は必須 — 抽出時に基準を一切緩めない
- メッセージ定義: `AI_TEST_PROGRESS_MESSAGE_TYPE` は `background/aiTestProgressNotifier.ts` 由来。client はこの型のみに依存し、dashboard 固有の DOM に触れない

## Definition of Done（着手時）
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] リファクタリング完了（connectionTests からの protocol 削除）
- [x] ~~第2消費者による real seam 成立の確認~~ 対象外（上記参照）
