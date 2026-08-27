# PBI: SqliteEngineContext Facade の SqliteEngineHost への集約

## ユーザーストーリー
開発者として、`SqliteEngineContext` の4つの `State` cast による共有可変 `this` を1つの `SqliteEngineHost` にカプセル化したい、なぜなら `this` を4つの異なる State としてキャストして共有し、初期化順序が facade にしかなくテストが `Worker`/`chrome.storage`/`indexedDB` の全モックを要するから。

## 優先度
- 順位: 3 / 7
- RICEスコア: 210（Reach=60 / Impact=2 / Confidence=80% / Effort=0.60） — 2pt (0.35w) は過小。Word 3メソッド制約では `OpfsWorkerBackend`/`IdbVfsBackend`/`backendResolver` の書き換えがスコープ漏れ。薄い alias で 3pt、完全カプセル化で 5pt。
- 根拠: 初期化競合の再現困難さがテスト工数を押し上げる。Strong だが QueryPlanner (PBI-12) 確定後に薄い alias として残すのが ROI 最大。`migrationBackup` は 2026-12-17 まで削除禁止で Host 内に埋もれると sunset を妨害。

## なぜなぜ分析
- なぜ漏洩するか: `get opfsProxyState(): OpfsProxyState { return this }` で同一オブジェクトを4つの State として共有
- なぜ分割が逆効果か: 各抽出モジュールは純関数だが認知負荷は facade → 4ファイル往復に増加。`withTransaction` 抽出で 718→268行に縮小済みで、Host 集約の ROI は低下
- 解: 最小案: `SqliteEngineContext` を `SqliteEngineHost` の alias + private `#state` 集約の薄いリファクタに留め、`init/getBackend/execWithCache/getStatus/resetForTesting` + `DB_FILENAME/MAX_QUERY_LIMIT/extractDomain` re-export を維持。完全カプセル化は PBI-03 sunset 後に再評価

## BDD受け入れシナリオ
Scenario: ハッピーパス — 初期化が一括で完結する
  Given `SqliteEngineHost` を生成する
  When `init()` を呼ぶ
  Then `Worker` → `IDB` → `Fallback` のフォールバック分岐が内部で完結し、`getBackend()` で取得できる

Scenario: エッジケース — 並行 init が競合しない
  Given 2並行で `init()` を呼ぶ
  When 両方が完了する
  Then `Mutex` により1回のみ初期化され、もう片方は待機する。要件に `Mutex` 導入を明記

## 受け入れ基準
- [x] 薄い alias 案: `SqliteEngineHost` が `init/getBackend/execWithCache/getStatus/resetForTesting` + `DB_FILENAME/MAX_QUERY_LIMIT/extractDomain` re-export を維持。`init/exec/getStatus` 3メソッドのみの制約は緩和
- [x] 完全カプセル化案では `sendToOpfsWorker`/`tryOpfsProxy` を Host 外に非公開化し `StorageBackend` 経由のみにする（本PBIでは薄い alias を採用）
- [x] `migrationBackup` の sunset ゲートを Host 外に切り出し、2026-12-17 削除時に `git rm` で完結する
- [x] `opfsWorkerProxy-coverage` テストが `Worker` モックなしで単体で検証可能

## テスト戦略
- 単体: `SqliteEngineHost.init` の再入・失敗・fallback 分岐テスト。並行 init は `Mutex` + `chrome.storage.session` ロックで検証
- 統合: 実 `chrome.storage` + `Worker` モックで初期化→クエリ→close のライフサイクル検証。`resetForTesting`/`resetBackend` の振る舞いを移植
- E2E: `wasm-boundary` で WASM load タイムアウト時の fallback を検証。IDB 側タイムアウトも追加

## 見積もり
3pt（薄い alias, 要チームでの見積もり） — 完全 Host は 5pt

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
