# Deep-dig findings — Architecture deepening PBI implementation

## 対象

親PBI `pbi/2026-08-11-01-architecture-deepening-epic.md` と子PBI 1〜5の実装計画。

## 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|---|---|---|---|
| metadataの一括保存は既存のbest-effortで十分 | 高 | field更新失敗はqueue対象外で、部分保存と成功判定が曖昧 | 一括操作を原子扱いにし、一回のCASでtimestampとmetadataを更新する |
| 既存queueはentry追加payloadだけで足りる | 高 | metadata失敗を再実行できず、retry後もfield欠落が残る | payloadをmetadata patch対応へ拡張し、既存payloadも読み続ける |
| timestampとmetadataは別更新でよい | 高 | 並行更新、lock競合、Service Worker終了で中間状態が残る | timestampとmetadataを一回のCASで更新し、操作全体をretryする |
| bucket keyでlegacy metadataを全SQLite行へ適用できる | 高 | 同一URL・同一分に複数行があると誤結合する | 同一bucketでは最新のSQLite行だけをenrichment対象にする |
| unified queryは全legacy読み取り経路へ即時適用する | 中 | legacy panelとduplicate checkの回帰範囲が大きい | まずSQLite history panelへ適用し、他経路は既存のまま維持する |
| panelの非同期応答順序は実用上問題ない | 高 | 多重fetchとunmount後の遅延応答がstale state/DOMを書き得る | fetch世代番号とmounted判定で最新応答だけ反映する |
| handler depsの共通部分を型合成すれば十分 | 中 | 未使用のobsidian、AIService、SqliteClient等がinterfaceに残る | handlerが実際に使う最小メソッドだけを依存させる |
| AIServiceは新しいoffscreen所有者を必要とする | 高 | 現状Built-in AIはService Workerから直接呼ばれ、AIServiceはoffscreen非依存 | AIServiceはoffscreen非依存と記録し、陳腐化した記述を更新する |
| summary関数へAIServiceを毎回引数で渡すのが最も明示的 | 中 | alarm、message、testへ広い変更が波及する | factoryでAIServiceとSQLiteClientを閉じ込め、同じ生成物を各経路で共有する |

## なぜなぜ分析の適用方針

今回の主要な高リスク前提は、既存のfield単位書き込み、storage payload、bucket matching、非同期panel、AI lifecycleに集中していた。各回答で直接原因からデータ整合性・呼び出し契約・所有権まで掘り下げ、実装方針を確定した。実装中に根本原因が未確定の問題が発生した場合は、同じ形式で20回以上のなぜなぜ分析を継続し、結果を記録する。

## 新たに発見したリスク

- `SavedUrlEntry`の`title` fieldが型定義と保存経路で不整合なため、一括保存契約で扱いを明示する必要がある。
- legacy timestampは同URLの記録で上書きされるため、enrichmentは完全な履歴結合ではなく「最新行への補完」として定義する必要がある。
- SQLite panelのtag filterは短いタグのためclient-side filteringを使う既存制約があり、query統合でserver-sideへ移さない。
- `AIService`の`AISummaryResult.success`がoptionalなため、fake test fixtureは明示的な成功・失敗shapeを使用する。
- `reviewSummaryGenerator`のmodule-scope shared SQLite clientはService Worker束縛を持つため、factory生成はcomposition rootからのみ行う。

## 未解決の疑問と実装時の既定値

- metadata queueの具体的なversion discriminator: 既存payloadを壊さない判別可能なpatch payloadを採用する。
- metadata patchの欠損値: `undefined`は「更新しない」、明示的な空値が必要なfieldだけ既存型のnull/空配列規則を使う。
- 同一bucketの最新行判定: SQLite rowの`created_at`を第一キー、`id`を同値時のtie-breakerにする。
- panel世代管理の競合判定: `requestGeneration`と`isMounted`を確認し、古い応答のstate反映・enrichment更新・refreshを破棄する。
- AI用途のoffscreen: 新たなlifecycle moduleを追加せず、AIServiceの既存provider経路を使う。

## 決定事項

1. 子PBI 1は一回のCASでSaved URL entryを更新し、metadata patchをqueueへ保持する。
2. 子PBI 2はSQLite history panelから統一query moduleを利用し、同一bucketでは最新SQLite行だけenrichmentする。
3. 子PBI 3はpanelのstate/render判断を内部seamへ移し、request generationでstale responseを防ぐ。
4. 子PBI 4は実際に使う最小依存だけをhandler interfaceへ残し、共通closureをcomposition rootで一度だけ構築する。
5. 子PBI 5はfactoryでAIServiceを注入し、AIServiceはoffscreen非依存として記録する。
6. AIService移行後はADRのreview summary例外と陳腐化したoffscreen所有権記述を更新する。

## 参照した重要ファイル

- `src/background/pipeline/steps/saveMetadataStep.ts`
- `src/utils/storage/savedUrlStore.ts`
- `src/background/pendingChromeStorageQueue.ts`
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`
- `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts`
- `src/background/handlers/messageHandlers.ts`
- `src/background/createBackgroundServices.ts`
- `src/background/reviewSummaryGenerator.ts`
- `src/background/reviewSummaryAlarm.ts`
- `src/background/ai/AIService.ts`
- `src/background/sqliteClient.ts`
