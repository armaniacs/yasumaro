# PBI 2026-09-23-06 — 互換 shim 削除: popup/tabUtils.isRecordable

**優先度**: 順位 6 / RICE 15.0（Reach 3 × Impact 0.5 × Confidence 100% ÷ Effort 0.1 人週）
**根拠**: 前ラウンド PBI 2026-09-23-05 で生産呼び出しが 0 になった shim の確定削除。削除しても複雑さは集中も分散もしない（移行完了の証明）。0.1 週のマイクロタスクで先に片付ける。
**種別**: refactor（非機能追加）

## 背景

`src/popup/tabUtils.ts:21` の `isRecordable` は gate 表駆動化の移行で残置された互換 shim である。`recordSession.ts` の 4 決定点（:94,198,210,407）はすべて中立層 `recordingGateTable.ts` の `isRecordableTab` を呼び、`main.test.ts` も新 Seam の mock に寄っている。残る参照は自身の単体テスト（`tabUtils.test.ts:33-51`）と stale mock 行のみ。

## 実装戦略

1. `tabUtils.ts` から `isRecordable` を削除する。
2. `tabUtils.test.ts` の該当 describe 節を削除する。
3. `main.test.ts` の mock から `isRecordable` キーを外し、gate-table Seam の mock に寄せる。
4. 実装時に `grep` で生産 importer 0 を再確認する（`dashboardSqliteService` エイリアス・`recordingDecision` re-export には触れない）。

## 受け入れ基準（BDD）

### シナリオ 1: shim が消える
- **Given** `tabUtils.ts` の公開関数一覧
- **When** `isRecordable` を削除する
- **Then** 生産コードの import 参照が 0 件であり、`type-check` が緑である

### シナリオ 2: 振る舞いテストは失われない
- **Given** gate-table の recordability マトリクステスト
- **When** shim のテスト節を削除する
- **Then** 判定の網羅性（true/false 分岐）は gate-table テスト側に残り、popup の振る舞いテストは全緑である

## DoD（Definition of Done）

- [ ] `tabUtils.isRecordable` が存在せず、生産 importer が 0 件
- [ ] 削除されたテスト節の振る舞いが gate-table テストで pin されている
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
