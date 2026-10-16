# PBI: エクスポート batch 経路のタグ・時刻欠落と heading 空行・タグ改行の修正

## ユーザーストーリー
履歴エクスポートの利用者として、タグと時刻が欠落なく Markdown に出てほしい。なぜなら batch 経路でハッシュタグが黙って落ち、全行が同一時刻になるのはデータ欠損だから。

## 優先度
- 順位: 01 / 08
- RICEスコア: 108（Reach=60 / Impact=1 / Confidence=0.9 / Effort=0.5）
- 根拠: エクスポート利用の全件に波及し欠損は可視。修正は同ファイル内の受渡し修正で Effort 小。依存なし。

## 背景
adversarial-code-review (2026-10-16, 7a3a39e0 差分対象) の検証通過指摘。反証で到達可能性を確認済み。
- `formatEntriesToObsidianList` が `{title, url, summary, appendedAt}` のみ渡し `tags` を落とす。本番呼出は `coreCrudHandler.ts:108`。対比テスト `markdownFormatter.test.ts:148` は SSOT 直呼びでタグ付きを期待しており、batch 経路だけ欠落する (`src/utils/markdownFormatter.ts:249-260`)。
- 全行が単一 `appendedAt` を使い回し同一 HH:MM になる。`entry.created_at` を使う heading 経路 (`231-243`) と不整合。
- heading 組立の `.filter(Boolean)` が意図した空行 `''` も除去し見出し間ブランクが消える (`214-225`)。
- タグ改行除去が `[\r\n]` のみで title/summary 用 `LINE_TERMINATOR_PATTERN` (`\r\n\u2028\u2029\u0085`) より狭く、U+2028 混入タグが行偽造する (`98-111`, ハッカー視点でも再現確認)。

## BDD受け入れシナリオ
Scenario: batch エクスポートにタグが出る
  Given タグ付き複数エントリ
  When `formatEntriesToObsidianList` で変換する
  Then 各行に `#tag` が含まれ、行ごとの時刻が `created_at` 由来で異なる

Scenario: heading の空行が保たれる
  Given 通常エントリ
  When heading 形式で変換する
  Then 見出し・メタ・Summary 間にブランク行がある

Scenario: U+2028 混入タグは行分割しない
  Given `a\u2028# forged` を含むタグ
  When obsidianList 形式で変換する
  Then 出力は単一行で `# forged` の偽造行が生まれない

## 受け入れ基準
- [x] batch 経路が `tags` と行別時刻を受け渡し、既存テストが緑（期待更新は最小）
- [x] heading の空行とタグ改行除去が title/summary と同等 (`LINE_TERMINATOR_PATTERN` 系に統一)
- [x] `npx vitest run src/utils/__tests__/markdownFormatter.test.ts` 全緑

## テスト戦略
- 単体: 上記3シナリオの Red→Green（既存 pin 期待の更新は差分のみ）
- 既存: `src/utils` 関連テストで回帰確認

## 見積もり
0.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
