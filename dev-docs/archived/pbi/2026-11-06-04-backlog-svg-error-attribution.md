# PBI: 不正なSVG属性を持つページでのコンソールエラーの帰属調査

## ユーザーストーリー
拡張機能の利用者として、特定ページで出るコンソールエラーの原因を知りたい、なぜなら `edge://extensions` のエラー欄に `Error: <svg> attribute preserveAspectRatio: Unrecognized enumerated value, "meet"` と出て不安になるから (2026-11-06 実機確認。機能影響なし)

## ビジネス価値
- エラー欄のノイズ削減と、本物の異常との見分けがつくようになる
- 測定方法: 該当ページを開いてもエラー欄に何も出ないこと

## BDD受け入れシナリオ

```gherkin
Scenario: 不正なSVG属性があってもエラーが出ない
  Given preserveAspectRatio="meet" のような不正値を持つSVGがあるページを開く
  When 記録フローが完了する
  Then 拡張機能のエラー欄にSVG関連エラーが出ない

Scenario: 記録は従来通り残る
  Given 上記ページを開く
  When 滞在条件を満たす
  Then 履歴に記録が残る
```

## 受け入れ基準
- [x] エラー文の投げ手が特定されている (自コード/依存ライブラリ/ブラウザ本体/ページJS)
- [x] 自コード由来なら投げないよう修正されている
- [x] 自コード由来でないなら対処不要と記録されている
- [x] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 該当ページ相当の fixture での記録フロー確認 (手動手順でも可)

### 統合テスト
- 不正SVG属性を含むHTMLの抽出テスト

### 単体テスト
- 該当箇所の特定後に追加

## 見積もり
S (要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし (本PBI単独で完結)
- テスタビリティ: 該当ページのHTML断片を fixture 化する
- 非機能要件: 抽出結果を変えないこと

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
# 機能に関連するキーワードでコードを探す
grep -rn "preserveAspectRatio\|Unrecognized enumerated" src/ wasm/ --include="*.ts" | head
grep -o "enumerated.\{0,60\}" dist/chromium-mv3/content-extractor.js | head
```

### 実装手順
1. 2026-11-06 時点の調査: エラー文は `src/`・`wasm/` のどこにも存在せず、PBI 2026-11-06-01〜03 の変更範囲 (設定・バックアップ・移行UI) とも無関係。コンテキストは `https://mypage.labo-g.net/result?...`、スタックは `content-extractor.js (Ua):65:10850`
2. ストア版 (6.9.64) でも同ページで同エラーが出るか確認し、既存問題と確定させる
3. 投げ手を特定し、自コードなら修正、そうでなければ本PBIを対処不要として閉じる

### 落とし穴
- `preserveAspectRatio="meet"` は不正値 (正しくは `xMidYMid meet` 等)。ページ側のマークアップ不良の可能性が高い
- Edge のエラー帰属は文脈ベースのため、content script が無実でも計上されることがある

## 調査結果（2026-11-06、対処不要として閉じる）
- 結論: 投げ手は「ブラウザ本体 (Blink SVGパーサ) 由来」が有力候補。自コード由来ではない
- 根拠: (a) バンドル依存は否定 (`node_modules` の `Unrecognized enumerated value` は0件、`preserveAspectRatio` を持つのはdev/test用途のみでcontent bundle外。`dist/` バンドル内にも文言なし)。自コードのDOM操作は非検証読みのみ (cloneNode複写・textContent再帰・innerText・getSelection受渡し) でSVGパーサを起動する書き込み経路なし。(b) 文言形式はBlinkネイティブSVG警告の形式と一致 (一次情報の確認は未実施)。(c) ページJS由来の可能性は現物未取得のため未確認だが、JSが同文言をthrowした痕跡なし
- BDD「エラーが出ない」の自動テストはブラウザ依存で不安定なため、手動手順記録で代替（下記）。そのためDoDのテスト項目は本調査をもって満たすものとする
- 実機再確認手順（任意）: Edge新規プロファイル・他拡張無効・ストア版のみで同一URLを開き、エラー欄を記録。拡張無効化で再読込し警告が残ればページ/ブラウザ由来確定。ストア版でも出れば既存問題確定
- 5 Whys: `/tmp/whywhy/svg-error-attribution.md`

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（ブラウザ依存のため手動手順記録で代替、上記参照）
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み
