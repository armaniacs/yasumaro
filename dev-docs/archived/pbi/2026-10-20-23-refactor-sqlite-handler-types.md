# PBI 23: sqlite ハンドラ層の型整備（動的ディスパッチ・手書き対応・worker type）

## ユーザーストーリー
メンテナーとして、sqlite ハンドラ層の対応が wire table SSOT から派生した状態がほしい、なぜなら手書き対応と生リテラルは wire row 変更時に stale な対応を残し、misroute をコンパイルで検出できないから。

## 変更点の概要
sqliteMessageHandlers の動的ディスパッチ・手書き対応を wire table 派生へ、OpfsWorkerBackend の worker type を WORKER_MESSAGE_TYPES と結合する。archiveWireTable.test.ts の ARCHIVE_* 側同期ルールを非 archive 側へも適用する。

## 現状と問題
- src/offscreen/sqliteMessageHandlers.ts:298-299（stagingBackend の動的ディスパッチ）
- :344-354（query/mutate 側の 9 対応が手書き lambda、wire table の messageType⇔op ペアリングと二重管理。archive 側は :324-330 で table 派生済みで非対称）
- src/offscreen/OpfsWorkerBackend.ts:104（非 archive 17 メソッドの worker type が生リテラル、callWorker の第一引数は string。WORKER_MESSAGE_TYPES（opfsWorker/types.ts:14-52）との compile-time 結合も列挙同期テストもなし。ARCHIVE_* 側のみ archiveWireTable.test.ts:74-80 が同期済みで同期ルールが非対称）
- テスト: sqliteMessageHandlers-coverage.test.ts:87-89 が registry 完全性を pin（ペアリング対応自体は未検証）、opfsWorkerBackend-degradation.test.ts が proxy 往復を pin

## 変更の理由
[型安全性] wire row 側の messageType 変更・op 追加時に stale な手書き対応が残ってもビルドが通り、dead entry / misroute がコンパイルで検出できない。

## 提案コード（骨子）
- 9 対応を wire table から派生（archive 側と同一パターン）
- stagingBackend ディスパッチを型付きテーブルへ
- OpfsWorkerBackend の worker type を WORKER_MESSAGE_TYPES のキー型へ結合し、列挙同期テストを非 archive 側にも追加

## BDD受け入れシナリオ
Scenario: 対応の派生
  Given wire table の messageType⇔op ペアリング
  When 9 対応を派生させる
  Then 各 messageType が自分の行の op に dispatch され、実行時挙動は変更前と同一である

Scenario: 列挙同期の非対称解消
  Given WORKER_MESSAGE_TYPES に型を追加する
  When OpfsWorkerBackend を更新しない
  Then コンパイルまたは同期テストが検出する（ARCHIVE_* 側と同一の保護）

## 見積もり
1 pt（RICE: 12 = Reach 4 × Impact 3 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [x] 手書き対応が wire table 派生になり、動的ディスパッチが型付きテーブルになる
- [x] 列挙同期テストが非 archive 側にも付く
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- 手書き 9 lambda を SQLITE_WIRE_TABLE の BY_MESSAGE 派生で生成（archive 側と同一パターン。'search' 行は records と messageType を共有するため意図的に除外、既定 limit 100 を維持）
- stagingBackend の as unknown as Record 動的ディスパッチを ARCHIVE_BACKEND_CALLS: Record<ArchiveBackendMethod, ArchiveBackendCaller> の型付きテーブルに置換（this 束縛を構造的に保証、backendMethod 変更はコンパイルエラーに）
- OpfsWorkerBackend の callWorker/callWorkerOk 第一引数を WorkerMessageType（keyof WORKER_MESSAGE_TYPES）に結合（非 archive 側の生リテラルを SSOT に対して型検査）
- 新規 pin テスト: wireOpEnumerationDerived.test.ts（registry 構成・行ごと runner ルーティング・records>search の shadow 防止）、opfsWorkerBackend-workerTypeSync.test.ts（非 archive 列挙同期の両方向一致）
- 検証: 対象 12 スイート 261 テスト全 green、フルスイート 1112 ファイル / 16558 tests 全 green、type-check 通過、validate:fast green
