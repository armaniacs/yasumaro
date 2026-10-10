# PBI: 監査ログ行形状の 8 重宣言を sqlite-types SSOT に統合する

- 種別: refactor
- RICE: 4.7（R7 × I1 × C1.0 / E1.5）
- 依存: なし
- バッチ: W2

## ユーザーストーリー

保守担当者として、監査ログの wire 行形状が唯一の家を持っていてほしい。なぜなら field 追加 1 件が 8 ファイル編集を要求する状態は drift 温床だから。

## 背景（現状）

`{ id: number; provider: string; url: string; created_at: number }` という wire 契約が 8 箇所で宣言:

1. `src/messaging/sqliteRpcClient.ts:111` — `AuditLogRecord`
2. `src/messaging/sqliteValidators.ts:76` — `AuditLogEntryView`（同一ディレクトリで再宣言）
3. `src/messaging/auditLogGateway.ts:17` — `AuditLogEntry`
4. `src/messaging/dashboardSqliteProtocol.ts:161` — インライン（`rows: Array<{...}>`）
5. `src/background/handlers/dashboardSqlite/deps.ts:75` — インライン
6. `src/dashboard/dashboardSqliteService.ts:476` — インライン
7. `src/dashboard/utils/auditLogTsv.ts:10` — `AuditLogEntry`（同名別定義）
8. `src/utils/sqlite-types.ts:140` — `AuditLogRecord` + `AuditLogEntry`（既に所有候補として実在。`AuditLogEntry extends AuditLogRecord`）

field 追加 1 件が 8 ファイル編集を要求。クローズ済み「audit_log codec twins」（decode 関数の双子）とは別角度（型宣言の重複）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 行形状の field 追加が 1 編集で完結する
  Given 監査ログ行形状の所有が src/utils/sqlite-types.ts に 1 本化されている
  When 監査ログに新しい field を追加する
  Then 編集は sqlite-types.ts の 1 箇所のみである

Scenario: 型検査が wire 契約の drift を捉える
  Given messaging・dashboard・background の各消費者が sqlite-types から型 import している
  When 行形状を変更する
  Then 消費側の型は compile 時に追従し、手書きコピーは存在しない
```

## 受け入れ基準

- [x] `src/utils/sqlite-types.ts` の `AuditLogRecord` / `AuditLogEntry` を唯一の所有にする
- [x] `sqliteRpcClient.ts` / `sqliteValidators.ts`（`AuditLogEntryView = AuditLogEntry` エイリアス化）/ `auditLogGateway.ts` / `dashboardSqliteProtocol.ts` / `deps.ts` / `dashboardSqliteService.ts` / `auditLogTsv.ts` を型 import に置換
- [x] 宣言の重複が 0 件（rg で `{ id: number; provider: string; url: string; created_at: number }` が sqlite-types.ts のみ）
- [x] 既存テストが green（wire 挙動不変）
- [x] messaging → utils の import は既存確立パターン（レイヤー境界違反でないことを LAYERS.md で確認）

## テスト戦略

- unit: 既存の監査ログ系テスト（`src/offscreen/__tests__/auditLogCodec.test.ts` / `sqlite-auditLog.test.ts` / dashboard 側）が green
- 型整合: type-check が追従（消費側の import が自動追従する設計）
- 挙動不変: wire 挙動・validator 挙動は変更しない（型の統合のみ）

## 見積もり

1.5 SP

## 技術的考慮事項

- `dashboardSqliteProtocol.ts` の条件型内のインライン行形状は `AuditLogEntry` 参照に置換（`rows: Array<AuditLogEntry>`）
- utils/sqlite-types.ts の `AuditLogRecord` は `id` を持たない派生元（`AuditLogEntry extends AuditLogRecord` で id を追加）— 所有先として既に正しい形
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. 各宣言箇所を `AuditLogEntry`（または `AuditLogRecord`、insert 用は id なしを確認）import に置換
2. `sqliteValidators.ts` の `AuditLogEntryView` は `type AuditLogEntryView = AuditLogEntry` エイリアスに（isAuditLogEntry の型述語は不変）
3. `auditLogTsv.ts` の同名 `AuditLogEntry` を import に（列挙フィールドが一致することを type-check で確認）
4. `rg -n "id: number; provider: string; url: string; created_at: number" src/` で sqlite-types.ts のみを確認
5. `npm run type-check` + `npx vitest run src/offscreen src/messaging src/dashboard` で検証

### 落とし穴

- offscreen テスト fixture（`sqlite-auditLog.test.ts:10` の interface AuditLogRecord）は fixture 内の型で残してもよいが、production 型参照に置換する方が drift しない
- protocol.ts の条件型は `Array<AuditLogEntry>` にすると union 分布が変わらないことを type-check で確認

## Definition of Done

- [x] 行形状宣言が sqlite-types.ts の 1 箇所のみ
- [x] 7 消費者が型 import に置換
- [x] `npm run type-check` が green
- [x] 既存監査ログテストが green
- [x] ロールバック不要（型統合のみ）
