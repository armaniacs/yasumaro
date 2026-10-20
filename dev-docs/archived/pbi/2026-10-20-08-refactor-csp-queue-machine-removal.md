# PBI 08: cspValidator キュー実行マシンの削除 + cspSettings 未接続整理

## ユーザーストーリー
メンテナーとして、本番から到達できない CSP fetch キュー実行マシンと permission request 経路が整理された状態がほしい、なぜなら死んだ状態管理機械と未接続の permission request は、list-source 変更を拾わない旧 origin を request し続ける誤読の温床になるから。

## 変更点の概要
production 呼び出し 0 件の CSPValidator キュー実行マシン（~90 行）と cspSettings の未接続 permission request・ハードコード origin を整理する。

## 現状と問題
- src/utils/cspValidator.ts:120-251（キューマシン: queue フラグ、enqueueQueuedRequest、prepareInitialization）、:443-446（safeFetch が queue を呼ぶ）― safeFetch/enqueueQueuedRequest の本番呼び出しは 0 件（参照は cspValidator.test.ts・cspValidator-race-condition.test.ts のみ）
- src/dashboard/cspSettings.ts:274（'https://raw.githubusercontent.com/*' / 'https://tranco-list.eu/*' をハードコード、listSources.ts:24,38-39 SSOT 派生の OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS（utils/cspDomains.ts:31-36）と重複、同値は list-sources-conformance.test.ts:47 が pin）
- requestEssentialPermission の呼び出し元はテストのみ（cspSettings.test.ts:583 ほか 2 箇所）― 本番未接続
- テスト: cspSettings-permission-request.test.ts がリテラルを pin（drift した複製でも green）

## 変更の理由
[可読性/保守性] キューマシンは本番経路がなく、状態管理の複雑さだけが残る。ハードコード origin は本番復活時に list-source 変更を拾わない。

## 提案コード（骨子）
- cspValidator から queue 実行マシン（:120-251）と safeFetch（:443-446）を削除
- cspSettings.ts:274 は OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS から派生（値は不変）
- 本番復活が想定される場合は削除ではなく接続を選ぶ判断を PBI コメントに記録

## BDD受け入れシナリオ
Scenario: 削除後も CSP 許可チェックは不変
  Given cspValidator の許可チェック関数は本番で使われている
  When キュー実行マシンを削除する
  Then 許可チェックの挙動は変更されず、全テストが通過する

Scenario: origin の SSOT 派生
  Given cspSettings の permission request origin
  When listSources.ts の SSOT から派生させる
  Then 実効 origin は変更前と同一である

## 見積もり
1 pt（RICE: 32 = Reach 8 × Impact 2 × Confidence 1.0 ÷ Effort 0.5 人日）

## DoD
- [x] 削除直前に safeFetch/enqueueQueuedRequest の本番呼び出し 0 件を再確認
- [x] npm run validate 通過
- [x] npm run build 通過

## 実装記録（2026-10-21）
- 本番 0 件を再確認（safeFetch / enqueueQueuedRequest / prepareInitialization の本番呼び出し 0 件、requestEssentialPermission の呼び出し元もテストのみ）し、owner 判断として削除を選択（復活時も現行の事前初期化経路と同じ形になるためキュー再導入は設計変更時の実装で足りる）
- cspValidator.ts を 476→340 行に（QueuedRequest・キューマシン状態 9 項目・safeFetch・CspError クラスを削除。本番の validate 部分は不変。isInitialized は fetch.test.ts がモックするため維持）
- cspSettings.ts のハードコード origin を ESSENTIAL_PERMISSION_HOSTS + OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS（listSources.ts SSOT 派生）からの完全一致 lookup に置換（実効 origin 不変、消失時は warn して fail-closed）
- pin 更新: safeFetch export チェックを「削除済み pin」に更新、race-condition テスト 7 件（削除対象のキュー挙動 pin）を削除、permission-request テストをリテラル pin → SSOT pin
- 検証: cspValidator / cspSettings 系 11 ファイル 250 テスト全 green、type-check 通過、validate:fast green
