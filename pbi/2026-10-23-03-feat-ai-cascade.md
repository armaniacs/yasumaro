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
- [ ] カスケード順序が設定でき、既定は課金の少ない順である
- [ ] 月間tokenの表示と予算capがある
- [ ] 縮退・失敗の理由表示と再試行ができる
- [ ] PIIマスキングとプライベート除外が全経路に適用される

## テスト戦略
- E2E: 枯渇条件→縮退保存→理由表示→再試行の通し
- 統合: local到達不能・モデル未DL・401/429の分岐テスト
- 単体: cap判定・縮退条件・表示分岐のテーブルテスト

## 見積もり
2.0人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(カスケード順序と縮退仕様を含む)

## 実装記録（2026-10-23・調査のみ・未着手）
- 既存資産の確認: 予算cap機構は実在する（`src/utils/aiUsageTracker.ts` の `checkHardLimit(expectedTokens)` が月間token判定、`getMonthlyUsage()` が月間表示、`recordUsage()` が計上、`checkUsageWarning()` が警告）。promise-chain mutex（`withCounterLock`）で計上の lost update は構造的に封じられている
- 消費点: `src/background/ai/providers/HttpProviderStrategy.ts` の `checkPreFlight()` が `hardLimit.blocked` で早期リターン（blocked時は要約が止まるだけ）
- 枯渇時縮退の配線先（次ラウンドの再開点）: `src/background/ai/providers/HttpProviderStrategy.ts:219-222` の `preFlight.blocked` 分岐が `return { success: false, summary: preFlight.message! }` で止まる。この分岐を「即ブロック」から「縮退要約（タイトル+冒頭の切り詰め）の生成と記録 + 縮退した旨の表示」に変えるのが本PBIの出口。縮退フラグは既存の wire 契約（`fallbackTriggered`/`fallbackReason`）に乗る受け口が実在し、6.9.51の偽成功表示7箇所と同じ「縮退時は縮退した旨を表示」規約に従う。設計メモ: 縮退要約の生成には `content.substring(0, N)` の切り詰め（既存 `hooks.contentLimit()` と別の短い cap）とタイトル結合が必要。AISummaryResult に縮退フラグを運ぶか fallbackReason で判定するかは実装時に裁定
- カスケード順序（rules → tiny local → remote）の設定面は未調査
- 縮退要約ジェネレータ: 完了（commit 4852d242）。`src/utils/degradedSummary.ts` がタイトル+冒頭の切り詰め（`DEGRADED_SUMMARY_CHARS`、既存 contentLimit と別の短いcap）と可視ノート（`DEGRADED_SUMMARY_NOTE`）で縮退要約を生成。空・NaN・負値はタイトルのみに縮退。Layer 0 に登録。残はこのジェネレータを `HttpProviderStrategy.ts:219-222` の `preFlight.blocked` 分岐に接続する配線
