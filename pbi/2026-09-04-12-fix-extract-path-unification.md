# PBI 12: contentExtractor 3 経路の統一と returnInfo フラグの撤去

優先度: 2 位 / RICE 38.4 = (12 × 2 × 80%) / 0.5w / Strength: Strong
backlog: [2026-09-04-00-backlog-arch2.md](2026-09-04-00-backlog-arch2.md)
依存: なし（PBI 16 は本 PBI 後に同ファイルへ着手）

## ユーザーストーリー
自動保存の抽出パイプラインを保守する開発者として、3 経路（cleanse+AI / AI-only / body fallback）が 1 つの抽出パイプラインに集約されてほしい。なぜなら fallback ブロックが 2 重複し、12 箇所の `if (returnInfo)` がバイト会計を散在させ、経路ごとの挙動差がデバッグコストになっているから。

## BDD受け入れシナリオ

```gherkin
Scenario: 3 経路が同一の fallback ポリシーを使う
  Given 各経路で本文が fallbackRatio を下回る状態を作る
  When  extractMainContent を実行する
  Then  3 経路とも cleansedReason とフォールバック先が同一ロジックから決まる

Scenario: returnInfo を渡さなくても诊断情報が取れる
  Given 呼び出し側が returnInfo を渡さない
  When  extractMainContentWithInfo を実行する
  Then  ExtractResult に全診断フィールドが入る
  And   extractMainContent は string のみを返す
```

## 受け入れ基準
- [ ] fallback ブロックの重複（:342-376 vs :454-488）が 1 箇所になる
- [ ] `if (returnInfo)` ゲートが 12 箇所からゼロになる（ByteMeter または WithInfo 分割に置換）
- [ ] `optionBuilder.ts` の `returnInfo: true` が不要になる
- [ ] 既存 contentExtractor suite（~280 tests）が green
- [ ] クレンジング結果・診断フィールドが変更前とバイト一致

## テスト戦略（t_wadaスタイル）
### 統合テスト
- pageContentPipeline の 4 シナリオが無修正で green
### 単体テスト
- extractPipeline.applyFallback: 3 経路共通の fallback 判定を直にテスト
- extractMainContent（string）/ extractMainContentWithInfo（ExtractResult）の分離
### 例外ハンドリング
- 候補 0 件・body 不在・クレンジング例外の経路

## 実装アプローチ
- **Outside-In**: pageContentPipeline が `typeof result === 'string'` 分岐をしなくなる形から設計 → extractPipeline 抽出 → 経路置換

## 見積もり
0.5w

## 技術的考慮事項
- 依存関係: PBI 16 は本 PBI 後に着手（同一ファイル）
- テスタビリティ: ByteMeter を注入可能に（診断 off = no-op）
- 非機能要件: ホットパス（全 autosave）。挙動変更は禁止（リファクタリング）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "returnInfo" src/utils/contentExtractor/index.ts src/utils/contentExtractor/optionBuilder.ts src/utils/pageContentPipeline.ts
rg -n "runAiSummaryCleanse|_isTooShort|_overCleansed" src/utils/contentExtractor/index.ts
```
2026-09-04 時点: returnInfo ゲート 12 箇所、3 経路の runAiSummaryCleanse 呼び出し 3 箇所、fallback 2 重複、preAiBytes 計算 3 箇所。**重要**: `optionBuilder.ts:35` が常に `returnInfo: true` を渡すため、PBI 04 の measureBytes ゲートは本番で無効（診断は常に有効）。本 PBI でこの矛盾も解消する。

### 実装手順
1. `extractPipeline.ts` を新設: `resolveSource(candidates, body)` / `cleanseClone(clone, opts)` / `applyFallback(content, ctx)` / `ByteMeter`
2. `extractMainContentWithInfo`（ExtractResult 常時）と `extractMainContent`（string ラッパ）に分割
3. 3 経路を applyFallback 共通化で書き換え（1 経路ずつ、各ステップで既存テスト green）
4. optionBuilder から returnInfo を削除、pageContentPipeline の typeof 分岐を削除
5. archived `2026-08-23-07-refactor-return-info-trap.md` の完遂として INDEX 履歴に注記

### 落とし穴
- `_overCleansed` 判定は `aiSummaryOriginalBytes`（preCleanseText のバイト）を使う — PBI 04 でゲート化した値。ByteMeter 移行時に 0 になるとフォールバック判定が変わる（回帰テスト: newsIntegration の本文保護ケース）
- `content = document.body?.innerText` フォールバックは jsdom で innerText 非実装の可能性 — 既存挙動を壊さないこと
- ~100 テスト呼び出し site が returnInfo を直接渡している — 互換のため旧引数は受理しつつ無視するか、テストをまとめて移行する（後者を推奨）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] contentExtractor + pageContentPipeline 全テスト green
- [ ] コードレビュー完了
- [ ] ドキュメント更新（DESIGN_SPECIFICATIONS の contentExtractor 節があれば同期）
