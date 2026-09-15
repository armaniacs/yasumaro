# PBI: createBackend のレジストリ化 — backend 追加を2箇所編集に

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、新しいストレージバックエンドの追加が backendResolver の switch と6箇所の同期編集ではなくレジストリ1行で完結してほしい。なぜなら現在はバックエンド追加時に6箇所（union / switch / host 状態 / init 順序 / 再解決 / factory 配線）の編集が必要で、InMemory adapter のような将来追加のコストが高いから。

## 優先度

- 順位: 2 / 本バッチ4件中
- RICEスコア: 7.5（Reach=6 / Impact=1 / Confidence=50% / Effort=0.4人週）
- 根拠: 機械的なレジストリ化。Confidence 50% は `setOpfsWorkerFactory` の順序制約（PBI 09-02 で導入）との相互作用を要検証するため

## 背景（診断結果）

- `src/offscreen/backendResolver.ts:51-80` — `createBackend` の switch（opfs/idb/fallback/none）がバックエンド毎の case を持つ
- バックエンド追加時の6編集箇所: BackendType union / createBackend switch / sqliteEngineHost の状態フィールド / init 順序 / 再解決経路 / worker factory 配線（opfsWorkerProxy:49-53）
- 対照: queryPlan の SECTIONS 派生や archiveWireTable は既にテーブル化済み — 同じ規律を backend にも

## 実装ガイド

1. **`createBackend` を `satisfies` 付き Map レジストリに置換**:
   ```ts
   const BACKEND_FACTORIES = {
     opfs: (context) => new OpfsWorkerBackend(context),
     idb: (context) => new IdbVfsBackend(context),
     fallback: (context) => new FallbackStorageAdapter(context.fallbackStorage),
     none: () => new NoopBackend(),
   } satisfies Record<BackendType, (context: SqliteEngineHost) => StorageBackend>;
   ```
2. **第二段階（任意・別判断）**: `setOpfsWorkerFactory` のグローバルを Host constructor 注入に — 本 PBI では scope 外とし、Factory 注入の追加のみ
3. **回帰**: backendResolver / sqliteEngineHost 関連テスト全件 + 実機の storage fallback 経路

### 触ってはいけないもの

- `setOpfsWorkerFactory` の API（PBI 09-02 で Firefox 移植のために導入 — 形は不変）
- opfsCapabilities.ts の実行時 fallback 構造

## BDD受け入れシナリオ

```gherkin
Scenario: バックエンド追加がレジストリ1行で完結する
  Given BACKEND_FACTORIES レジストリが存在する
  When  新しい BackendType と factory を追加する
  Then  createBackend の switch 編集が不要になる

Scenario: 未解決 backend が NoopBackend に落ちる
  Given resolved が 'none' の状態
  When  createBackend が呼ばれる
  Then  NoopBackend が返り、エラーにならない
```

## 受け入れ基準

- [x] `createBackend` の switch が `satisfies` 付き Map レジストリに置換されている（null 許容の factory 型で 'idb'/'fallback' の前提不成立を表現）
- [x] backendResolver / sqliteEngineHost 関連テスト全件 green（offscreen 1075 passed）
- [x] 'none' → NoopBackend のフォールバックが維持されている
- [x] `setOpfsWorkerFactory` の API が不変

## テスト戦略

- 既存: backendResolver / queryDispatchRegression / opfsWorker 関連テストが回帰網
- 単体: レジストリ網羅性（BackendType の全キーが factory を持つ）の型 assert

## 見積もり

2日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（backendResolver 先頭コメント）
