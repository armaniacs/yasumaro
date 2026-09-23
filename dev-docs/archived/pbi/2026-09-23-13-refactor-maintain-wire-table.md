# PBI 2026-09-23-13 — maintain 系 wire-table 化（ゲートウェイ最終手配線の解消）

**優先度**: 順位 13 / RICE 12.8（Reach 4 × Impact 2 × Confidence 80% ÷ Effort 0.5 人週）
**根拠**: 前回 PBI-02 の直接の完成形。query/mutate/archive の行が実在・テスト済みのため、定義箇所の移動のみで wire 形状・セキュリティ政策の変更なし。offscreen hop の最後の手配線 Locality 分割を解消する。
**種別**: refactor（非機能追加）

## 背景

`offscreenGateway.ts` の `query()`（:90-105）と `mutate()`（:112-124）は `SQLITE_WIRE_DESCRIPTORS` 行経由、archive maintain（:151-167）は `ARCHIVE_WIRE_TABLE` 経由（`decodeResponse` 所有済み）だが、非 archive の maintain 7 分岐（init/backup/restore/clearAll/purgeOldRecords/purgeContent/healthCheck、:145-182）は gateway 本体の手配線 `callInternal`＋inline lambda（`(res) => new Uint8Array(res.data)`、`() => undefined`、`({purged})` 投影）のままである。各分岐が messageType＋payload 形状＋decoder を再綴りするため、形状変更が gateway で壊れ、`default: never` の網羅も残余のみを覆う。

## 実装戦略

1. 既存 wire-table Module に maintain 系を追加する（行ごとに `messageType`・`encodePayload`・`decodeGateway` を所有）。
2. 7 分岐 switch を `table.for(op.type)`＋`callInternal` の同一 Seam に溶かす。`callInternal` は単一 transport/error-mapping Seam として残す。
3. archive 経路には触れない。wire 形状の変更はしない（定義箇所の移動のみ）。
4. `backup` の binary decode（`Uint8Array`）と `purgeContent` vs `purgeOldRecords` の messageType 分割をバイト同一に保ち、各行に parity test を追加する。

## 受け入れ基準（BDD）

### シナリオ 1: 新 maintain op の追加は 1 行で完結する
- **Given** 新しい maintain op の追加タスク
- **When** wire-table に行を 1 行追加する
- **Then** overload＋switch 分岐＋decoder の 3 箇所編集は不要である

### シナリオ 2: decoder 網羅がコンパイル強制になる
- **Given** maintain 表の行集合
- **When** 行を追加・削除する
- **Then** 対応する decoder の有無が型で検出される（query/mutate と同水準）

### シナリオ 3: gateway 振る舞いは不変
- **Given** 7 maintain op の全パターン
- **When** 現行と新 dispatch の実行結果を比較する
- **Then** messageType・payload・decode 結果が同一である

## DoD（Definition of Done）

- [ ] 7 分岐 switch が表駆動 dispatch（約 10 行）に縮退する
- [ ] 各行に parity test が追加される
- [ ] 既存の gateway / wire-table テストが無修正で緑
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
