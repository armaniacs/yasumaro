# AI Summary Cleansing — Category A: WordPress Theme Specific Patterns

**Date:** 2026-07-14
**Branch:** feat/ai-summary-cleansing
**Status:** Design (Brainstorming complete)

## Motivation

日本のブログ・メディアの 7-8 割が SWELL / Cocoon / SANGO / JIN 等の国産 WordPress テーマで構築されている。これらのテーマ固有クラス、アフィリエイトプラグイン、ステマ開示表記、レコメンド広告エンジンが AI の要約精度を下げる巨大なノイズ源となっている。既存の jpLayout (#24) / jpNavigation (#25) / author (#26) はパターンが最小限で、デフォルト OFF である。

## Design Decisions

### カテゴリ設計

| サブカテゴリ | ターゲット | 処理 | 既存カテゴリとの関係 |
|-------------|-----------|------|---------------------|
| **A-1: WordPress テーマ固有クラス** | SWELL / Cocoon / SANGO / JIN / Snow Monkey / STINGER | 要素削除 | jpLayout に追加 |
| **A-2: アフィリエイトプラグイン** | Rinker / カエレバ / もしも / ポチップ | プレーンテキスト化（商品名・価格のみ保持） | jpLayout に追加 + helpers 新ユーティリティ |
| **A-3: ステマ規制開示表記** | 広告表示法対応の開示テキスト | 要素削除 | jpLayout に追加 |
| **A-4: 日本レコメンド広告** | PopIn / Logly Lift / Uzou / Outbrain / Taboola | 要素削除 | jpLayout に追加 |
| **A-5: Gutenberg ブロック** | wp-block-button / wp-block-group / wp-block-separator 等 | 要素削除 | deepEnabled に追加 |
| **A-6: 日本ブログ UI コンポーネント** | pagetop / drawer-menu / TOC プラグイン / アクセスカウンター | 要素削除 | jpLayout に追加 |
| **A-7: 吹き出し（会話風）デザイン** | speech-balloon / balloon-box / talk-balloon | キャラ名・アバター削除、発言テキスト保持 | **新カテゴリ** |

### 新規追加パターン

#### A-1: WordPress テーマ固有クラス

```
// SWELL (日本シェア1位)
'swell-toc', 'p-postList', 'c-shareBtns', 'p-relatedPosts', 'c-widget',
'swell-block-', 'swell-block-check', 'swell-block-quote'

// Cocoon (無料テーマ1位)
'author-box', 'author-box-label', 'sns-share', 'related-entry-card',
'toc', 'toc-box', 'sidebar', 'sns-follow-buttons', 'article-outer'

// SANGO / JIN
'entry-card', 'post-list', 'sidebar-widget', 'author-block', 'share-btn',
'entry-utility', 'cat-links', 'tag-links', 'wp-post-image', 'post-thumbnail'

// Snow Monkey
'sm-related-posts', 'sm-author-profile', 'sm-widget', 'sm-entry-summary'

// STINGER
'stinger', 'stingerV8', 'article-footer', 'author-box'
```

#### A-2: アフィリエイトプラグイン

```
// Rinker (SWELL標準)
'yyi-rinker-contents', 'yyi-rinker-box', 'yyi-rinker-title', 'yyi-rinker-text'

// カエレバ / ヨマレバ
'kaerebalink-box', 'kaerebalink-name', 'yomerebalink-box', 'booklink-box'

// もしもアフィリエイト
'moshimo-style-single', 'moshimo-style', 'moshimo-affiliate'

// ポチップ (Pochipp)
'pochipp-box', 'pochi-contents', 'pochipp-card', 'pochipp-btn'
```

**プレーンテキスト化ロジック**: アフィリ要素を削除するのではなく、中の商品名と価格のテキストのみを抽出して残す。

#### A-3: ステマ規制開示表記

```
// クラス名パターン
'ad-disclosure', 'promotion-note', 'pr-disclosure',
'disclosure-area', 'sponsor-info-wrapper', 'pr-note',
'promotion-content', 'sponsored-content-label'

// テキスト正規表現 (記事冒頭の small div/span)
/プロモーション|PR|広告|スポンサー|PR表記|pr表記/i
```

#### A-4: 日本レコメンド広告エンジン

```
// PopIn
'popin_recommend', 'popin_recommend_container', 'popin-recommend',

// Logly Lift
'logly-lift', 'logly-lift-widget', 'logly-widget',

// Uzou
'uzou-recommend', 'uzou-widget', 'uzou-recommendation',

// Outbrain / Taboola (グローバル共通)
'outbrain_carousels', 'outbrain-widget', 'taboola-placeholder',
'taboola-unit', 'taboola-container'
```

#### A-6: 日本ブログ UI コンポーネント

```
// ページトップへ戻る
'pagetop', 'page-top', 'to-top', 'go-top', 'btn-pagetop', 'back-to-top'

// スマホメニュー
'drawer-menu', 'sp-menu', 'hamburger', 'toggle-menu', 'mobile-menu', 'menu-drawer'

// 目次 (TOC) プラグイン
'toc-container', 'rtoc-box', 'toc-box', 'toc', 'toc_list',
'table-of-contents', 'toc-wrapper', 'toc_title'

// アクセスカウンター
'access-counter', 'accesscount', 'pv-counter', 'page-counter'
```

### 新規カテゴリ: A-7 吹き出し

```typescript
// 要素削除対象: キャラ名・アバター
const SPEECH_BUBBLE_REMOVE_PATTERNS = [
  'balloon-meta', 'balloon-avatar', 'talk-name',
  'balloon-icon', 'character-name', 'talk-avatar',
  'comment-name', 'speaker-name', 'chara-name',
];

// 保持対象: 発言テキスト（削除しない）
const SPEECH_BUBBLE_KEEP_PATTERNS = [
  'balloon-text', 'talk-comment', 'comment-text',
  'balloon-body', 'talk-body', 'speech-text',
];

// 要素クエリ: 吹き出し全体の枠
const SPEECH_BUBBLE_CONTAINER_SELECTORS = [
  '.speech-balloon', '.balloon-box', '.talk-balloon',
  '.balloon', '.talk-box', '.chat-bubble',
  '.comment-balloon', '.message-balloon',
];
```

### deepEnabled への追加 (A-5)

既存の `DEEP_CLASS_PATTERNS` に Gutenberg ブロックを追加:

```
'wp-block-button', 'wp-block-group', 'wp-block-columns',
'wp-block-separator', 'wp-block-table', 'wp-block-code',
'wp-block-list', 'wp-block-quote', 'wp-block-image',
'wp-block-gallery', 'wp-block-embed', 'wp-block-cover',
'wp-block-spacer', 'wp-block-pullquote'
```

### StorageKeys 追加

```typescript
AI_SUMMARY_CLEANSING_SPEECH_BUBBLE = 'ai_summary_cleansing_speech_bubble'
```

デフォルト値: `false` (既存パターンに従い、新機能はデフォルト OFF)

## Test Strategy

- `stripJPLayoutPatterns`: 各テーマ固有クラスの削除テスト
- `stripSpeechBubbles`: キャラ名削除 + 発言テキスト保持のテスト
- `countTargets.ts`: 拡張カテゴリのカウント対応
- E2E: 実際の日本ブログサイトでのクレンジング効果確認

---

## Deep Dig Session — 2026-07-14

### Challenged Assumptions

| Assumption | Risk | Finding | Decision |
|------------|------|---------|----------|
| A-2のプレーンテキスト化は既存の要素削除フレームワークで実装できる | High | 全 `strip*` 関数は `safeRemoveElement()` による削除のみ。テキスト抽出＋親要素差し替えは新操作タイプ。A-7吹き出しも同パターンが必要 | `safeReplaceWithText(element, text)` ユーティリティを helpers に追加。`stripAffiliateElements` を独立関数として新設。bodyProtection対応必須 |
| A-5 GutenbergブロックはすべてdeepEnabledに入れるべき | High | deepEnabledはデフォルトOFFで70+破壊的パターンを含む。wp-block-button等の軽微なブロックはdeepEnabledに混ぜるには重すぎる | 装飾/UIブロック(button, separator, spacer, pullquote, image, list, quote, code)はjpLayoutに、構造ブロック(group, columns, cover, table, gallery, embed)はdeepEnabledに分割 |
| 新カテゴリはすべてデフォルトOFFでよい | High | 設計書の前提。しかし recommendEnabled/popupEnabled はデフォルトON。Category Aの目的は日本のブログ7-8割カバーでありデフォルトONの方が目的に合致 | jpLayoutEnabled デフォルトを `true` に変更。ただし既存ユーザーにはマイグレーションで明示的 `false` を書き込み、新規インストールのみ `true` |
| A-7吹き出しを新カテゴリにする価値がある | Medium | 吹き出し処理は「キャラ名削除＋発言テキスト保持」でA-2と共通のテキスト保持パターンだが、削除/保持の2段階処理が必要でjpLayoutの単純削除とは異なる | 新カテゴリとして維持。StorageKey `AI_SUMMARY_CLEANSING_SPEECH_BUBBLE` 新設。デフォルト `false`（jpLayoutEnabledとは独立制御） |
| 提示パターンリストで十分なカバレッジがある | Medium | A-1〜A-6のパターンは主要テーマの既知クラスをカバー。SWELL/Cocoon/SANGO/JINで8割の国産テーマを押さえている | パターンは現状のリストで実装開始。E2Eテストで追加パターンを発見次第追記 |
| countTargets.ts拡張が必須要件 | Low | 現行countTargetsはjpLayout/jpNavigation/author非対応（常に0返却）。UI上の表示には影響するがクレンジング精度には無関係 | 本設計のスコープに含めるが、優先度はstrip実装より後。別PRでの対応も可 |

### Newly Discovered Risks

- **`jpLayoutEnabled` デフォルト true 化による既存ユーザー挙動変更**: マイグレーションで既存ユーザーには明示的 `false` を保存する仕組みが必要。マイグレーションコードの実装漏れリスク。
- **`safeReplaceWithText` と bodyProtection の相互作用**: bodyProtection がマークした要素の子孫でテキスト抽出する場合、本文保護の意図と衝突しないか検証が必要。
- **A-5分割のメンテナンス境界**: jpLayout/Gutenberg/deepEnabled の3つにGutenbergパターンが分散する。将来的なブロック追加時にどのゲートに入れるかの判断基準をドキュメント化する必要がある。

### Unresolved Questions

- A-2 のプレーンテキスト化で抽出するテキストの粒度: 商品名＋価格のみか、説明文も含めるか。実装時に実データを見て判断。
- A-7 吹き出しの `SPEECH_BUBBLE_KEEP_PATTERNS` がヒットしなかった場合のフォールバック: 吹き出し全体を削除するか、テキストを全抽出するか。
- A-3 の正規表現 `/(プロモーション|PR|広告|スポンサー)/i` が記事本文中の正当な言及（「PR施策の事例」等）を誤検出するリスク。text length threshold による緩和を検討。

### Decisions

1. A-2 アフィリエイト: `safeReplaceWithText()` ユーティリティ新設 + `stripAffiliateElements` 独立関数。jpLayoutEnabled とは独立ゲート（A-2専用のStorageKeyを新設）
2. A-5 Gutenberg: jpLayout に `['wp-block-button', 'wp-block-separator', 'wp-block-spacer', 'wp-block-pullquote', 'wp-block-image', 'wp-block-list', 'wp-block-quote', 'wp-block-code']`、deepEnabled に `['wp-block-group', 'wp-block-columns', 'wp-block-table', 'wp-block-gallery', 'wp-block-embed', 'wp-block-cover']`
3. jpLayoutEnabled デフォルト: `true`（新規ユーザーのみ。既存ユーザーはマイグレーションで明示的 `false` を保存）
4. A-7 吹き出し: 新カテゴリ、独立 StorageKey、デフォルト `false`
5. A-6 日本ブログUI: jpLayout に統合、jpLayoutEnabled ゲートに従う
6. `countTargets.ts` 拡張: 本スコープに含めるが strip 実装より後回し可
