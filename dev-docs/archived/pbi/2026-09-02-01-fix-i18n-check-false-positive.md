# PBI: check-i18n の extra キー誤検知修正（配列への `in` 演算子）と fail 昇格

## ユーザーストーリー
開発者（リリース担当）として、`release:check` の i18n チェックが実差分を正確に報告してほしい。なぜなら毎回「Locale ja: 1247 extra key(s) not in en」という誤検知警告が出続けると、警告への感度が鈍り、将来の en 欠落キー（default_locale が en であるため英語ユーザーへの表示欠落に直結）を見逃すから。

## 優先度
- 順位: 01 / 01
- RICEスコア: **300**（Reach=30 / Impact=1 / Confidence=1.0 / Effort=0.1）
  - Reach 30: 連日リリース運用により `release:check` が月次約 30 回実行され、毎回誤検知が表示される
  - Impact 1: ユーザー直影響はないが、リリースゲートの信頼性回復と「本当の extra key の見逃し防止」
  - Confidence 1.0: バグを `node` で実証済み。実ファイルは完全同期（ja/en とも 1,247 キー・差分ゼロ）を確認済み
  - Effort 0.1: 1 行修正 + 誤解を招くメッセージ修正 + `scripts/__tests__/` への回帰テスト
- 根拠: 単独候補のため 01 位。依存関係なし。工数最小でリリースゲートの信頼性が回復する Quick Win。

## 背景 / なぜなぜ分析
- 表層: `release:check` で「Locale ja: 1247 extra key(s) not in en」が毎回出る（extensionName / appTitle 等が extra 例として列挙される）
- なぜ1: `scripts/release-checks/check-i18n.mjs:84` が `Object.keys(localeMessages).filter((k) => !(k in refKeys))`。`refKeys` は `Object.keys()` の戻り値（**配列**）で、`in` はインデックス/プロパティの存在判定のため文字列キーは常に `false` → **全キーが extra と判定される**（`'extensionName' in ['extensionName','appTitle']` → `false` を node で実証済み）
- なぜ2: なぜ missing（L83）は正しいのに extra だけ壊れているか → L83 はオブジェクト `localeMessages` への `in`（正しい）、L84 は配列 `refKeys` への `in`（誤り）という非対称。このスクリプトには比較ロジックのテストが存在しなかった
- なぜ3: なぜ放置されたか → `extra` チェックは `allPassed` に反映されず（`fail` のみ反映）、リリースは常に通る
- なぜ4: なぜ warn のままでよくなかったか → ja のみのキー = en（`default_locale`）欠落 = 英語 UI でキー名がそのまま表示される実害。coverage 80% ゲート等、本プロジェクトはリリースゲートの全面ゲート化が流儀
- なぜ5: なぜ「実差分ゼロ」に気づかなかったか → 誤検知が常時 1,247 件で「ja 優先のプロジェクトだから en が少ない」と誤読できる状態だった。実ファイルの diff 確認がチェック工程になかった
- 解: L84 をオブジェクト照合（`!(k in messages[refLocale])`）に修正。extra 検出は `fail` に昇格（現在の実差分はゼロのため、昇格直後からゲートは緑のまま）。L51 の「No _locales directory found in **dist**」という誤解を招くメッセージ（実体は `public/_locales`）も修正。回帰テストで挙動を固定する

## BDD受け入れシナリオ

Scenario: 同期済みロケールでは警告が出ない
  Given `public/_locales/ja/messages.json` と `en/messages.json` が同一キーセット（1,247 キー）である
  When  `check-i18n.mjs` の i18n 完全性チェックを実行する
  Then  extra キーの報告は 0 件で、i18n Completeness は PASS する

Scenario: 実差分があるときは fail する
  Given `ja/messages.json` にのみキーを 1 つ追加する
  When  i18n 完全性チェックを実行する
  Then  「1 extra key(s) not in en」が fail として報告され、チェック全体が非パスになる
  And   プロセスは非ゼロで終了する

Scenario: missing の既存挙動は維持される
  Given `en/messages.json` からキーを 1 つ削除する
  When  i18n 完全性チェックを実行する
  Then  missing として fail が報告される（リグレッションなし）

## 受け入れ基準
- [x] extra 検出が実ファイル差分を正しく報告する（同期状態で extra = 0 件、警告非表示）
- [x] extra キー検出時は `fail` として `allPassed` に反映され、プロセスが非ゼロで終了する
- [x] 「No _locales directory found in dist」の誤記を修正する（実際は `public/_locales` を監視）
- [x] 回帰テストが `scripts/__tests__/` に新設され、同期状態 = extra 0 / 差分注入 = fail / missing の既存 fail 挙動を検証する
- [x] `release:check:fast` が 7/7 PASS（i18n 警告 0 件）で通る
- [x] `npm run validate` PASS

## テスト戦略
- 単体: `scripts/__tests__/check-i18n.test.ts` を新設。`check-i18n.mjs` の比較ロジックを export 化し（現状は内部関数）、一時ディレクトリに ja/en の messages.json フィクスチャを配置して 3 パターン（同期 / ja に extra / en に missing）を検証する。既存慣例は `scripts/__tests__/build-store-zip.test.ts`。vitest の include（`**/__tests__/**/*.test.ts`）により scripts 配下も実行対象
- 統合: `npm run release:check:fast` の i18n 項目 PASS と警告 0 件を目視 / CI で確認

## 見積もり
1pt（🟢低）

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `release:check:fast` 7/7 PASS（i18n 警告 0 件）
- [x] `npm run validate` PASS
- [x] コードレビュー完了（2026-09-02: Perplexity→Hugging Face 文書修正済み）
- [ ] 完了後 `dev-docs/archived/pbi/` へ移動し `00-INDEX.md` を更新
