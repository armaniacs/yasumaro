# PBI: 単発 restore 輸送の 7 層残留を削除する

## ユーザーストーリー
保守担当者として、dashboard 側呼び出し元が消失した旧単発 restore 輸送を削除したい、なぜなら staging チャンク転送への完全移行後も単発経路が 7 層に残留しており、二重経路は「同じ操作が 2 つの上限水準 (単発 10MB cap、staging チャンク) を持つ」状態を作り、削除しない限り seam の二重定義が残るから。

## ユーザーへの背景 (レビュー報告書: 既知 (b)、System Architect 指摘)
- dashboard 側呼び出し元は PBI 2026-11-26-01 で staging チャンク経路に完全移行済み (grep 裏取り: restore_db の呼び出し元は encryptedBackupService のみだった)
- 削除範囲 (System Architect 起案、file:line はレビュー報告書 2026-11-26-1113 の実測):
  - `src/messaging/sqliteWireTable.ts:805-811` ('restore' row)
  - `src/offscreen/sqliteMessageHandlers.ts:207-212` (handleRestore)
  - `src/offscreen/opfsWorker.ts:288-295` (RESTORE case)
  - `src/offscreen/opfsWorker/backupHandlers.ts:132-168` (handleRestore 本体、旧式 swap 155-165 を含む)
  - `src/offscreen/payloadGuard.ts:35,176-182` (SQLITE_RESTORE case、MAX_RESTORE_BYTES 100MB)
  - `src/background/sqlite/offscreenGateway.ts:175` (maintain 転送行)
- 関連後続 PBI: 本 PBI の後に PBI 2026-11-26-12 (swap 切り出し) と PBI 2026-11-26-13 (maintain ハンドラ table 派生) を着手する (ロードマップ)

## ビジネス価値
- 同一操作の二重経路と 2 つの上限水準が消え、seam の二重定義が解消される
- 測定方法: handleRestore / SQLITE_RESTORE の参照がゼロになり、restore staging 系テスト全緑、npm run validate 全緑

## BDD受け入れシナリオ

```gherkin
Scenario: 単発 restore の参照がゼロになる
  Given staging チャンク経路が唯一の復元経路である
  When 単発 restore の 7 層実装を削除する
  Then handleRestore と SQLITE_RESTORE の参照はソース内に存在しない
  And 復元 (分割ファイル群からの restore) は現行どおり成功する

Scenario: 大文字小文字の wire 整合 assert は維持される
  Given wire 表から 'restore' 行が削除される
  When offscreenGateway の two-way sync assert を実行する
  Then assert は通る (削除漏れはここで検出される)
```

## 受け入れ基準
- [ ] 削除範囲 (7 層) がすべて削除されている: sqliteWireTable 'restore' row、sqliteMessageHandlers handleRestore、opfsWorker RESTORE case、backupHandlers handleRestore 本体 (旧式 swap 含む)、payloadGuard SQLITE_RESTORE case (MAX_RESTORE_BYTES 100MB 定数も対象)、offscreenGateway maintain 転送行
- [ ] grep で handleRestore / SQLITE_RESTORE の参照がテスト・ドキュメントを除きゼロ
- [ ] offscreenGateway の two-way sync assert が通る
- [ ] restore staging 系テスト (restoreStagingHandlers、restoreChunkedTransport、payloadGuard coverage) が緑
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (既存 E2E が新経路を通る)

### 統合テスト
- payloadGuard coverage (fail closed) が新 table で通ること、restoreStaging 系の緑

### 単体テスト
- 削除に伴うテストの除去 (旧経路 pin の削除は「新契約への置換」として理由を明記) と、残存テストの緑

## 見積もり
M (5 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-26-1113-holistic-review-fix-encrypted-backup-large-capacity.md 既知 (b)、レビュー報告書 §1 の「主な構造的課題」、System Architect 指摘 (ロードマップ 4-5 位の前提)
- 外部挙動は完全に不変 (使用されない経路の削除のみ)
- 削除漏れ検出は two-way sync assert と payloadGuard coverage 試験 (fail closed) が担う
- MAX_RESTORE_BYTES (100MB、payloadGuard) は本 PBI の削除対象 (単発経路の handler ゲート)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -rn "handleRestore\|SQLITE_RESTORE\|MAX_RESTORE_BYTES" src/ --include="*.ts" | grep -v test | head -20
grep -rn "'restore'" src/messaging/sqliteWireTable.ts src/offscreen/payloadGuard.ts | head -8
```

### 実装手順
1. wire 表 'restore' row 削除 (two-way sync assert で削除漏れを検出)
2. sqliteMessageHandlers handleRestore 削除
3. opfsWorker RESTORE case 削除
4. backupHandlers handleRestore 本体削除 (旧式 swap 含む)
5. payloadGuard SQLITE_RESTORE case + MAX_RESTORE_BYTES 削除
6. offscreenGateway 転送行削除
7. 対応テスト削除・更新 (削除は理由を明記)、全ゲート実行

### 落とし穴
- backupHandlers の他の機能 (backup 作成系) は削除しない (handleRestore のみ)
- payloadGuard coverage 試験が「全 op が guard を持つ」ことを pin している場合、削除後の表と一致させる (期待値を黙って合わせず、削除の pin として更新)
- validateFullBackupFile は残す (staging commit が使用中)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新の要否判定: 内部構造の変更でユーザーに見える挙動不変のため、docs 更新は不要
