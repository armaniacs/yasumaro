# Domain Whitelist Extraction Mode — サイト別ホワイトリスト抽出

**Date:** 2026-07-15
**Branch:** feat/ai-summary-cleansing
**Status:** Design

## Motivation

Category A（WordPressテーマ）・Category B（News/EC/QA/Video）は「引き算（ブラックリスト）方式」——本文候補をスコアリングで見つけ、ノイズ要素を除去する——でノイズを削減してきた。

しかし、以下のサイトは周辺ノイズ（外部相互リンク網・大量のインフィード広告・投票UI・関連リンク敷き詰め）のテキスト量が本文の7〜8割を占め、引き算では綺麗な本文が残らない:

- Togetter（まとめサイト同士のアンテナサイト相互リンク網）
- 5ちゃんねるまとめブログ（キニ速・痛いニュース等、アンテナリンク+インフィード広告）
- ガールズちゃんねる（コメントごとの投票UI・広告が密集）
- Yahoo!知恵袋（関連質問・おすすめ質問のリンク敷き詰め）
- 小説投稿サイト（なろう・カクヨム、前書き/後書き/広告が本文と混在）
- レシピサイト（クックパッド・クラシル、会員誘導・タイアップ広告・つくれぽが本文を圧迫）

これらは「主要コンテンツが定型化されたコンポーネントの集合、または単一の明確な箱」であるという共通点があり、「特定クラスの中身だけを狙い撃ちで抽出する」ホワイトリスト方式が圧倒的に精度が高い。

## Design Decisions

### アーキテクチャ: 完全分岐方式

現行の `extractMainContent()`（`findMainContentCandidates()` → strip関数群、ブラックリスト方式）とは独立した処理パスとして新設する。

```
extractMainContent()
  ├─ 1. ドメイン判定 or 主要セレクタのDOM存在チェック
  │     ├─ 一致 → extractWhitelistedContent(adapter) を実行
  │     │     ├─ 抽出結果が1件以上 → その結果を返す（Category A/B の strip 処理は適用しない）
  │     │     └─ 抽出結果が0件 → 2. へフォールバック
  │     └─ 不一致 → 2. へ
  │
  └─ 2. 従来の findMainContentCandidates() 〜 strip関数群（ブラックリスト方式）
```

ホワイトリスト抽出で得られたテキストは、対象要素の中身のみを抽出した時点で既にノイズが除去されているため、Category A/B の strip 系処理（alt属性削除等を含む）を重ねて適用しない。二重処理による誤削除や処理コストを避ける。

### 検知ロジック: ドメイン判定 + DOMクラス検知の併用

各アダプタは以下を持つ:

```typescript
interface WhitelistAdapter {
    name: string;                    // アダプタ識別名（ログ・デバッグ用）
    domains: string[];               // hostname完全一致 or サフィックス一致で判定。空配列は「ドメイン判定なし」を意味する
    detectSelector: string;          // このセレクタがDOM上に1件でも存在すればアダプタを適用（ドメイン不一致でも発火）
    contentSelectors: string[];      // 抽出対象のクラス/ID（複数要素を順に結合）
    excludeSelectors?: string[];     // contentSelectors内でさらに除外したい要素（メタ情報等）
}
```

判定順序:
1. `location.hostname` が `domains` のいずれかに一致（またはサフィックス一致）→ 即座にこのアダプタを適用
2. `domains` が空、またはどのドメインとも一致しない場合でも、`detectSelector` がDOM上に存在すれば適用（5chまとめブログのように無数のドメインに同一テンプレートが展開されるケースに対応）
3. どちらにも該当しなければホワイトリストモードは発動しない

誤検知のリスクは `detectSelector` の固有性に依存する。各アダプタの `detectSelector` はサイト固有の複合語・IDを用い、汎用語（`.comment`等）は使わない。

### 対象サイトとアダプタ定義（初期実装、6アダプタ）

実装時に各サイトの実際のDOM構造を確認し、以下を初期値として調整する。

| アダプタ名 | domains | detectSelector | contentSelectors |
|---|---|---|---|
| Togetter | `togetter.com` | `.tweet_body` | `.tweet_body`, `.item_text` |
| 5chまとめブログ | `[]`（ドメイン非依存） | `.t_b, .res, .reply_body` | 同上 |
| ガールズちゃんねる | `girlschannel.net` | `.comment-body` | `.comment-body` |
| Yahoo!知恵袋 | `chiebukuro.yahoo.co.jp` | `[class*="Chie-ItemAnswer"]` | 質問文コンポーネント, `[class*="Chie-ItemAnswer"]` |
| なろう・カクヨム | `syosetu.com`, `kakuyomu.jp` | `#novel_honbun`（なろう）/ カクヨム側の本文セレクタ | 同上 |
| クックパッド・クラシル | `cookpad.com`, `kurashiru.com` | `.ingredient`（クックパッド）/ クラシル側の材料セレクタ | `.ingredient`, `.step` |

抽出後のテキスト整形:
- `contentSelectors` にマッチした各要素の `textContent` を、DOM出現順に配列として結合する
- リツイート数・`@username`・投稿日時等のメタデータ文字列は、抽出後に軽い正規表現クレンジングで除去する（要素単位ではなくテキスト単位の後処理）

### ページネーション

**スコープ外。** Togetterの「まとめ」やYahoo!知恵袋の複数ページ回答等、ページ分割されたコンテンツは表示中の1ページのみを対象とする。他ページを `fetch` して結合する処理は実装しない（CSP/CORS制約とパフォーマンスコストが増大するため）。

### 設定

- 新規StorageKey: `whitelistExtractionEnabled`（6アダプタ共通の一括トグル）
- デフォルト: `true`（新規ユーザー）。既存ユーザーには Category A/B と同じ移行方針（`migration.ts` で明示的 `false` を保存）を適用する
- アダプタ単位の個別ON/OFFは持たない。問題が起きた場合はユーザーが全体トグルで無効化する

### 変更ファイル（想定）

| File | Change |
|------|--------|
| `src/utils/contentExtractor/whitelistAdapters.ts` | 新規。6アダプタの定義 + `extractWhitelistedContent()` |
| `src/utils/contentExtractor/index.ts` | `extractMainContent()` 冒頭にドメイン/セレクタ判定と分岐を追加 |
| `src/utils/storage/types.ts`, `src/utils/storage/defaults.ts` | `whitelistExtractionEnabled` 追加 |
| `src/utils/migration.ts` | 既存ユーザー向けに明示的 `false` を保存 |
| `src/content/extractor.ts` | フラグ変数と配線を追加 |
| `src/popup/aiSummaryCleansingSettingsV2.ts` | 全体トグル1つを設定UIに追加 |

### 影響

| 項目 | 内容 |
|------|------|
| ユーザー影響 | 対象6サイト（および5chまとめ系の類似ドメイン）閲覧時、AI要約の精度が大幅に向上する想定。デフォルトONのため新規ユーザーは即座に恩恵を受ける |
| 誤検出リスク | 中。サイトのDOM構造変更でセレクタが陳腐化するリスクがあるが、0件時の自動フォールバックで安全側に倒れる |
| 保守コスト | サイト側のマークアップ変更に追従するメンテナンスが継続的に必要。E2Eテストでの定期的な健全性確認が望ましい |

## Test Strategy

- 各アダプタについて、`detectSelector` 一致時の抽出結果、`contentSelectors` 0件時のフォールバック動作をユニットテストで確認
- ドメイン一致・DOMクラス一致それぞれのトリガー経路を個別にテスト
- E2E: 実際の6サイトでの抽出精度確認（サンプルページのスナップショットテスト）

## Out of Scope

- ページネーション追跡（複数ページのfetch結合）
- アダプタ単位の個別トグル設定
- ホワイトリスト抽出結果へのCategory A/B strip処理の併用
- 6サイト以外への対象拡大（将来的な追加候補として、今後トラフィック上位サイトを継続的に調査する）
