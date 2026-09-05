# PBI: SQLite 永続化層の多重バックエンド複雑性を整理

## ユーザーストーリー

拡張機能の保守担当者として、SQLite 永続化層のバックエンド構成を単純で見通しの良い形に整理してほしい、なぜなら OPFS・IDB・フォールバック・Noop が入り組んだ現状では不具合調査や変更の影響範囲特定に時間がかかるから

## 優先度

- 順位: 29 / 26
- RICEスコア: 83（Reach=500 / Impact=1 / Confidence=0.5 / Effort=3.0日）
- 根拠: 工数大・影響広範囲のため本PBIは実装ではなくスパイク調査に限定する。backlog 自体も「将来対応」または「スパイク調査」扱いを推奨している。

## BDD受け入れシナリオ（調査アウトプットの受入条件）

```gherkin
Scenario: バックエンド構成の全体像が文書化される
  Given 現行の src/offscreen/ 永続化層
  When  各バックエンドの役割・選択条件・移行経路を洗い出す
  Then  調査レポートに構成図相当の対応表と課題一覧が含まれる

Scenario: 整理案が比較可能な形で提示される
  Given 調査レポートの課題一覧
  When  統合・削減の選択肢を工数とリスク付きで列挙する
  Then  推奨案1件と代替案が明記され次の実装PBIに分割できる
```

## 受け入れ基準

- [ ] 調査レポートが `dev-docs/` 配下に配置されている
- [ ] 現行4層（opfs / idb / fallback / none）の選択条件と移行経路が表形式で整理されている
- [ ] 整理案が推奨1件＋代替案付きで提示され工数見積もりがある
- [ ] 後続の実装PBIへの分割案（ファイル単位の変更範囲付き）が含まれている

## テスト戦略

- スパイクのため新規テストは書かない
- 既存の `src/offscreen/__tests__/` と `sqliteEngineContext/__tests__/` が green であることを調査開始前後で確認し、現状のベースラインを記録する

## 実装アプローチ

コード変更は行わない。`backendResolver.ts` の優先順位定義を起点に各層を読み解き、レポートと整理案だけを成果物とする。統合の実装は後続PBIに委ねる。

## 見積もり

3ポイント（3.0日相当：読解2日＋レポート作成1日。Confidence=0.5 の主因は未読解部分の多さ）

## 実装者向け注記

- 調査起点: `src/offscreen/backendResolver.ts:1`（OPFS > IDB > Fallback > None の優先順位を一元管理する pure モジュールと自称）
- 現行スタック（`rg`・`ls` で確認済み）: `sqliteEngine.ts`（`useOpfsStorage`・`useIdbStorage` 経由で `@subframe7536/sqlite-wasm` を初期化）、`OpfsWorkerBackend.ts`＋`opfsWorker.ts`＋`opfsWorker/`（ワーカー経由 OPFS）、`IdbVfsBackend.ts`（IDB VFS）、`storageFallback.ts`（`FallbackStorage`・chrome.storage.local ベース・FTS なし線形探索）、`FallbackStorageAdapter.ts`（アダプタ）、`sqliteEngineContext/`（`fallbackMigration.ts`・`idbEngineLifecycle.ts`・`migrationBackup.ts`・`opfsWorkerProxy.ts`）、`sqliteEngineHost.ts`・`sqliteEngineContext.ts`・`StorageBackend.ts`（`NoopBackend` 含む）
- 追加の複雑性要因: `opfsMigrationV2.ts`・`opfsMigrationV2Reader.ts`・`opfsSpike.ts`・`opfsCapabilities.ts` とマイグレーション系が並存（どれが現役経路かも調査対象）。依存ライブラリは `@subframe7536/sqlite-wasm@1.3.1`（MIT）と `wa-sqlite@1.0.0`（package.json に license フィールドなし。詳細は PBI 31 参照）の2系統
- 注意: フォールバック層は FTS5 が使えず検索セマンティクスが異なるため、統合案では検索品質の差分を必ず評価項目に入れること

## Definition of Done

- [ ] 調査レポートがレビューされ推奨案への合意がある
- [ ] 後続の実装PBIが起票されている
- [ ] ドキュメント更新済み（ARCHITECTURE_MAP への反映があれば）
