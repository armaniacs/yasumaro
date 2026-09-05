# PBI: VfsStrategy/BackendType 不整合の解消と sqliteEngineContext 別名の削除

優先度: スパイク推奨 PBI-C1（S） / RICE: 保守性のみのため参考値なし
backlog: [dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md](../dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md)（重複候補 4・5、PBI-C1 切り出し案）
依存: なし（Option A のゲート外で実行可能）

## ユーザーストーリー
診断パネルでストレージ状態を確認する利用者・開発者として、表示される VFS 戦略が実行時の実際のバックエンド選択と一致してほしい、なぜなら実装されていない `opfs-async-main`（案B）が表示候補に残っており、IDB 実行時に誤った戦略名を表示するから。また開発者として、実体への薄い別名モジュール（`sqliteEngineContext.ts`）が 18 箇所から import され続けている状態を解消してほしい、なぜなら別名経由の参照は canonical な `sqliteEngineHost.ts` への到達を回り道にするから。

## 現状（スパイク調査済み）
- `opfsCapabilities.ts:34` の `VfsStrategy` に `opfs-async-main`（案B・未実装）が含まれ、`selectVfsStrategy:49` が「OPFS ディレクトリ有り・sync handle 無し」環境でこれを返す。しかし `backendResolver.ts` に対応 Backend は存在せず、実行時は IDB へ直接転落する（デッドパス）
- `DiagnosticsCollector.ts:146-148` が非 OPFS・非 fallback のケース（＝IDB）を `opfs-async-main` と誤表示。`diagnoseDeficiencies.test.ts:68` は `as` キャストで `'idb'` を無理やり型に通している（ギャップの自白）
- `sqliteEngineContext.ts` は `sqliteEngineHost.ts` の再エクスポート別名（15 行）で、src/ 内 18 ファイルが import

## BDD受け入れシナリオ
```gherkin
Scenario: IDB 実行時の診断表示が実バックエンドと一致する
  Given OPFS が使えず IDB で初期化された環境
  When  診断スナップショットを生成する
  Then  vfsStrategy は 'idb' を示し、'opfs-async-main' は型・表示のどこにも現れない

Scenario: 別名モジュールが消えても既存の振る舞いが変わらない
  Given sqliteEngineContext.ts が削除された状態
  When  旧 import 群を sqliteEngineHost.js 直参照に付け替えて全テストを実行する
  Then  全テストが green で、SqliteEngineHost の公開面は不変である
```

## 受け入れ基準
- [x] `VfsStrategy` が `'opfs-sync-worker' | 'idb' | 'fallback'` になり、`opfs-async-main` が型・実装・表示・テストから消えている
- [x] `selectVfsStrategy` は「OPFS ディレクトリ無し → fallback」「sync handle + Worker 有り → opfs-sync-worker」「OPFS ディレクトリ有りだが sync 無し → idb（resolver が実際に選ぶ先）」を返し、resolver が権威であることをコメントで明示している
- [x] `DiagnosticsCollector` の非 OPFS・非 fallback ケースが `'idb'` を表示する
- [x] `sqliteEngineContext.ts` が削除され、src/ 内の import が全て `sqliteEngineHost.js` 直参照になっている
- [x] 全テスト green（振る舞い変更なし・表示ラベルの正確化のみ）

## テスト戦略
- opfsCapabilities / diagnoseDeficiencies / DiagnosticsCollector の各テストを新語彙に更新（`as` キャストの解消を含む）
- 回帰: 全 suite green

## 見積もり
0.5 日（S）

## 実装者向け注記
- 調査: スパイク `dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md`（重複候補 4・5）
- 確認コマンド: `rg -n "opfs-async-main" src/`、`rg -ln "sqliteEngineContext.js" src/`（18 files）、`rg -n "SqliteEngineContext[^.]" src/`
- 注意: `sqliteEngineContext/` ディレクトリ（opfsWorkerProxy / idbEngineLifecycle / fallbackMigration）は別物であり削除対象外。名前が紛らわしいので diff レビュー時に注意
- 後続: 本 PBI の後、クエリ共通化（PBI-C2・M）を起票可能

## Definition of Done
- [x] 全BDDシナリオがパスする
- [x] コードレビュー完了
- [x] ドキュメント更新（スパイクレポートの重複候補 4・5 に完了印）

## 実装メモ（2026-09-05・branch 0905c）
- 完了: `VfsStrategy` を `'opfs-sync-worker' | 'idb' | 'fallback'` に変更（案B `opfs-async-main` は未実装のため削除、`selectVfsStrategy` の第 3 分岐は resolver が実際に選ぶ `idb` を返す）。DiagnosticsCollector の IDB ケース表示を `'idb'` に修正（diagnoseDeficiencies.test の as キャストも解消）。別名 `sqliteEngineContext.ts`（15 行）を削除し、18 ファイルの import（vi.mock / 動的 import 含む）を `sqliteEngineHost.js` 直参照に付け替え、`SqliteEngineContext` 型名も `SqliteEngineHost` に統一。全 suite 11,658 tests green + build OK。

## 実装メモ（2026-09-05・branch 0905c）
- 完了（commit `ff52f1c7`、controller-direct）。全 suite 11,658 tests green + build OK + lint 0 errors。スパイクの重複候補 4・5 に完了印を追記済み。
