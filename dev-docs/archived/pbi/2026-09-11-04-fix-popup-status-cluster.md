# PBI 04: popup クラスタ修正 — recordBtn 二重所有解消・allUrls wiring ガード・spinner 所有権・LOCKED i18n

## ユーザーストーリー

popup で記録する利用者として、権限状態の表示更新が記録ボタンの状態を裏切らず、ボタンの有効/無効が単一の writer で決まることを知りたい。なぜなら statusPanel が LOCKED 時に `recordBtn.disabled = true` を書き、RecordSession（「Sole button writer」と明記）が無条件で false に戻すため、更新順で状態が反転するから。

## 優先度

- 順位: 04 / 10
- RICE スコア: 10.7（Reach=3 / Impact=1 / Confidence=80% / Effort=0.3 人週）
- 根拠（2026-09-11 直接検証済み）:
  - `statusPanel.ts:136`（LOCKED 時 disabled=true）と `:153` 付近（grant 時 disabled=false）が RecordSession.resetRecordButton（`recordSession.ts:108-121`、doc: 「Sole button writer ... the status panel only signals through the session entry points」）と競合。disabled=true は設計上の escape hatch「Record Anyway」（force 記録）まで塞ぐ
  - `statusPanel.ts:444` — `btnRequestAllUrls` が裸 addEventListener（同ファイル `btnRequestPermission` は round 4 で dataset.wired ガード済み。同一クラスの修正が隣接関数に未伝播。現状 main.ts から 1 回呼びのため実害は小さいが再入で stack する）
  - `contentFetchGateway.ts:69` — showSpinner を所有するが hide は呼び出し側 2 箇所の担当。executeScript 本体が Level1/Level2 で逐語重複（:92-96 vs :125-129）
  - `statusPanel.ts:135` — `🔒 LOCKED` が i18n 素通り

## BDD 受け入れシナリオ

```gherkin
Scenario: LOCKED 表示が recordBtn を無効化しない
  Given 未許可 URL のタブがある
  When updateTrustStatus が実行される
  Then LOCKED バナーと permission 要求 area が表示される
  And recordBtn.disabled は statusPanel から変更されない（RecordSession が唯一の writer）

Scenario: btnRequestAllUrls のハンドラが重複しない
  Given banner 初期化が 2 回走る
  When ボタンをクリックする
  Then requestAllUrls は 1 回だけ呼ばれる

Scenario: gateway の spinner は呼び出し側が制御する
  Given RecordSession が ContentFetchGateway.fetch を呼ぶ
  Then spinner の show/hide ペアは RecordSession 側に完結し、gateway は spinner を触らない
```

## 受け入れ基準

- [x] statusPanel からの `recordBtn.disabled` 書き込み 2 箇所を削除（sole-writer 契約回復・doc コメントと整合）
- [x] `btnRequestAllUrls` に dataset.wired ガード
- [x] gateway から showSpinner を削除し、executeScript を 1 adapter（`executeScriptInnerText(tabId)`）に統合。spinner show は record フロー側（既存 hide と対になる位置）へ
- [x] `🔒 LOCKED` を i18n キー化（ja/en 同数・check-i18n PASS）
- [x] statusPanel.test.ts:429/:460 の recordBtn.disabled pin を新契約に更新
- [x] popup 関連テスト green

## テスト戦略

単体: wired ガード・spinner 非所有・LOCKED i18n。回帰: recordCurrentPage / statusPanel 全テスト。

## 見積もり

S-M（0.3 人週）。種別: fix（+refactor 1 件）。

## 実装アプローチ

1. statusPanel の recordBtn 書き込み削除 + LOCKED i18n + allUrls ガード
2. gateway の spinner 削除 + executeScript adapter 統合 + record 側 show 移管
3. テスト更新

## 実装メモ（2026-09-11 round 5）

- statusPanel からの `recordBtn.disabled` 書き込み 2 箇所（LOCKED disable / grant enable）を削除 — RecordSession sole-writer 契約を回復。LOCKED はバナー + badge（`statusTrustLocked` キー新設 ja/en）で伝達。
- `btnRequestAllUrls` に dataset.wired ガード（btnRequestPermission と同一パターン）。
- gateway から showSpinner を削除（spinner の show/hide ペアは record フロー側が所有）+ executeScript 本体の逐語重複を `executeScriptInnerText` adapter に統合。
- 関連テスト更新: statusPanel（recordBtn pin を新契約に）/ tabContentFetcher（spinner 非所有を pin）/ extra（LOCKED i18n モック追加）。
