# PBI 要約クリーナーと私的判定の正確性

## ユーザーストーリー
記録利用者として、AI要約の除去漏れや私的ページの誤判定なく記録されてほしい、なぜなら除去漏れはノイズ混入に、誤判定は記録漏れや過剰記録につながるから。

## 優先度
- 順位: 09/17
- RICE: 80 (Reach=200 / Impact=1 / Confidence=80% / Effort=2人日)
- 根拠: 判定正確性8件の一括対処

## 対象の指摘(検証済み8件)
- (1) src/utils/aiSummaryCleaner/helpers.ts:188-212 ― findDeepHosts失敗時に空集合を無通知返却し除去漏れを正常系に見せる。
- (2) 同:243-262 ― 不正セレクタcatchが空配列で0件とセレクタ誤りを不可分にする。
- (3) 同:266-278 ― shadow再帰catch{}がclosed/detachedを無記録スキップする。
- (4) src/utils/ui/settingsUiHelper.ts:85-93 ― mirrorStatusToTopのcatchがDOM不整合を無音化する。
- (5) src/utils/readBodyCapped.ts:67-78 ― 非ストリーム時のresponse.json()だけバイト上限を素通りする。
- (6) src/utils/RateLimitService.ts:20-24,46-54,166-182 ― 閾値未満の失敗は合体タイマーのみでSW終了時に消失し過少計上になる。
- (7) src/utils/privacyChecker.ts:33-39 ― isPrivacyInfoがisPrivate/timestampの2fieldのみ検証する。
- (8) 同:58,81,98,141-143 ― hasHeaderは存在のみ判定し空Set-Cookieでも私的判定になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常の除去と判定は従来通り動く
  Given 通常のAI要約付きページと公開ページがある
  When 記録処理を実行する
  Then 要約ノイズは除去され公開ページは通常記録される

Scenario: 除去失敗時は検出可能になる
  Given 除去処理で失敗が起きる条件がある
  When 記録処理を実行する
  Then 失敗を正常系に見せず検出できる形で扱う

Scenario: 空ヘッダーで私的誤判定しない
  Given Set-Cookieなどが空の公開ページがある
  When 私的判定を実行する
  Then 公開ページを私的と誤判定しない

Scenario: SW再起動で失敗計数が失われない
  Given 失敗計数が蓄積された状態がある
  When SWが再起動する
  Then 再起動後も失敗計数が引き継がれる
```

## 受け入れ基準
- [x] (1)から(8)の各指摘に対処していること
- [x] 各対処に対する回帰テストが追加され全て通ること
- [x] 正常系の記録動作に変化がないこと
- [x] 除去失敗を正常系と区別できること
- [x] 空ヘッダーで私的誤判定しないこと
- [x] SW再起動後も失敗計数が失われないこと

## テスト戦略
- 単体テスト中心で失敗条件と境界値を模擬する
- 除去失敗時の検出可否を確認する
- 空ヘッダーなど境界値の判定を確認する
- SW再起動をまたぐ計数保持を確認する
- 既存の正常系テストで回帰を確認する

## 見積もり
- M

## Definition of Done
- [x] 全BDDシナリオが自動テスト化されパスする
- [x] コードレビューが完了する
- [x] 回帰テストが全て通ること

出典: adversarial-code-review 2026-11-08
