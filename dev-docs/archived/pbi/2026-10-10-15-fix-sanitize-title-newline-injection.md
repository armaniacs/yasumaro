# PBI: sanitizeTitleで改行を空白に正規化しMarkdown注入を塞ぐ

- 種別: fix
- RICE: 16.0（R4 × I2 × C1.0 / E0.5）
- 依存: なし（#1・#2とファイル非重複で並列可）
- バッチ: adversarial-1010
- 台帳: `pbi/2026-10-10-01-backlog-adversarial-1010.md`

## ユーザーストーリー

記録ユーザーとして、ページタイトルに改行が含まれていてもデイリーノートの構造が壊れないでほしい。なぜなら現状は改行入りtitleが`- ts [title](url)`の行を割り、攻撃者整形の偽行・見出しがVaultに混入するから。

## 背景（現状・証拠）

- `src/utils/markdownSanitizer.ts:151-160` — `sanitizeForMarkdownLinkText`は`[ ] ( )`のみエスケープし`\r\n`を処理しない
- `src/utils/markdownFormatter.ts:62-69` — `sanitizeTitle`も改行無処理（対照的にsummary `:75-81`は`\n`→空白正規化、tag `:94`は`[\r\n]`除去の片手落ち）
- `src/utils/markdownFormatter.ts:174` — `obsidianList`テンプレートに改行入りtitleが割って入る。heading（`:161`の`# title`）も同経路で割れる
- titleはページ`<title>`（攻撃者制御）由来。validatorは長さのみ（`src/messaging/validators.ts:512-517`、VALID_VISITはtitle検査自体なし）
- 反証検証SURVIVES＋目視確認済み

## BDD 受け入れシナリオ

```gherkin
Scenario: 改行入りタイトルが単一行に正規化される
  Given タイトルに改行を含むページを記録する
  When デイリーノート用Markdownを生成する
  Then titleは単一行になり、偽の箇条書き・見出し行が混入しない

Scenario: headingスタイルも割れない
  Given 同上のタイトルである
  When headingスタイルで生成する
  Then "# title"行は単一行である
```

## 受け入れ基準

- [ ] `sanitizeTitle`内で`\r\n`を空白に正規化する（summaryと同一規則）
- [ ] `sanitizeForMarkdownLinkText`自体は変更しない（他用途への影響回避）
- [ ] fallback挙動（`titleFallback`）は不変
- [ ] 再現テスト（改行title→単一行化、両style）を追加する

## テスト戦略

- unit（新規）: `markdownFormatter`の改行titleテスト（obsidianList＋heading）
- 既存: `markdownFormatter`関連テストが無変更green

## 見積もり

0.5 SP

## 技術的考慮事項

- 正規化規則はsummary（`:79`）と同一にし、SSOT乖離を作らない
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `sanitizeTitle`に改行→空白の正規化を追加
2. 再現テストを追加し、関連テストで検証

### 落とし穴

- `sanitizeForMarkdownLinkText`に手を入れると他用途（tag chain等）に波及するため触らない
- `\r`単独にも対応すること（`[\r\n]`系で処理）

## Definition of Done

- [x] 改行入りtitleが単一行化される（両style）
- [x] 再現テストがgreen
- [x] `npm run validate`がgreen
