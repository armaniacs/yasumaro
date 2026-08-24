# PBI: Cookie同意バナー（OneTrust/Dell）のAI送信除去

## ユーザーストーリー
Dell製品ページ利用者として、Cookie同意ダイアログの定型文がAI要約に送信されないようにしたい。なぜなら同意バナーは製品情報と無関係であり、トークンコストと要約ノイズの原因になるから。

## ビジネス価値
- コスト: Dell事例で送信トークン662のうち実質的にCookie文（~3KB）が大半を占め、無駄な課金を発生
- 品質: 要約が製品内容ではなくCookieポリシーの要約になる
- プライバシ: 同意バナーは全ユーザーで同一の法的定型文であり、AIへ送る価値がない
- 測定: 対象URL https://www.dell.com/ja-jp/shop/製品シリーズ/dell-pro-max-with-gb300/spd/dell-pro-max-fct6263-desktop/xcto_fct6263_apac において AIへ送信したデータ 3266→<500バイト、AI要約クレンジング削減率 0.7%→>80% を目標

## BDD受け入れシナリオ

```gherkin
Scenario: Dell OneTrustバナーがAI送信前に除去される
  Given Dell Pro Max ページのDOMに #onetrust-consent-sdk または .ot-sdk-container を含むCookieバナーが存在し、本文に「Cookieの管理」「必須Cookie」「マーケティング」等の定型文を含む
  When AI要約クレンジングが実行される
  Then 該当要素はDOMから削除され、AIへ送信したデータに「Cookieの管理」「同意の優先設定」等の文字列が含まれない

Scenario: 製品本文は保護される
  Given Dellページの製品説明セクションに「GB300」「NVIDIA DGX」等の製品固有テキストを含む要素が存在する
  When AI要約クレンジングが実行される
  Then 製品固有テキストを含む要素は削除されず、bodyProtection閾値（200）以上の本文スコアを維持する

Scenario: 英語OneTrustバナーも除去される
  Given 英語ページに「Manage Cookie Preferences」「Always active」「Marketing Cookies」等のテキストを含む consent 要素が存在する
  When AI要約クレンジングが実行される
  Then 対応する要素がテキストパターンで除去される
```

## 受け入れ基準
- [x] `stripPopupElements` または新設 `stripCookieConsentElements` が OneTrust系セレクタ（`onetrust`, `ot-sdk`, `ot-sdk-container`, `truste`, `cc-banner`, `cookieNotice`, `optanon`）を `isLikelyPopup` 判定なしで除去する
- [x] テキストベースの Cookie 判定（日本語: `Cookieの管理`, `同意の優先設定`, `必須Cookie`, `マーケティング`, `Cookieポリシー`, 英語: `Manage.*cookie`, `Always active` 等）が 500文字以下 + 子に `p/article/section` が2未満の要素に対して動作し、該当要素が除去される
- [x] 上記 Dell URL の実測で AIへ送信したデータが 3242→<800バイト かつ AI要約クレンジング削減率が 0.7%→50%以上になる（E2E: 実ページHTMLをクローンして `cleanForAISummary` を実行）
- [x] 既存の `stripPopupElements` テストが全てパスし、新規 Cookie パターンの単体テストが追加されている
- [x] `rules.ts` に新ルール `cookie`（defaultEnabled: true, newUserDefault: true, storageKey: ai_summary_cleansing_cookie）を追加し、既存ユーザー移行で有効化される（`migration.ts` でデフォルト true を書き込まない＝新規は defaultEnabled で有効）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 実Dell HTML（保存した fixture）を `document` にロードし `cleanForAISummary` 実行、送信データに Cookie 定型文が含まれないことをアサート

### 統合テスト
- `stripPopupElements` / 新 `stripCookieConsentElements` が OneTrust 構造（`div#onetrust-consent-sdk > div.ot-sdk-row`）を除去することを検証
- 日本語/英語の Cookie テキストパターンを含む `div` がテキストマッチで除去されることを検証（500文字超は保護、子 `p` が2つは保護）

### 単体テスト
- `COOKIE_TEXT_PATTERNS` の各正規表現が期待テキストにマッチすることの境界値テスト（空文字、500文字境界、子要素数境界）
- `POPUP_PATTERNS` に `onetrust`, `ot-sdk`, `optanon` 等が含まれることのユニットテスト
- `bodyProtection` が製品本文を保護すること（スコア200以上は削除されない）

## 見積もり
2 ストーリーポイント

## 技術的考慮事項
- 依存関係: なし（`aiSummaryCleaner` モジュール内完結）
- テスタビリティ: `jsdom` で DOM クローンを構築し `strip*` 関数を直接呼ぶ。OneTrust fixture は `testDir/fixtures/dell-onetrust.html` として保存
- 非機能要件: 追加セレクタは `buildClassIdSelectors` で統合してクエリ1回に。テキスト判定は `p, div, span, small, footer, section` の500文字以下要素のみに限定しパフォーマンス影響を抑制
- ロールバック: ルール `cookie` を `false` にすることで即時無効化可能。`stripPopupElements` の OneTrust 追加は独立しており単独で revert 可能

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "stripPopupElements\|POPUP_PATTERNS\|COOKIE\|onetrust\|ot-sdk" src/utils/aiSummaryCleaner/
grep -rn "COOKIE_TEXT_PATTERNS\|LEGAL_TEXT_PATTERNS" src/utils/aiSummaryCleaner/patterns.ts
grep -rn "ai_summary_cleansing_popup" src/utils/storage/types.ts
```

未実装: `onetrust`/`ot-sdk`/`optanon`/`truste` は現行 `POPUP_PATTERNS`/`DEEP_CLASS_PATTERNS` に未含。日本語 Cookie テキストパターンは未存在。`stripPopupElements` の cookie 分岐は `isLikelyPopup` ガード付きで Dell の静的バナー（fixed でない）を除去できない。

### 実装手順
1. `patterns.ts` に `COOKIE_TEXT_PATTERNS: RegExp[]` を追加（日本語6件 + 英語3件 + 汎用 `/オプト.*アウト/` 等）
2. `POPUP_PATTERNS` に `onetrust`, `ot-sdk`, `optanon`, `truste`, `cookieNotice`, `cc-banner`, `consent-sdk` を追加（`buildClassIdSelectors` で自動統合）
3. `stripExtended.ts` の `stripPopupElements` で cookie セレクタを `isLikelyPopup` なしで常時除去する分岐を追加。または新関数 `stripCookieConsentElements` を `patterns.COOKIE_TEXT_PATTERNS` でテキスト判定し `stripCore.ts` の `stripLegalTextNodes` と同様の 500文字/子要素数ガードを適用
4. `types.ts` に `AI_SUMMARY_CLEANSING_COOKIE` StorageKey 追加、`restorableSettings.ts` と `rules.ts` に `cookie` ルール（defaultEnabled: true, newUserDefault: true）を追加。`strip` は 3. の関数を呼び出す
5. `Dell fixture` を用いた E2E テストと `stripCookieConsentElements` 単体テストを追加

### 落とし穴
- `isLikelyPopup` は `position: fixed` 等を判定するが Dell の OneTrust バナーは初期表示で静的（`position: static`）のため除去されない。Cookie は `isLikelyPopup` を外して無条件除去すること
- テキスト判定で製品本文を誤削除しないよう、500文字超と `p/article/section` が2つ以上のコンテナは必ずスキップ（`stripLegalTextNodes` と同ガード）
- `bodyProtection` 閾値200は製品本文を保護するが、Cookie バナーが本文よりスコア高い場合に本体が保護対象になる危険がある。Cookie 除去は bodyProtection マーキング前に実行すること（`rules.ts` の順序で `cookie` を `popup` 直後に配置）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（新規パターンの単体テスト + Dell fixture の E2E）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ロールバック手段の検討（`cookie` ルール false で無効化、個別 revert 可能を技術的考慮事項に記載済み）
- [x] ドキュメント更新済み（`docs/CLEANSING_ORDER.md` に cookie ルールを追記）
