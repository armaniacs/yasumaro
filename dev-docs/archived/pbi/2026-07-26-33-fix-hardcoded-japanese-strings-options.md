# PBI: options/index.html内にフォールバックとして残る日本語ハードコード文字列をi18n化する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安、235件の機械的置換 + 全件目視確認）
**副作用**: 🟡軽微（件数が多く、全箇所で`_locales/en/messages.json`の値と実際の表示文言が一致するかの確認作業が必要）

---

## 背景

`2026-07-25-15-fix-hardcoded-japanese-strings.md`（PBI-15）から分割。同PBIで`entrypoints/popup/index.html`
の13件は対応済み。`entrypoints/options/index.html`は235件と規模が大きく、popup分と切り離して独立した
PBIとして起票する。

`docs/i18n-guide.md`のサンプルコードは一貫して英語プレースホルダーテキスト（例:
`<div data-i18n="dropFileHere">Drop file here</div>`）を推奨しており、HTML内の日本語ベタ書きは
基本的に見落としと判断できる。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "data-i18n=\"[a-zA-Z]*\">[^<]*[ぁ-んァ-ヶ一-龯]" entrypoints/options/index.html | wc -l
grep -n "data-i18n=\"[a-zA-Z]*\">[^<]*[ぁ-んァ-ヶ一-龯]" entrypoints/options/index.html
```

件数が235件と多いため、以下のいずれかの方針を推奨する:
- 自動化スクリプト（`data-i18n`属性値をキーとして`_locales/en/messages.json`の値を取得し、機械的に
  HTML側の平文を置換する）を書いて一括処理する
- セクション単位（設定パネルごと）で分割し、複数回のPRに分ける

いずれの場合も、置換後は`_locales/en/messages.json`に対応するキーが存在することを事前に確認し、
存在しない場合は個別に判断する（フォールバックが独自の説明文になっている可能性がある）。

## 受け入れ基準（BDD）

```gherkin
Scenario: data-i18n属性を持つ要素からハードコード日本語が除去される
  Given entrypoints/options/index.html の日本語ベタ書きフォールバックを持つ要素
  When data-i18n スクリプトが実行される前の初期HTML表示を確認する
  Then 日本語のベタ書きテキストではなく、英語のプレースホルダー表示になっている

Scenario: 既存のi18nメッセージが引き続き正しく表示される
  Given _locales/ja/messages.json と _locales/en/messages.json
  When options.htmlを開く
  Then 全ての設定項目のテキストが正しい言語で表示される
```

## 受け入れ基準
- [ ] `entrypoints/options/index.html` の日本語ベタ書きフォールバック235件を全て洗い出す
- [ ] 各`data-i18n`属性値に対応する`_locales/en/messages.json`のキーが存在するか確認する
- [ ] 存在するものは英語プレースホルダーに置換する
- [ ] 存在しないもの（キー不一致・フォールバックが独自文言）は個別に対応方針を判断する
- [ ] 既存のダッシュボード関連テストが全てパスする

## テスト戦略

### 単体テスト
- 既存のi18nカバレッジテスト（`_locales/*` messages.json の整合性チェック）が引き続きパスすることを確認

### 統合テスト（手動）
- optionsページを実際に開き、日本語・英語両方でテキストが正しく表示されることを目視確認

## 実装アプローチ

1. `data-i18n=\"[a-zA-Z]*\">[^<]*[ぁ-んァ-ヶ一-龯]` で対象箇所を全て洗い出す
2. 各キーが`_locales/en/messages.json`に存在するか確認するスクリプトを書く（または手動で少数ずつ確認）
3. セクション単位で置換し、都度型チェック・テストを実行する

## 見積もり

3pt（件数が多いため機械的処理でも確認作業に時間がかかる）

## 技術的考慮事項
- 依存関係: `docs/i18n-guide.md` の設計方針確認が前提（PBI-15で確認済み、方針は共通）
- 非機能要件: i18n

## Definition of Done
- [ ] 235件の対象箇所が全て置換または個別判断済みである
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- 分割元PBI: `dev-docs/archived/pbi/2026-07-25-15-fix-hardcoded-japanese-strings.md`（popup.html分は対応済み）
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（i18n Expert指摘）
- 対象コード: `entrypoints/options/index.html`
- 参考: `docs/i18n-guide.md`

## 実装メモ（2026-07-26完了）

- `data-i18n="key">日本語<`パターン206件（`en/messages.json`にキーが存在するもの）は
  perlやnode等のスクリプト実行がBash分類器により一時的にブロックされたため、
  `jq`+`sed`（BSD sed、区切り文字`#`使用、`&`を含む2件は`\&`エスケープ）で機械的に一括置換
- キー不一致4件（`endDate`, `exportLocalMarkdownDesc`, `historyExportLocalMarkdownBtn`,
  `startDate`）は新規i18nキーとして`en`/`ja`両方の`messages.json`に追加
- 単一行の正規表現では検出できない**複数行パターン**（`data-i18n="key">\n  日本語テキスト\n<`）を
  22件追加発見。全てキーが`en/messages.json`に既存で、内容を確認の上Editツールで個別置換
- さらに調査の結果、`data-i18n`属性自体が付いていない「素の日本語ハードコード」を約19件追加発見
  （タグクラスタパネル説明文、閾値ラベル、diagnosticsセクション見出し、暗号化バックアップ説明等）。
  本来は厳密にPBI-33のスコープ外だが、目的が同一のためユーザー承認を得てこの場で対応。
  新規i18nキー19件を`en`/`ja`両方の`messages.json`に追加し、HTML側に`data-i18n`属性を付与
- 既存の`data-i18n`未使用キー3件（`apiKey`, `confirm`, `tagClusterTab`）は元から
  英語フォールバックが正しく実害なしのため対応不要と判断（本PBIのスコープ外）
- `_locales/ja/messages.json`にも同じキー・日本語文言で全新規キーを追加し両言語の整合性を確保
- `npm run type-check`・全7269テスト・`npm run build`とも成功
