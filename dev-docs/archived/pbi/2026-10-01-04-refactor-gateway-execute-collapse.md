# PBI: OffscreenGateway の `execute(op)` 畳み込み

## ユーザーストーリー

保守担当の開発者として、gateway の 30 超の overload 列挙を 1 実行 seam に畳みたい、なぜなら実体はすべて `table.for(op) + callInternal` で、op 追加のたびに table と runner に加えて overload 列の手更新が要る 3 箇所編集になるから。

## 優先度

- 順位: 4 / 7（2026-10-01 arch-delivery-loop ラウンド。全体像は [00-backlog-archloop-1001](2026-10-01-00-backlog-1001.md)。B1 と同点で推奨強度により後順）
- RICEスコア: 16.0（Reach=30 / Impact=1 / Confidence=0.8 / Effort=1.5）
- 根拠: table 駆動の既存同期 assert を活かし手列挙を消す。依存なし（S3 の前提になる）。

## 背景

- `src/background/sqlite/offscreenGateway.ts`（218 行、`callInternal`＋30 超 overload）、`src/messaging/sqliteWireTable.ts`（827 行の 3 table）、`src/messaging/archiveWireTable.ts`（573 行）、`src/messaging/transportRetryPolicy.ts`、`src/messaging/sqliteRpcClient.ts`（`QueryOp`/`MutateOp`/`MaintainOp`）。

## BDD受け入れシナリオ

```gherkin
Scenario: 既存 op が execute 経由で通る
  Given 任意の QueryOp / MutateOp / MaintainOp
  When gateway.execute(op) を呼ぶ
  Then 従来の専用メソッドと同一の結果・同一の retry 方針で完走する

Scenario: retry 方針が table に一元化される
  Given row 所有の retryPolicy を持つ op
  When execute で送る
  Then transport 適用は callInternal の単一 seam だけで行われる
```

## 受け入れ基準

- [x] runtime の公開 interface を `execute(op: QueryOp | MutateOp | MaintainOp)` に畳む（overload は型 level の薄い adapter として残してよい）
- [x] `retryPolicy` 適用を `callInternal` の単一 transport seam に寄せる（全 branch が execute → callInternal の 1 seam のみで transport に触る。row 所有の retryPolicy は policy table 由来の宣言データとして据え置き、適用は transport の table lookup が唯一の判断点。caller 側 override を追加しない — 既存 pin「leaves toggleStar retry policy to the transport」が ground truth）
- [x] wire 形状・table 行・runner map に挙動変更なし（compile 時の双方向 sync assert を維持）
- [x] ADR-014 の channel 分割（SW↔offscreen と offscreen↔worker の型分離）を崩さない

## テスト戦略

- 単体: execute 経由の query/mutate/maintain 各 1 件の透過テスト＋retry 適用の一元化テスト → `src/background/__tests__/gatewayExecuteSeam.test.ts`
- 既存: wire table の sync assert テストは不変で通ること
- 統合: `npm run validate` が通ること

## 見積もり

1.5 SP（要チームでの見積もり）

## 実装記録（2026-10-01）

- `execute(op: SqliteGatewayOp)` を新設（`SqliteGatewayOp = QueryOp | MutateOp | MaintainOp`）。判別は `isQueryOp`（guard param を union 全体に拡張）→ `isSqliteWireOp(op.type)`（mutate）→ `isArchiveOpType`（archive maintain）→ `sqliteMaintainWireFor`（非 archive maintain）の 4 branch。drift した lookup は fail-closed
- query/mutate/maintain の実装 body を `execute` へ委譲する薄い adapter に畳み（overload 列は call-site 型精度のため保持）。dispatch logic の手更新は消滅し、op 追加は table 行 + （必要なら）overload 1 行のみ
- `callInternal` は全 branch 共通の単一 transport seam のまま。retry 適用の caller 側 override は追加しない（transport の `shouldRetryTransport` table lookup が唯一の判断点。既存 pin テスト 2 件が wire 形状を pin）
- 試行後撤回: row の `retryPolicy` を `noRetry` opt として transport に流す実装を一度試したが、既存 pin（`seenOpts` が `[{}]` — gateway は caller 側 override を渡さない）と矛盾するため撤回。適用は transport seam のまま
- テスト新設: `gatewayExecuteSeam.test.ts`（query/mutate/maintain/records 各 1 件の透過 parity、unsafe row での override 不在、未知 op の fail-closed）
- 検証: `npm run validate` green（988 ファイル / 15,247 tests passed）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test / build が通る
- [x] コードレビュー完了
