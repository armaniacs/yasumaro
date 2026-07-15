# Domain Whitelist Extraction Mode — 新規アダプタ追加（はてなブックマーク・食べログ）

**Date:** 2026-07-16
**Branch:** feat/ai-summary-cleansing
**Status:** Design

## Motivation

既存の Domain Whitelist Extraction Mode（`whitelistAdapters.ts`）は Togetter・5ちゃんねるまとめブログ・ガールズちゃんねる・Yahoo!知恵袋・なろう/カクヨム・クックパッド/クラシルの6サイトに対応済み。これらは「ブラックリスト（引き算）方式では対処しきれないほどノイズ比率が極端に高いサイト」という明確な基準で選定されている。

今回、同じ基準に当てはまる新規サイトを洗い出した結果、以下2サイトが該当すると判断した。

- **はてなブックマーク**（`b.hatena.ne.jp`）: ブックマークコメントページは、Togetterと同様に大量の関連エントリーリンク・タグクラウド・他ユーザーのブックマーク一覧が本文（コメント）を埋もれさせる構造
- **食べログ**（`tabelog.com`）: レビューページは、広告・地図・店舗の関連情報・他の口コミへのリンクがレビュー本文を圧迫する構造

note・Qiita・Zenn等の技術/創作系ブログプラットフォームも検討したが、既に `article`/`main` タグ等を正しく使い、既存の汎用抽出（`findMainContentCandidates`）+ Category A/B のブラックリスト方式で比較的綺麗に抽出できる可能性が高く、「ブラックリストでは対処しきれない」という適用基準に当てはまらないため、今回の設計からは除外する。OKWave/教えて!goo（知恵袋で代替十分）、ニコニコ生放送コメント専用ページ（既存video-siteパターンで代替十分）も同様の理由で見送る。

## Design Decisions

### アーキテクチャ変更: `WhitelistAdapter` に `metadataPatterns` を追加

既存の `extractWhitelistedContent` は `@username` 形式のメンションと `RT(数字)` 形式のリツイート数を除去する処理がグローバル関数（`stripExtractionMetadata`）としてハードコードされており、Togetter専用の実装になっている。

食べログのレビュー本文には星評価数値（例: `★4.5`）や訪問日付（例: `2026/3/15訪問`）がレビューテキスト内に混入する可能性があるため、サイトごとに異なる除去パターンを持てるよう `WhitelistAdapter` を拡張する。

```typescript
export interface WhitelistAdapter {
    name: string;
    domains: string[];
    detectSelector: string;
    contentSelectors: string[];
    excludeSelectors?: string[];
    metadataPatterns?: RegExp[];  // 新規: サイト固有の除去パターン。未指定時は既存デフォルト（@username/RT）を適用
}
```

`extractWhitelistedContent` 内の `stripExtractionMetadata` 相当の処理は、`adapter.metadataPatterns` が指定されていればそれを使い、`undefined` なら既存のデフォルト配列（`USERNAME_MENTION_PATTERN`, `RETWEET_COUNT_PATTERN`）を適用する後方互換設計とする。既存6アダプタ（Togetter含む）は `metadataPatterns` を明示的に指定せず、現状の挙動を維持する。

### 新規アダプタ定義（推定セレクタ、実装時にE2E検証で調整）

```typescript
{
    name: 'hatena-bookmark',
    domains: ['b.hatena.ne.jp'],
    detectSelector: '.entry-comment-text',
    contentSelectors: ['.entry-comment-text'],
    metadataPatterns: [],  // コメント本文クラスがメタデータと分離済み想定のため除去不要
},
{
    name: 'tabelog',
    domains: ['tabelog.com'],
    detectSelector: '.rvw-item__rvw-comment',
    contentSelectors: ['.rvw-item__rvw-comment'],
    metadataPatterns: [/★\s*[\d.]+/g, /\d{4}\/\d{1,2}\/\d{1,2}訪問/g],
}
```

`metadataPatterns: []`（空配列）は「このサイトは除去パターンなし」を明示する意図的な指定であり、`undefined`（デフォルト適用）とは意味が異なる。`extractWhitelistedContent` はこの区別を型レベルで正しく扱う（`adapter.metadataPatterns !== undefined ? adapter.metadataPatterns : DEFAULT_PATTERNS`）。

### 影響ファイル

| File | Change |
|------|--------|
| `src/utils/contentExtractor/whitelistAdapters.ts` | `WhitelistAdapter` に `metadataPatterns` フィールド追加。`WHITELIST_ADAPTERS` に2アダプタ追加。`extractWhitelistedContent` の除去ロジックをadapter単位で切り替え可能に変更 |
| `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts` | アダプタ数テスト（6→8件）更新。新規2アダプタの `matchWhitelistAdapter`/`extractWhitelistedContent` テスト追加。`metadataPatterns` の指定あり/なし/空配列3パターンのテスト追加 |

`matchWhitelistAdapter`（検知ロジック）・`extractMainContent`への分岐組み込み・StorageKey・migration・UI配線は既存実装済みのため変更不要（アダプタ配列に要素が増えるだけで、既存の全体トグル `whitelistExtractionEnabled` がそのままカバーする）。

### 影響

| 項目 | 内容 |
|------|------|
| ユーザー影響 | `whitelistExtractionEnabled` が有効な全ユーザーに対し、はてなブックマーク・食べログ閲覧時から即座に適用される（既存の全体トグルに追加されるだけで新規設定は不要） |
| 誤検出リスク | 中。セレクタが設計時点の推定値であるため、実際のDOM構造と一致しない場合は0件抽出となり自動的に既存のブラックリスト方式にフォールバックする（安全側に倒れる） |
| 既存6アダプタへの影響 | なし。`metadataPatterns` はオプショナルフィールドであり、未指定の既存アダプタは現状の挙動を完全に維持する |

## Test Strategy

- `WHITELIST_ADAPTERS` の要素数が8件になったことを確認するテスト更新
- `hatena-bookmark` / `tabelog` それぞれについて、ドメイン一致・DOM構造検知（`matchWhitelistAdapter`）のテスト
- `tabelog` の `metadataPatterns` が実際に星評価・訪問日付を除去することを確認するテスト
- `hatena-bookmark` の `metadataPatterns: []` が「除去処理をスキップする」ことを確認するテスト（`undefined` とは異なる挙動であることの確認）
- 既存6アダプタ（特にTogetterの `@username`/`RT` 除去）が `metadataPatterns` 未指定でも従来通り動作することの回帰テスト

## Out of Scope

- note・Qiita・Zenn等、既存の汎用抽出で対応可能と判断したプラットフォームへの拡大
- OKWave・教えて!goo（知恵袋で代替十分）
- ニコニコ生放送専用コメントページ（既存video-siteパターンで代替十分）
- はてなブログのコメント欄（本文とコメントが同一ページで分離困難なため見送り）
- ページネーション追跡・アダプタ単位の個別トグル（既存の Domain Whitelist Extraction Mode 設計から継続してスコープ外）
