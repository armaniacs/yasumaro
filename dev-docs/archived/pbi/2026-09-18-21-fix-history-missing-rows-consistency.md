# PBI: 履歴パネルのトークン・PII・AI要約行を欠測時も一貫表示する

## ユーザーストーリー
履歴を見る人として、トークン行・PIIマスキング行・AI要約クレンジング行を全エントリで一貫して見たい、なぜならEpson Setup Naviのように行自体が消えるエントリがあると不具合か仕様か判断できず混乱するから

## ビジネス価値
- 履歴パネルへの信頼を維持する。正常に見えるCNNエントリと行欠落のEpsonエントリの差が「予期しない変化」に見える問題を解消する
- PBI 2026-09-18-20（バー一貫表示）の残課題を閉じる。診断行全体で表示位置が安定する
- 測定方法: 欠測エントリでも3行の領域が維持され理由が表示されること、正常エントリの表示が変わらないこと

## BDD受け入れシナリオ

```gherkin
Scenario: AIなし記録でもトークン行が理由付きで表示される
  Given AI要約なしで記録した履歴がある
  When 履歴パネルでそのエントリを見る
  Then トークン行の位置に計測なし（AIなし記録）の理由が表示される
  And 正常エントリと同じ位置に行領域が存在する

Scenario: AIなし記録でもPIIマスキング行が理由付きで表示される
  Given AI要約なしで記録した履歴がある
  When 履歴パネルでそのエントリを見る
  Then PIIマスキング行の位置に計測なし（AIなし記録）の理由が表示される

Scenario: AIなし記録でもAI要約クレンジング行が理由付きで表示される
  Given AI要約なしで記録した履歴がある
  When 履歴パネルでそのエントリを見る
  Then AI要約クレンジング行の位置に計測なし（AIなし記録）の理由が表示される

Scenario: 正常エントリの表示が変わらない
  Given トークンとバイト計測がある履歴エントリがある
  When 履歴パネルでそのエントリを見る
  Then 従来通りの数値表示になる
  And 理由表示は現れない
```

## 受け入れ基準
- [x] トークン欠測時もトークン行領域が消えない（理由ラベル付き表示）
- [x] PII欠測時もPIIマスキング行領域が消えない（理由ラベル付き表示）
- [x] AI要約バイト両側欠落時もAI要約クレンジング行領域が消えない（理由ラベル付き表示）
- [x] AIなし記録と旧記録と空ページを既存3分類（`no-ai` / `unmeasured` / `empty`）の文言で区別する
- [x] 既存の正常エントリの表示が変わらない（数値・文言・順序を維持）
- [x] 日英の両localeで文言が表示される（既存 `historyMissingReason*` 3 keyを再利用、新規keyなし）
- [x] XSS対策として理由文言と数値のescapeを維持する
- [x] 理由行は既存の診断行と同じ文字サイズとコントラストで読み取れる（既存classを再利用）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 固定fixtureの欠測エントリで3行の領域が存在することを確認
- 正常fixtureで従来通りの数値表示になることを確認

### 統合テスト
- `formatDiagnosticMetadataHtml` が欠測時に3行の理由行を含む
- i18nのjaとenでkey解決できる

### 単体テスト
- トークン・provider共に欠落時にトークン理由行が返る（`no-ai`）
- 片側トークンのみの場合に従来通りの数値表示になる
- `masked_count`・`original_tokens`・`cleansed_tokens`共に欠落時にPII理由行が返る
- AI要約バイト両側欠落時にAI要約理由行が返る（両側欠落でも `no-ai` / `unmeasured` / `empty` を区別）
- 片側AI要約バイトのみの場合は従来通り理由行が返る（既存仕様を維持）
- 正常バイトがある場合に理由行が出ない
- 理由判定がescape済みHTMLを返す

## 実装アプローチ
- **Outside-In**: 受け入れシナリオに対応するViewテスト（`sqliteHistoryPanel-formatDiagnosticMetadata.test.ts`）から開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2 （要チームでの見積もり）。内訳は3行の表示分岐と判定関数で1、View分岐と既存テスト更新で1

## 技術的考慮事項
- 依存関係: PBI 2026-09-18-20（バー一貫表示）の実装済み変更の上に積む。競合時は20を先に取り込む
- テスタビリティ: `formatDiagnosticMetadataHtml` は純粋関数で検証できる
- 非機能要件: 追加クエリなし。既存entryのfield判定のみで描画するため性能影響なし
- i18n: 既存の `historyMissingReasonNoAi` / `historyMissingReasonUnmeasured` / `historyMissingReasonEmpty` を再利用し、新規key追加なし。行タイトルは既存の `historyTokens` / `historyPiiMasking` / `historyAiSummaryCleansing` を使う
- セキュリティ: 理由文言は定数とし、数値とprovider名は従来通りescapeHtmlを通す
- アクセシビリティ: 理由行は既存の診断行と同じclass（`history-entry-tokens` / `history-entry-token-reduction` / `history-entry-ai-summary-cleansing`）を使い、スクリーンリーダーで通常行と同様に読み上げできるようにする

## 実装者向け注記

### 現状コードの確認
着手前の必須チェックは本PBI作成時に実施済み（代行検索で合意済み）。未実装ではなく「欠測時は行を作らない仕様」が原因であり、調査タスクではなく仕様変更PBIとして扱う。

```bash
# 機能に関連するキーワードでコードを探す
grep -rn "formatDiagnosticMetadataHtml" src/
grep -rn "classifyAiSummaryMissing" src/
grep -rn "masked_count" src/dashboard/panels/asyncData/
```

確認結果:
- トークン行（`src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:123-145`）は `sent_tokens` / `received_tokens` / `ai_provider` がすべて欠落の場合に行を作らない。PBI 2026-09-18-01で「トークン行は引き続き非表示」と決定した経路。今回はその決定を覆す
- PII行（同 `177-188`）は `masked_count` と `original_tokens` / `cleansed_tokens` が欠落の場合に行を作らない。理由分岐は未実装
- AI要約行（同 `190-201`）は両側欠落の場合に行を作らない（`else if` の片側条件が偽のため）。片側のみの場合は理由行を作る既存仕様あり。両側欠落時の理由表示が未実装
- 判定関数は `historyEntryPresentation.ts` に集約済み。トークン行用の `classifyTokensMissing` とPII行用の `classifyMaskingMissing` は未実装。AI要約行は `classifyAiSummaryMissing` が両側欠落時も `classifyDiagnosticMissing` に委譲するため、そのまま使える
- 既存テスト `sqliteHistoryPanel-formatDiagnosticMetadata.test.ts:99-102` は両側欠落時にAI要約行が出ないことを期待しており、仕様変更に伴い更新が必要

### 実装手順
1. 判定の純粋関数を追加する。トークン行用（`sent_tokens` / `received_tokens` / `ai_provider` の3者が欠落時に `classifyDiagnosticMissing` へ委譲）とPII行用（`masked_count` と両トークンが欠落時に委譲）を `historyEntryPresentation.ts` に置く。AI要約行は既存 `classifyAiSummaryMissing` を両側欠落時にも呼ぶ
2. `formatDiagnosticMetadataHtml` の3分岐を反転する。トークン行・PII行・AI要約行で、数値が出ない場合に `pushReasonRow` で理由行を追加する。行タイトルは既存key（`historyTokens` / `historyPiiMasking` / `historyAiSummaryCleansing`）を使う
3. 既存テストを更新する。両側欠落時の非表示期待を新仕様に合わせ、3行の理由表示ケースを追加する
4. locale追加は不要。既存 `historyMissingReason*` の再利用を優先し、新規keyは作らない

### 落とし穴
- PBI 2026-09-18-01のBDDシナリオ「トークン行は引き続き非表示」は本PBIで覆す。旧決定を根拠にレビューで差し戻されないよう、本PBIへのリンクをPR説明に明記する
- 片側トークンのみの場合は従来通り数値表示にする。理由行に変えると正常表示の回帰になる
- `ai_provider` のみある場合のprovider表示分岐（同 `137-145`）は維持する。理由行に変えない
- 理由文言にURLやタイトルなどの可変値を入れない。入れるとXSSの検査範囲が広がる
- 送信データボタン（`content` null時の非表示）は本PBIの対象外。データ自体が存在しないため理由表示のしようがない

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（単体8件＋統合3件、正常系の回帰含む）
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて — E2Eは既存fixture流用で追加なし）
- [x] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後 — 判定関数は `historyEntryPresentation.ts` に集約し単一所有を維持）
- [x] ロールバック手段の検討（表示層のみの変更のため、3行の理由分岐をrevertすれば従来表示に戻る）
- [x] ドキュメント更新済み

## 実装記録
- `src/dashboard/panels/asyncData/historyEntryPresentation.ts`: `classifyTokensMissing` と `classifyMaskingMissing` を新設。AI要約行は既存 `classifyAiSummaryMissing` を両側欠落時にも呼ぶ
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts`: トークン行・PII行・AI要約行の3分岐に理由行を追加。行タイトルは既存key（`historyTokens` / `historyPiiMasking` / `historyAiSummaryCleansing`）、理由文言は既存 `historyMissingReason*` を再利用
- テスト: Red 3件失敗を確認後にGreen化。`historyEntryPresentation.test.ts` に単体8件追加、`sqliteHistoryPanel-formatDiagnosticMetadata.test.ts` に統合3件追加＋正常系2件のデータを補完
- 検証: type-check PASS / asyncData 24 files 291 tests PASS / 全体 780 files 12263 tests PASS
