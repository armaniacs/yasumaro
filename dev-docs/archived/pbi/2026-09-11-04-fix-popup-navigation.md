# PBI 04: popup navigation の dead 分岐削除と init 単一化

## ユーザーストーリー

popup を保守する開発者として、存在しない要素を参照する分岐がなく、popup の初期化が単一の entry point で行われる状態を望む。なぜなら現状 settingsScreen/backBtn が参照する要素は HTML に存在せず（dead code）、3 つの initializer が競合しているから。

## 優先度

- 順位: 04 / 7
- RICE スコア: 5.3（Reach=2 / Impact=1 / Confidence=80% / Effort=0.3 人週）
- 根拠（round 7 診断）:
  - `navigation.ts:17,21`（settingsScreen）と `:87,100-102`（backBtn）— 参照先要素が popup/index.html に無い（CSS とテスト fixture にのみ存在）
  - `:94-97` — historyBtn wiring が `if (menuBtn)` 内にネスト（menuBtn 依存）
  - 3 initializer: `entrypoints/popup/main.ts:12-22`（DOMContentLoaded → applyI18n）/ `src/popup/popup.ts:110-112`（import 時 auto-run）/ `src/popup/main.ts:13-31`（DOMContentLoaded → load）
  - lang/dir 設定が `popup.ts:24-35`（setHtmlLangDir）と `i18n-dom.ts`（setHtmlLangAndDir）の 2 実装

## BDD 受け入れシナリオ

```gherkin
Scenario: popup の初期化が 1 回だけ走る
  Given popup が開かれる
  When 初期化が完了する
  then initNavigation / loadCurrentTab は各 1 回だけ呼ばれる

Scenario: historyBtn wiring が menuBtn に依存しない
  Given menuBtn が HTML から削除される
  When popup が初期化される
  Then historyBtn の wiring は維持される
```

## 受け入れ基準

- [x] navigation.ts の settingsScreen/backBtn dead 分岐と dead CSS 削除
- [x] historyBtn wiring を menuBtn guard 外へ
- [x] popup.ts の import 時 auto-run を削除し、entrypoint main.ts から単一 init 呼び出しに
- [x] lang/dir を i18n-dom の setHtmlLangAndDir に統一
- [x] popup 関連テスト green

## テスト戦略

popup テスト更新 + 回帰（statusPanel / recordCurrentPage）。

## 見積もり

S（0.3 人週）。種別: refactor（+fix）。

## 実装メモ（2026-09-11 round 7）

- navigation.ts: settingsScreen/backBtn の dead 分岐削除（参照先要素は HTML に存在しない）+ historyBtn wiring を menuBtn guard 外へ。
- popup.ts: import 時 auto-run（initPopup 即時実行）を削除 — entrypoints/popup/main.ts の bootstrap（setHtmlLangAndDir → applyI18n → translatePageTitle → initPopup）が単一 entry point に。
- `setHtmlLangDir`（popup.ts・getUILanguage ベース）を削除し i18n-dom の `setHtmlLangAndDir` に統一（単一 lang/dir helper）。popup テストを i18n-dom 対応に更新（3 ブロック書き換え）。
- popup 全 855 tests green。
