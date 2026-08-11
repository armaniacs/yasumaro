# PBI: Architecture Deepening Epic

## ユーザーストーリー

開発者として、浅いmoduleのinterfaceに漏れている複雑性を適切なseamへ集約したい。これにより、変更のlocality、呼び出し側のleverage、interface越しのtestabilityを高めたい。

## 目的

以下の5つのアーキテクチャ上の摩擦を、依存順に解消する。

1. Saved URL entry moduleの低水準なstorage書き込みinterface
2. SQLiteとlegacy storageに分散したhistory query
3. SQLite history panelの内部test seam不足
4. Recording handlerの重複したdependency interface
5. review summaryの`AIClient`直接利用

## 実施順

1. `2026-08-11-02-deepen-saved-url-entry-module.md`
2. `2026-08-11-03-unify-history-query-module.md`
3. `2026-08-11-04-deepen-sqlite-history-panel-test-seams.md`
4. `2026-08-11-05-unify-recording-handler-interface.md`
5. `2026-08-11-06-migrate-review-summary-to-ai-service.md`

## 共通制約

- SQLiteと`chrome.storage.local`の移行中の二重書き込みを維持する。
- optimistic lock、mirror同期、retention、quota recovery、retryを維持する。
- history panelの既存表示、検索、pagination、tag filterを維持する。
- Chrome Manifest V3のService Worker lifecycleと非同期message契約を維持する。
- PII sanitization、token gate、provider設定、offscreen documentの制約を維持する。
- AIClientはprovider implementationとして残し、新規呼び出し側はAIServiceを利用する。
- 実際の複数adapterまたは明確なテストseamがない限り、新しいadapter interfaceを追加しない。
- 既存ADRに反する変更は、必要な再検討または例外記録を行う。

## 完了条件

- 5つの子PBIがすべて完了している。
- 各子PBIのBDDシナリオが成功している。
- 全体のtype check、test、buildが成功している。
- 記録、履歴表示、SQLite移行、AI要約が利用できる。
- storage、handler、providerの低水準知識が呼び出し側へ新たに漏れていない。
- 問題発生時は原因を特定し、必要に応じて20回以上のなぜなぜ分析を記録した上で解決する。

## 依存関係

```text
Saved URL entry module
        ↓
Unified history query module
        ↓
SQLite history panelの内部seam
        ↓
Recording handlerの共通interface
        ↓
review summaryのAIService移行
```

## BDD受け入れ条件

```gherkin
Scenario: 全ての深深化候補が依存順に完了する
  Given 親PBIと5つの子PBIが登録されている
  When 子PBIを定義された依存順に完了する
  Then 各子PBIが独立して検証可能である
  And 後続の子PBIが前段のinterfaceとseamを利用できる
  And 最終的な全体検証が成功する

Scenario: 既存の記録・履歴・AI機能が維持される
  Given 5つの深深化変更が適用されている
  When 記録、履歴表示、SQLite操作、review summaryを実行する
  Then 既存の成功フローが維持される
  And 失敗が成功や空結果へ変換されない
  And retry、sanitization、MV3 lifecycleが維持される
```

## 子PBI

- 子PBI 1: Saved URL entry moduleを深深化する
- 子PBI 2: Unified history query moduleを深深化する
- 子PBI 3: SQLite history panelの内部seamを深深化する
- 子PBI 4: Recording handlerの共通interfaceを深深化する
- 子PBI 5: review summaryをAIServiceへ移行する

 詳細なスコープ、非スコープ、BDD受け入れ条件、テスト観点、ADR関係は、同日付の設計仕様書と各子PBIファイルに記載する。

## アーカイブ理由

2026-08-11 に5つの子PBIをすべて完了し、Epicの目的を達成した。
残存していた「handler registry移設」は、影響範囲が独立しており
別PBIとして切り出す判断とした（`2026-08-XX-move-message-handler-registry-to-composition-root.md`）。

## 完了済み子PBI

- 2026-08-11-02-deepen-saved-url-entry-module.md
- 2026-08-11-03-unify-history-query-module.md
- 2026-08-11-04-deepen-sqlite-history-panel-test-seams.md
- 2026-08-11-05-unify-recording-handler-interface.md
- 2026-08-11-06-migrate-review-summary-to-ai-service.md

