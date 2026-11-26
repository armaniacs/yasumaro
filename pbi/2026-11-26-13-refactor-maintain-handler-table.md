# PBI: maintain op の offscreen ハンドラを wire-table 派生に統一する

## ユーザーストーリー
保守担当者として、offscreen 側の maintain op ハンドラを query/mutate・archive と同型の wire-table 派生 registry にしたい、なぜなら query (`sqliteMessageHandlers.ts:461-474`) と archive (`487-493`) は「op 追加 = 1 行」の派生 registry で済む一方、maintain 系だけは手書きハンドラ 4 連 (`218-247`) + 登録 4 行 (`518-522`) の 2 箇所編集が必要で、次の maintain op 追加 (台帳 07 の後続候補含む) で同じ 2 箇所編集が再来するから。

## ユーザーへの背景 (レビュー報告書: テーマ 2 [影響度: 中 | 難易度: 中])
- 現状: `SQLITE_MAINTAIN_WIRE_TABLE` (`src/messaging/sqliteWireTable.ts:790-903`) は background→offscreen の codec しか所有せず、offscreen 側ハンドラは手書き。restore session で 4 op を追加したとき wire row 4 行 (`sqliteWireTable.ts:817-856`) と offscreen ハンドラ 4 個 + 登録 4 行 (`sqliteMessageHandlers.ts:218-247, 518-522`) の 2 箇所編集が発生した
- 派生済みの対比: `sqliteMessageHandlers.ts:461-474` (wireMessageHandlers)、`487-493` (archiveMessageHandlers)、既存の `SQLITE_REPO_RUNNERS` パターン (`87-159`) が型を与える
- 前提依存: PBI 2026-11-26-14 (単発 restore 7 層削除) の後に着手する (runner 表が最小になるタイミング)

## ビジネス価値
- maintain op 追加が「wire row 1 行」で済む (query/mutate/archive と同型)
- 測定方法: maintain row が offscreen runner 名を持ち、offscreen 側の registry が wire-table 派生で構築され、既存の 4 op 動作が変わらないこと (restore staging 系テスト全緑)

## BDD受け入れシナリオ

```gherkin
Scenario: maintain op 追加が 1 行になる
  Given maintain row が offscreenRunner 名を持つ派生 registry がある
  When 新しい maintain op が wire row 1 行で追加される
  Then offscreen 側の追加は runner 関数 1 個のみで済む

Scenario: payload coercion は runner 側の層ポリシーのまま
  Given restore_chunk の payload は base64 デコードを必要とする
  When runner が実行される
  Then base64 検査 (現 handleRestoreAppend の try/catch) は runner 内に移設され、挙動は不変
```

## 受け入れ基準
- [ ] `SQLITE_MAINTAIN_WIRE_TABLE` の row に `offscreenRunner` 名が追加されている (層ポリシーは runner 側に残す)
- [ ] `sqliteMessageHandlers.ts` に `MAINTAIN_RUNNERS` (record 形式) と `maintainMessageHandlers` (wire-table 派生 registry) が実装されている
- [ ] `handlerRecord` から handleRestoreBegin/Append/Commit/Abort の手書き 4 連と登録 4 行が削除され、派生 registry が spread されている
- [ ] `satisfies Record<SqliteMessageType, SqliteHandler>` の網羅 assert が維持されている
- [ ] 各ハンドラの try/catch (handleRestoreAppend の base64 検査 `sqliteMessageHandlers.ts:227-232` など) は runner 内にそのまま移設されている (エラーハンドリングの維持)
- [ ] 既存 restore staging テスト群が緑 (外部挙動不変)
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (既存 E2E が復元経路を通る)

### 統合テスト
- restoreStagingHandlers / restoreChunkedTransport / archive 系 (無変更で緑)

### 単体テスト
- wire-table 派生 registry の網羅 assert (全 maintain op が runner に解決されること) + 付随テストの無変更確認

## 見積もり
M (5 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-26-1113-holistic-review-fix-encrypted-backup-large-capacity.md テーマ 2 [影響度: 中 | 難易度: 中]、ロードマップ 5 位 (PBI 14 の後)
- 外部挙動は完全に不変 (派生 registry への移設のみ)。op 固有の payload coercion (base64 デコード) は層ポリシーなので runner 内に残す
- これは archive で段階判断された worker 層の switch 折りたたみ (`opfsWorker.ts:208-219`、既知の STAGED 判断とは別物) ではなく、offscreen document 層の話 (レビュー報告書の区別)
- 副産物: `restoreSessionHandler.ts:47-106` の 4-case switch は `deps.ts:45-61` の `TableDrivenDescriptor` で折りたためるが、影響が診断ログの一貫性のみで小さいため、本 PBI の副産物として扱う (レビュー報告書 §4)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "SQLITE_MAINTAIN_WIRE_TABLE\|handleRestoreBegin\|handleRestoreAppend\|handleRestoreCommit\|handleRestoreAbort" src/messaging/sqliteWireTable.ts src/offscreen/sqliteMessageHandlers.ts | head -16
grep -n "SQLITE_REPO_RUNNERS\|wireMessageHandlers\|archiveMessageHandlers" src/offscreen/sqliteMessageHandlers.ts | head -8
```
前提確認: PBI 2026-11-26-14 (単発 restore 7 層削除) が完了していること

### 実装手順
1. SqliteMaintainWireOpDescriptor に offscreenRunner 名を追加
2. MAINTAIN_RUNNERS (record 形式) を実装 (現 4 ハンドラの本体を移設)
3. maintainMessageHandlers (派生 registry) を実装し handlerRecord に spread
4. 既存 4 ハンドラと登録行を削除、網羅 assert を通す

### 落とし穴
- row 型の変更は `satisfies` で wire-table 側と同期する (offscreenGateway の two-way sync assert にも注意)
- runner への移設で payload の型緩みを持ち込まない (decode は wire-table の decodeGateway、runner は already-decoded を受ける)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新の要否判定: 内部構造の変更でユーザーに見える挙動不変のため、docs 更新は不要
