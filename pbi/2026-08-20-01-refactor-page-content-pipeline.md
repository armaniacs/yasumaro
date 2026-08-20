# PBI: Page Content Pipeline への統合 — 10モジュール 3,600行を1 seamに集約

## ユーザーストーリー
開発者として、`contentExtractor`（480行）と `aiSummaryCleaner`（stripCore 522行 + stripExtended 1,008行 + helpers/patterns 等、合計約3,600行）が10の shallow モジュールに分散している状態を解消したい。なぜなら、1ページのコンテンツ準備を理解するのに `optionBuilder → extractor → classifier → whitelistAdapters → stripCore → stripExtended` と6ファイルを跨いで読む必要があり、サイト固有のクレンジング不具合の修正が複数ファイルに散らばるからだ。

## 優先度
- 順位: 01 / 5
- RICEスコア: (Reach=10 × Impact=3 × Confidence=0.8) / Effort=4 = 6.0
- 根拠: Reach 10（全ページの録画・プレビュー・content script が通過するコアパス。1日あたり全ユーザーの全訪問が影響）。Impact 3（AI要約品質とページ表示品質に直結し、誤ったクレンジングはユーザーのObsidian保存内容を直接汚染する）。Confidence 80%（パターンは明確 — 既存10モジュールは全て in-process 純粋関数で、外部依存なし。deepening の seam 位置は自明）。Effort 4人日（10モジュールの内部化 + 2箇所の呼び出し元移行 + テスト移行）。前波 v6.7.60 で `extractPageContent` の pageState 結合は解消済みだが、呼び出し側のオーケストレーションは依然分散しており、本PBIがその残余を集約する。

## ビジネス価値
- AI要約の品質向上: クレンジング漏れ・過剰削除のバグを1モジュールで修正でき、サイト対応の追加が1箇所で完結する。1バグ修正が全呼び出し元に即座に反映される（leverage）。
- 開発速度: 新しいニュース/EC/QA/動画サイトパターン追加時に、10ファイルを理解せず1ファイルの pattern テーブルだけを変更すればよい。
- 測定方法: 主要10サイト（ニュース3/EC2/QA2/動画1/5ch2）の抽出結果をスナップショットテストし、PBI前後で差分ゼロを保証。将来のサイト追加時はテスト1件追加でカバー。

## BDD受け入れシナリオ

```gherkin
Scenario: 単一 seam でページ内容が準備される
  Given HTML文字列とURLが与えられる
  When PageContentPipeline.prepare(html, url) が呼び出される
  Then タイトル・本文・readingTime・siteHints を含む PageContent が返却される
  And 呼び出し元は optionBuilder / classifier / whitelistAdapters を直接知る必要がない

Scenario: サイト固有のパターンが内部で処理される
  Given Amazon / 5ch / YouTube など既存パターンに該当するHTMLが与えられる
  When prepare() が呼び出される
  Then 該当する stripExtended / platform / popup パターンが自動で適用され、広告・ナビ・レコメンド要素が除去された本文が返る

Scenario: 純粋性が保証される — pageState への副作用なし
  Given 任意のHTMLとURLが与えられる
  When prepare() を複数回呼び出す
  Then グローバルな pageState や DOM への副作用が発生せず、同じ入力は常に同じ出力を返す
  And 既存の extractPageContent 純粋性テストがパスし続ける

Scenario: 不正なHTMLでもクラッシュしない
  Given 空文字・null相当・巨大HTML（1MB超）・閉じタグなしHTMLが与えられる
  When prepare() が呼び出される
  Then 例外を投げず、可能な範囲で best-effort の PageContent または空の PageContent が返る
```

## 受け入れ基準
- [ ] `PageContentPipeline` モジュールが `src/utils/pageContentPipeline.ts`（または `src/utils/contentExtractor/` 配下の統合エントリ）に作成される。公開 interface は `prepare(html: string, url: string, hints?: PrepareHints) => PageContent` のみ。
- [ ] 既存の10モジュール（`contentExtractor/index.ts`, `aiSummaryCleaner/stripCore.ts`, `stripExtended.ts`, `helpers.ts`, `patterns.ts`, `classifier.ts`, `scoring.ts`, `optionBuilder.ts`, `whitelistAdapters.ts`, `textExtraction.ts`）の公開 export が削除または `PageContentPipeline` 内部の private seam に移動する。外部から直接 import されることがなくなる。
- [ ] 既存の2箇所の呼び出し元（`src/background/pipeline/steps/extractSentencesStep.ts` 経由の recording パイプライン、`src/content/extractor.ts` の content script）が `PageContentPipeline.prepare()` のみに移行する。
- [ ] `optionBuilder.buildExtractionOptions` の6フラグが `PrepareHints` の1オブジェクトに集約される。呼び出し元が個別フラグを知る必要がなくなる。
- [ ] 既存の `contentExtractor` / `aiSummaryCleaner` 関連テスト（`contentExtractor/__tests__/index.test.ts`, `aiSummaryCleaner/__tests__/*`, `contentCleaner.test.ts`）が `PageContentPipeline` の interface 経由のテストに移行し、パスする。旧 unit テストは削除する（replace, don't layer）。
- [ ] 新規テストは `PageContentPipeline` の interface を test surface とする。HTML in → PageContent out のブラックボックステストであり、内部 helper の単体テストは追加しない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 実際の10サイトのHTMLスナップショットを fixtures として投入し、`prepare()` → `content` が期待される本文を含むことを検証（既存 fixtures を再利用）。

### 統合テスト
- `PageContentPipeline` × 代表的なサイトパターン（NEWS_MEDIA / EC_SITE / QA_SITE / VIDEO / 5ch）の組み合わせで、広告・ナビ・レコメンド除去が正しく行われることを検証。
- content script 経路と pipeline 経路の両方から同じ `prepare()` が呼ばれることを確認。

### 単体テスト
- 本PBIでは単体テストを追加しない — 深いモジュールの内部 helper は private seam であり、interface 経由のテストでカバーする。境界値（空HTML / 巨大HTML / 不正HTML）と例外ハンドリングは interface テストで検証。

## 実装アプローチ
- **Outside-In**: まず `PageContentPipeline` の E2E スナップショットテストを RED にし、既存モジュールを内部に移動して GREEN にする。最後に不要な re-export barrel を削除してリファクタリング。
- **Red-Green-Refactor**: 各サイトパターン（news → ec → qa → video → popup → platform）の移行を1パターンずつ行い、都度テストを GREEN にする。
- **リファクタリング**: GREEN になるたびに `commonStorageFields` 的な共有パターンの重複を除去。

## 見積もり
4人日

## 技術的考慮事項
- 依存関係: なし（in-process 純粋関数群。chrome.* 依存なし）。`pageState` 結合は前波で解消済み。
- テスタビリティ: モジュールは純粋関数なので adapter 不要。入力は HTML 文字列、出力は PageContent。jsdom 環境でテスト可能。
- 非機能要件: パフォーマンス — 現行の `requestAnimationFrame` バッチは content script 側の責務であり、本モジュールは同期的な文字列処理に留める。

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "buildExtractionOptions\|stripCore\|stripExtended\|whitelistAdapters\|contentExtractor" src/ --include="*.ts" | head -40
grep -rn "extractPageContent\|prepare.*html" src/ --include="*.ts" | head -20
```
- 既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。`extractPageContent` は 2026-08-17 に純粋関数化済みだが、呼び出し元の `optionBuilder` 連携は未統合。

### 実装手順
1. `src/utils/pageContentPipeline.ts` を新規作成し、`PageContent` 型と `PrepareHints` 型を定義（`src/utils/contentExtractor/types.ts` を再利用）。
2. 既存の10モジュールを `src/utils/pageContentPipeline/` 配下へ移動し、外部 export を削除。`prepare()` が内部で `buildExtractionOptions → classify → score → whitelist → stripCore → stripExtended` を順に呼ぶように配線。
3. `src/content/extractor.ts` と `src/background/pipeline/steps/extractSentencesStep.ts` の呼び出しを `PageContentPipeline.prepare()` に置換。
4. 既存テストを `pageContentPipeline.test.ts` の interface テストに移行し、旧 unit テストを削除。
5. 不要な barrel export（`src/utils/aiSummaryCleaner/index.ts` の再 export 等）を削除。

### 落とし穴
- `stripExtended.ts` のセレクタ文字列はモジュール初期化時に `buildClassIdSelectors` で構築される — 移動時に初期化順序を壊さないこと。
- `isFixedOrSticky` / `isLikelyAd` 等の helper は `helpers.ts` に集約されているが、`stripCore` と `stripExtended` で微妙に異なる判定を持つ。統合時に差分を吸収せず、両方のロジックを内部で分岐として保持すること（安易な共通化でリグレッションを生む）。
- 巨大HTML（1MB超）でのパフォーマンス — 正規表現ベースの `NEWS_MEDIA_PATTERNS` が最悪ケースで O(n²) になる可能性があるため、移行時にベンチマークを取る。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（interface テストで主要サイト10件のスナップショットをカバー）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（10モジュールの外部 export 削除、呼び出し元2箇所の移行）
- [ ] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` のコンテンツ抽出セクションを更新）
