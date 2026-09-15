# PBI: archiveWireTable 派生化 — 5重投影の規律を構造で閉じる

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、archive op の追加が wireTable の1行で完結してほしい。なぜなら gateway decoders / dispatch / deps の手書き複製は silent-drop（field 追加時の欠落）リスクを規律依存にしており、新 op 追加のたびに3ファイル編集が必要だから。

## 優先度

- 順位: 3 / 全候補数 11
- RICEスコア: 28.0（Reach=14 / Impact=1 / Confidence=80% / Effort=0.4人週）
- 根拠: wireTable 自体は模範的な深い module（14 op + 三方向型 assert）。残るのは派生漏れ3箇所のみで、機械的置換で解消できる

## 背景（診断結果）

- wireTable 自体は模範的: 14 op の routing+codec を1行に畳み、三方向 compile-time assert（`MaintainOp:518-524`、`SqliteMessage:528-534`、`DashboardSubtype:540-545`）
- 3箇所の漏洩:
  1. `src/background/sqlite/offscreenGateway.ts:64-94` `ARCHIVE_GATEWAY_DECODERS` — `decodeResponse / projectFields` と field-for-field で一致が必要な二重投影（backlog-future の「5 projections 要集約」の残滓）
  2. `src/offscreen/sqliteMessageHandlers.ts:237-252` `ARCHIVE_DISPATCH` — 14エントリの手書き Record。`ARCHIVE_DESCRIPTORS`（archiveWireTable.ts:512-514 派生）と同型
  3. `src/background/handlers/dashboardSqlite/deps.ts:195-211` — 14個の `encodeRequest` ラッパー手書き
- つまり `project / pickProjectedFields / GATEWAY_DECODERS / projectDeps / decodeResponse` の5投影の一致義務が interface に書かれておらず、人間の規律に依存

## 実装ガイド

1. **descriptor に `gatewayDecode` を追加**: `decodeResponse` を正規化して gateway が再利用できる形にする（interface 不変・implementation 追加）
2. **`ARCHIVE_DISPATCH` を派生 Map に置換**: `ARCHIVE_DESCRIPTORS` から生成し、`satisfies` による網羅性検査を維持
3. **`deps.ts` のラッパーを派生に置換**: `projectDeps` が `project` と異なる唯一例（`archivePrepareIncoming`）だけ例外として明示的に残す
4. **回帰**: `archiveWireTable.test.ts` の green 確認 + 各 op の e2e（dashboard issue-report 経路など）で据え置き確認

## BDD受け入れシナリオ

```gherkin
Scenario: 新 archive op の追加が1行で完結する
  Given archiveWireTable に descriptor が1行ある
  When  新しい op を追加する
  Then  gateway decoder・dispatch・deps は派生で自動生成され、手書き編集が不要になる

Scenario: field 追加時の silent-drop が構造で防がれる
  Given 既存 op の response に field を追加する
  When  decodeResponse に反映し忘れる
  Then  三方向型 assert がビルド時に失敗する
```

## 受け入れ基準

- [x] `ARCHIVE_GATEWAY_DECODERS` / `ARCHIVE_DISPATCH` が wireTable 派生に置換されている（`Object.fromEntries` + `as unknown as` キャスト — キー幅の narrowing はコンパイラが推論できないため）
- [x] `deps` ラッパーは**型保持のため手書きを維持**（診断時の想定と変更）: 各ラッパーの位置引数は encodeRequest と ArchiveDeps member の両方に対して型検査され、テーブル派生にすると呼び出し側の型が消える。depsMethod compile-time assert が op↔member 同期を担保 — 理由を deps.ts に文書化済み
- [x] wireTable の decodeResponse throw 契約が gateway にも適用され、欠落 field の silent undefined が解消（preview / stagingName 欠落時は SqliteResult error として表面化）
- [x] archiveWireTable.test.ts 全件 green + 三方向 assert が機能している + dashboard e2e 7 passed

## テスト戦略

- 既存: archiveWireTable.test.ts + dashboard issue-report e2e が回帰網
- 単体: 派生 Map の網羅性 assert（三方向型 assert の維持）

## 見積もり

1-2日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（wireTable 先頭コメントに派生の説明）
