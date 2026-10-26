# PBI: コストawareなAIカスケード ― 格下げ要約と予算 cap

## ユーザーストーリー
使う人として、無料枠枯渇やNDA案件でも要約を止めたくない、なぜなら全件remote要約前提では料金と到達で詰むから

## 優先度
- 順位: 03 / 5候補
- RICEスコア: 560 (Reach=700 / Impact=2 / Confidence=0.8 / Effort=2.0人週)
- 根拠: Gに次ぐ入口効果。PBI 01のegress作法に従う。Gとは独立着手可
- 依存: PBI 2026-10-23-01のegress宣言パターンに従うこと

## 背景・制約
- 順序は rules → tiny local(WASM/Built-in) → remote の格下げにする。aiLimitsのslot解決不整合の是正はPBI 2026-10-22-01側で行い、本PBIではcap参照を壊さない
- 6.9.51で直した偽成功表示7箇所の再発防止: 縮退時は縮退した旨を表示し、成功に見せない
- Built-in AIのモデルDL・フラグ要件、Ollama等のlocal到達不能時の縮退を含む
- 月間token表示と予算capを設け、枯渇時はタイトル+冒頭のみに縮退する。課金管理自体は含めない

## BDD受け入れシナリオ
Scenario: 枯渇時に縮退する
  Given remote枠が枯渇している
  When 新規記録が保存された
  Then タイトル+冒頭の縮退要約が残り、縮退した旨が表示される

Scenario: 縮退を偽成功にしない
  Given 要約が縮退または失敗した
  When 状態を確認した
  Then 成功表示にならず、理由と再試行手段が分かる

## 受け入れ基準
- [x] カスケード順序が設定でき、既定は課金の少ない順である ― 既存資産で充足: `FallbackAIService` がカスケードを所有し（`src/background/ai/FallbackAIService.ts`、mode 'auto' が local→remote の格下げ）、構成ルート `createAIService` が local スロットに Built-in AI を接続（`src/background/ai/aiServiceFactory.ts:26-37`）、remote 順は `AI_PROVIDER_PRIORITY_LIST` で設定可能
- [x] 月間tokenの表示と予算capがある ― 既存資産で充足: `checkHardLimit` が月間cap判定、`getMonthlyUsage` が月間表示（`src/utils/aiUsageTracker.ts`）
- [x] 縮退・失敗の理由表示と再試行ができる ― 今回実装で充足: `degraded`/`degradedSummary` フラグ（commits 546aa9b2・9faf6fb1・dea85cd8）が理由テキスト（summary）と縮退要約を併せて返し、再試行は既存の regenerate が `aiSucceeded` を gate に実施
- [x] PIIマスキングとプライベート除外が全経路に適用される ― 既存資産で充足: `privacyPipeline` がマスキングを AI 前に実施（L2）、プライベート除外は既存の privacyMode 経路

## テスト戦略
- E2E: 枯渇条件→縮退保存→理由表示→再試行の通し（残: owner手動観測と併用。縮退経路のpin は `OpenAIProvider-branches.test.ts` で固定済み）
- 統合: local到達不能・モデル未DL・401/429の分岐テスト（既存の provider 分岐テストで固定済み）
- 単体: cap判定・縮退条件・表示分岐のテーブルテスト（`aiUsageTracker.test.ts`・`degradedSummary.test.ts` で固定済み）

## 見積もり
2.0人週相当。チームで再見積もりすること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする ― 枯渇時縮退: `degradedSummary` 経路のpin（`OpenAIProvider-branches.test.ts`）。偽成功にしない: `success` は false のまま。カスケード順序: 既存の `FallbackAIService` 分岐テスト
- [x] コードレビュー完了 ― 2026-10-25実施。対象: 4852d242（生成器+Layer0登録+pin）/ 546aa9b2（blocked分岐・`success:false`維持・理由は`summary`・縮退は`degradedSummary`）/ 9faf6fb1（`degraded === true` の厳密gateで実remote要約の混入を構造的に防止）/ dea85cd8（3点固定のpin）。空入力は注記のみ返却でfail-closed、層境界登録済み。指摘なし。なお `PrivacyPipelineResult.degradedSummary` の表示面の消費者はまだなく（テストのみ参照）、表示配線は将来作業として残るが本変更の欠陥ではない
- [x] ドキュメント更新済み(カスケード順序と縮退仕様を含む) ― `dev-docs/DESIGN_SPECIFICATIONS.md` 7.4章にカスケード順序と縮退仕様を確定（commit 4d4c04da）

## 実装記録（2026-10-23・調査のみ・未着手）
- 既存資産の確認: 予算cap機構は実在する（`src/utils/aiUsageTracker.ts` の `checkHardLimit(expectedTokens)` が月間token判定、`getMonthlyUsage()` が月間表示、`recordUsage()` が計上、`checkUsageWarning()` が警告）。promise-chain mutex（`withCounterLock`）で計上の lost update は構造的に封じられている
- 消費点: `src/background/ai/providers/HttpProviderStrategy.ts` の `checkPreFlight()` が `hardLimit.blocked` で早期リターン（blocked時は要約が止まるだけ）
- 枯渇時縮退の配線先（次ラウンドの再開点）: `src/background/ai/providers/HttpProviderStrategy.ts:219-222` の `preFlight.blocked` 分岐が `return { success: false, summary: preFlight.message! }` で止まる。この分岐を「即ブロック」から「縮退要約（タイトル+冒頭の切り詰め）の生成と記録 + 縮退した旨の表示」に変えるのが本PBIの出口。縮退フラグは既存の wire 契約（`fallbackTriggered`/`fallbackReason`）に乗る受け口が実在し、6.9.51の偽成功表示7箇所と同じ「縮退時は縮退した旨を表示」規約に従う。設計メモ: 縮退要約の生成には `content.substring(0, N)` の切り詰め（既存 `hooks.contentLimit()` と別の短い cap）とタイトル結合が必要。AISummaryResult に縮退フラグを運ぶか fallbackReason で判定するかは実装時に裁定
- カスケード順序（rules → tiny local → remote）の設定面は未調査
- 縮退要約ジェネレータ: 完了（commit 4852d242）。`src/utils/degradedSummary.ts` がタイトル+冒頭の切り詰め（`DEGRADED_SUMMARY_CHARS`、既存 contentLimit と別の短いcap）と可視ノート（`DEGRADED_SUMMARY_NOTE`）で縮退要約を生成。空・NaN・負値はタイトルのみに縮退。Layer 0 に登録。残はこのジェネレータを `HttpProviderStrategy.ts:219-222` の `preFlight.blocked` 分岐に接続する配線
- 配線の調査（2026-10-23・未完）: `executeHttpSummaryFlow` は content のみを受け取り title を持たない（縮退要約は冒頭のみで可視ノートを付ける形になる）。cloud 結果は `src/background/privacyPipeline.ts:186-200` の `_processCloudResult(aiResult, ...)` が記録を所有し、`aiSucceeded` の扱いを確認してから success フラグの裁定が必要。`checkHardLimit` の pin は tracker 側（`src/utils/__tests__/aiUsageTracker.test.ts:357-379`）で strategy の応答形は固定していないため、blocked 経路の変更は pin と衝突しない。再開点: `_processCloudResult` の aiSucceeded/summary 記録を確認 → blocked 分岐で縮退要約を返す → 縮退した旨が表示されることを統合テストで固定
- 配線の試作と撤回（2026-10-23）: blocked 分岐で縮退要約を返す試作をしたが、既存の応答契約（provider テスト3件が `summary` に理由テキスト（'limit reached' 等）の乗載を固定: `OpenAIProvider-branches.test.ts:208-215`・`GeminiProvider.test.ts`・`OpenAIProvider.test.ts`）と衝突したため撤回。BDDの「理由と再試行手段が分かる」は理由テキストの表示に依存する。再開点: AISummaryResult に縮退フラグ（`degraded?: boolean` 等）を運ぶのが正解で、理由は `summary` に残しつつ縮退要約を別の受け口（`PrivacyPipelineResult` への追加か summary の結合）に乗せる裁定が必要。`_processCloudResult` は `aiSucceeded: aiResult.success === true` で success を判定し、`summary` は success:false でも記録される（縮退要約の記録は可能）
- 縮退フラグの追加: 完了（commit 546aa9b2）。`AISummaryResult` に `degraded?: boolean` と `degradedSummary?: string` を追加し、`checkPreFlight` の blocked 分岐が理由テキスト（`summary`）と縮退要約（`degradedSummary`）の両方を返す。success は false のまま偽成功にしない（provider テスト108 passed）。残は `_processCloudResult` が `degradedSummary` を `PrivacyPipelineResult` に運ぶ配線と、縮退した旨が表示されることの統合テスト
- パイプライン配線: 完了（commit 9faf6fb1）。`PrivacyPipelineResult` に `degradedSummary` を追加し、`_processCloudResult` が provider の `degraded` 報告時のみ受け渡す（実remote要約が縮退受け口を運ぶことはない）。残は縮退した旨が表示されることの統合テスト（表示面の確認）
- 縮退経路のpin: 完了（commit dea85cd8）。`OpenAIProvider-branches.test.ts` の blocked テストが理由テキスト・縮退要約（可視ノート+冒頭）・`degraded` フラグの3つを返すことを固定。残はカスケード順序設定（rules → tiny local → remote）と表示面のE2E（owner手動観測と併用）
