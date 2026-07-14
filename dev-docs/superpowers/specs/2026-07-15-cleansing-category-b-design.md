# AI Summary Cleansing — Category B: Site-Type Specific Patterns (News/EC/QA/Video)

**Date:** 2026-07-15
**Branch:** feat/ai-summary-cleansing
**Status:** Design

## Motivation

Category A（WordPress テーマ固有パターン）はブログ・メディアの見た目（jpLayout）をカバーするが、日本語圏で頻繁に閲覧されるニュース・EC・Q&A・動画プラットフォームには、それぞれ固有のUIコンポーネントが存在し、AI要約のノイズとして未カバーである。

既存の `stripPlatformNoise` / `stripRecommendSections` / `stripCardElements` は一部のパターン（`ranking`, `related`, `card` 等）を汎用的にカバーしているが、サイト種別ごとの固有語彙（レビュー・バリエーション選択・ベストアンサーバッジ等）は含まれていない。

## Design Decisions

### カテゴリ設計

| サブカテゴリ | 対象サイト例 | ゲート（StorageKey） | デフォルト（新規ユーザー） |
|---|---|---|---|
| **B-1: ニュースメディア** | Yahoo!ニュース、各社ニュースサイト | `newsMediaEnabled` | `true` |
| **B-2: EC・通販** | 楽天市場、Amazon、Yahoo!ショッピング等 | `ecSiteEnabled` | `true` |
| **B-3: Q&A・知恵袋** | Yahoo!知恵袋、教えて!goo等 | `qaSiteEnabled` | `true` |
| **B-4: 動画プラットフォーム** | ニコニコ動画、Abema、DMM等 | `videoSiteEnabled` | `true` |

Category A の `jpLayoutEnabled` と同じ移行方針を踏襲する: 新規インストールのみデフォルト `true`、既存ユーザーには `migration.ts` で明示的 `false` を保存する。

### スコープ外（既存実装で対応済み）

国産レコメンド広告エンジン（PopIn / Logly Lift / Uzou / Outbrain / Taboola）は Category A-4 として既に `stripJPLayoutPatterns`（`jpLayoutEnabled` ゲート）に実装済みのため、本設計では扱わない。「関連記事を装う」という性質はB-1と重なるが、既存の実装済みパスに委ねる。

### B-1: ニュースメディア パターン

新規追加のみ（既存の `stripRecommendSections` 等と重複する語彙は除外）。

| パターン | 意味 |
|---|---|
| `disqus`, `yahoo-comment`, `comment-count` | コメント欄・リアクション欄 |
| `related-article-card`, `article-ranking`, `read-also` | 関連記事カード群 |
| `article-credit`, `byline-source`, `delivery-source` | 記者・配信元クレジット表記 |
| `live-timestamp`, `update-timeline`, `breaking-badge` | 速報・更新タイムライン表示 |

### B-2: EC・通販 パターン

| パターン | 意味 |
|---|---|
| `review-list`, `star-rating`, `review-count`, `rating-star` | レビュー・星評価欄 |
| `variation-selector`, `color-swatch`, `size-selector`, `quantity-selector` | バリエーション選択UI（色・サイズ・数量） |
| `frequently-bought`, `also-bought`, `bought-together` | 一緒に買われている商品 |
| `shipping-badge`, `stock-badge`, `point-badge`, `free-shipping` | 送料・在庫・ポイント情報バッジ |

### B-3: Q&A・知恵袋 パターン

| パターン | 意味 |
|---|---|
| `best-answer-badge`, `resolved-mark`, `solved-badge` | ベストアンサー・解決済みマーク |
| `related-question-list`, `similar-question` | 関連質問一覧 |
| `answerer-profile`, `answerer-rank`, `responder-badge` | 回答者プロフィール・ランクバッジ |
| `helpful-count`, `good-answer-button` | 覚えておき・いいね数ボタン |

### B-4: 動画プラットフォーム パターン

| パターン | 意味 |
|---|---|
| `nico-comment`, `danmaku`, `comment-flow` | コメント弾幕・実況テキスト |
| `tag-cloud`, `folder-tag`, `video-tag-list` | タグクラウド・フォルダータグ |
| `related-video-card`, `next-video-list` | 関連動画・次の動画カード一覧 |
| `view-count-badge`, `mylist-count`, `member-only-badge` | 再生回数・マイリスト登録数・会員限定バッジ |

### 実装方針

Category A の `stripJPLayoutPatterns` と同じパターンで、`stripExtended.ts` に4つの独立関数を新設する。

```typescript
export function stripNewsMediaPatterns(element: Element): number
export function stripEcSitePatterns(element: Element): number
export function stripQaSitePatterns(element: Element): number
export function stripVideoSitePatterns(element: Element): number
```

- 各関数は `buildClassIdSelectors()` でクラス/IDパターンを結合し、`safeRemoveElement()` で本文保護（bodyProtection）を考慮しながら削除する。
- 既存の `CARD_PATTERNS` / `DEEP_CLASS_PATTERNS` / `jpLayoutPatterns` と重複する語彙（`ranking`, `related`, `card` 等の一般語）は含めない。各カテゴリでサイト固有の複合語のみ追加する。
- `patterns.ts` に4つの新規パターン配列定数（`NEWS_MEDIA_PATTERNS`, `EC_SITE_PATTERNS`, `QA_SITE_PATTERNS`, `VIDEO_SITE_PATTERNS`）を追加し、`stripExtended.ts` から import する。

### 変更ファイル

| File | Change |
|------|--------|
| `src/utils/aiSummaryCleaner/patterns.ts` | 4つの新規パターン配列定数を追加 |
| `src/utils/aiSummaryCleaner/stripExtended.ts` | `stripNewsMediaPatterns` 等4関数を追加 |
| `src/utils/aiSummaryCleaner/types.ts` | `AiSummaryCleanseOptions` / `AiSummaryCleanseResult` に4オプション追加 |
| `src/utils/aiSummaryCleaner/index.ts` | `cleanseAISummaryContent` に4オプションの配線を追加 |
| `src/utils/storage/types.ts`, `src/utils/storage/defaults.ts` | `StorageKeys` に4つの新規キー追加、デフォルト値設定 |
| `src/utils/migration.ts` | 既存ユーザー向けに4キーの明示的 `false` 書き込みを追加 |
| `src/content/extractor.ts` | 4つの新しい `aiSummaryCleansing*` フラグ変数と配線を追加 |
| `src/popup/aiSummaryCleansingSettingsV2.ts` | 設定UIに4つのチェックボックスを追加 |
| `src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts` | 4関数それぞれのテスト追加 |

`countTargets.ts` への反映は本設計のスコープ外とする（Category A同様、既存の技術的負債として別途対応）。

### 影響

| 項目 | 内容 |
|------|------|
| ユーザー影響 | 新規ユーザーはデフォルトONのため、対象サイト閲覧時に即座にノイズ削減効果あり。既存ユーザーはマイグレーションでOFF維持、設定画面から任意にON可能 |
| 設定画面 | `aiSummaryCleansingSettingsV2.ts` に4つの新規チェックボックスを追加（Category A の jpLayout チェックボックスと同様のUI） |
| 誤検出リスク | 低〜中。全パターンが複合語（7文字以上）で構成され単独では発火しにくいが、EC・Q&Aサイトの「レビュー本文」自体は body protection で保護される想定 |

## Test Strategy

- 各 `strip*Patterns` 関数について、対象パターンの削除テストと本文保護（bodyProtection）との相互作用テストを追加
- 既存の `CARD_PATTERNS` / `DEEP_CLASS_PATTERNS` と重複しないことを確認する陰性テスト
- E2E: 実際の対象サイト（Yahoo!ニュース、楽天市場、Yahoo!知恵袋、ニコニコ動画等）でのクレンジング効果確認

## Out of Scope（別途ブレスト予定）

以下は今回のブレストで議論されたが、アーキテクチャ規模が異なるため別設計として切り出す:

- **ドメイン別ホワイトリスト抽出モード**: Togetter、5ちゃんねるまとめブログ、ガールズちゃんねる、Yahoo!知恵袋、小説投稿サイト（なろう・カクヨム）、レシピサイト（クックパッド・クラシル）等、「引き算（ブラックリスト）」では対処しきれないほどノイズ比率が高いサイト向けに、ドメイン検知 + 特定クラスの狙い撃ち抽出（ホワイトリスト方式）+ ページネーション追跡を行う専用抽出アダプタ。現行の `findMainContentCandidates` → strip関数群という「除去型」アーキテクチャとは処理方式が根本的に異なり、独立した設計検討が必要。
- `countTargets.ts` の構造的リファクタリング（strip関数とのパターン定義重複解消）
