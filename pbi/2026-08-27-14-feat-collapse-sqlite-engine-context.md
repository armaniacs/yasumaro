# PBI: SqliteEngineContext Facade の SqliteEngineHost への集約

## ユーザーストーリー
開発者として、`SqliteEngineContext` の4つの `State` cast による共有可変 `this` を1つの `SqliteEngineHost` にカプセル化したい、なぜなら `this` を4つの異なる State としてキャストして共有し、初期化順序が facade にしかなくテストが `Worker`/`chrome.storage`/`indexedDB` の全モックを要するから。

## 優先度
- 順位: 3 / 7
- RICEスコア: 360（Reach=60 / Impact=2 / Confidence=80% / Effort=0.35）
- 根拠: 初期化競合の再現困難さがテスト工数を押し上げる。Strong かつ QueryPlanner との統合で相乗。

## なぜなぜ分析
- なぜ漏洩するか: `get opfsProxyState(): OpfsProxyState { return this }` で同一オブジェクトを4つの State として共有
- なぜ分割が逆効果か: 各抽出モジュールは純関数だが認知負荷は facade → 4ファイル往復に増加
- 解: `SqliteEngineHost { init(), exec(), getStatus() }` の1 seam に状態をカプセル化

## BDD受け入れシナリオ
Scenario: ハッピーパス — 初期化が一括で完結する
  Given `SqliteEngineHost` を生成する
  When `init()` を呼ぶ
  Then `Worker` → `IDB` → `Fallback` のフォールバック分岐が内部で完結する

Scenario: エッジケース — 並行 init が競合しない
  Given 2並行で `init()` を呼ぶ
  When 両方が完了する
  Then 1回のみ初期化され、もう片方は待機する

## 受け入れ基準
- [ ] `SqliteEngineHost` が `init`/`exec`/`getStatus` の3メソッドのみを公開する
- [ ] `opfsWorkerProxy`/`idbEngineLifecycle`/`migrationBackup` の4 State が内部に隠蔽されている
- [ ] `opfsWorkerProxy-coverage` テストが `Worker` モックなしで単体で検証可能

## テスト戦略
- 単体: `SqliteEngineHost.init` の再入・失敗・fallback 分岐テスト
- 統合: 実 `chrome.storage` + `Worker` モックで初期化→クエリ→close のライフサイクル検証
- E2E: `wasm-boundary` で WASM load タイムアウト時の fallback を検証

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
