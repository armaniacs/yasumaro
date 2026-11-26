# PBI: restore commit の swap 手続きを engine 非依存の純粋手続きに切り出す

## ユーザーストーリー
保守担当者として、検証済み staging ファイルで live DB を置き換える手続き (退避 → move → 失敗ロールバック → backup 削除) を純粋な OPFS 手続きとして切り出したい、なぜなら現行は handleStageRestoreCommit が「セッション整合」「ファイル実測照合」「バックアップ検証」「エンジン close」「swap」「再初期化」の 6 変更理由を抱え、swap の安全実装 (checking-team レビューで追加済み) が commit ハンドラに埋め込まれているから。

## ユーザーへの背景 (レビュー報告書: テーマ 3 [影響度: 中 | 難易度: 中])
- 現状: `src/offscreen/opfsWorker/restoreStagingHandlers.ts:106-189` (検証 113-142、エンジン close 146-150、swap 157-177、initSqlite 179-187)。対応する旧式 swap: `src/offscreen/opfsWorker/backupHandlers.ts:155-165` (単発 restore、既知 (b) の削除対象領域)
- 保護テスト: `src/offscreen/__tests__/restoreStagingHandlers-hardening.test.ts` (swap ロールバック pin)
- 前提依存: PBI 2026-11-26-14 (単発 restore 7 層削除) の後に着手する (handleRestore が消えた後、swap は staging 一本になり、切り出し先が commit に一本化される)

## ビジネス価値
- commit ハンドラが「セッション整合と検証」だけになり、単体テストがモックなしで書ける
- swap 安全実装が単一の手続きになり、将来の swap 利用箇所 (分割作成 staging 等) が同じ安全手続きを使える
- 測定方法: swapVerifiedStagingIntoLive の単体テスト (モックなしの純粋 OPFS fake) が存在し、commit ハンドラから swap コードが消え、hardening テストの swap 系 4 件が切り出し先に移設されて緑であること

## BDD受け入れシナリオ

```gherkin
Scenario: swap は単一の純粋手続きとして動作する
  Given 検証済み staging ファイルと既存 live DB がある
  When swapVerifiedStagingIntoLive が呼ばれる
  Then live DB は backup 名へ退避し、staging が live path に置かれ、backup は削除される
  And staging move 失敗時は live DB が復元される (ロールバック)

Scenario: commit ハンドラは呼び出し順だけを保持する
  Given swap が手続き化された後の handleStageRestoreCommit がある
  When commit が実行される
  Then validateFullBackupFile → swapVerifiedStagingIntoLive → initSqlite の呼び出し順が維持される (外部挙動不変)
```

## 受け入れ基準
- [ ] `swapVerifiedStagingIntoLive` (engine に依存しない純粋 OPFS 手続き、restoreStaging.ts または新規 restoreSwap.ts) が切り出されている
- [ ] handleStageRestoreCommit は validateFullBackupFile → swap → initSqlite の呼び出し順を保持し、swap コード本体がハンドラから消えている
- [ ] WHY コメント (非アトミック性説明、restoreStagingHandlers.ts:152-156) は切り出し先に移設されている
- [ ] hardening テストの swap 系 4 件 (非アトミック swap ロールバック等) が切り出し先の単体テストとして移設され、緑である
- [ ] 既存 restoreStagingHandlers.test.ts 系が緑 (外部挙動不変)
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (既存 E2E が復元経路を通る)

### 統合テスト
- restoreStagingHandlers 試験群 (外部挙動不変)

### 単体テスト
- swapVerifiedStagingIntoLive の純粋手続きテスト (成功 / move 失敗ロールバック / DB 未存在 / backup 削除) ― モックなしの OPFS fake

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-26-1113-holistic-review-fix-encrypted-backup-large-capacity.md テーマ 3 [影響度: 中 | 難易度: 中]、ロードマップ 4 位 (PBI 14 の後)
- 外部挙動は完全に不変 (ロールバックとエラー文言をそのまま移設)
- エンジン close/setEngine は opfsWorker.ts のアダプタ (opfsWorker.ts:107-111) 側に残す
- 副作用分離の原則: 切り出した手続きは pure な OPFS 操作 (engine/getEngine に依存しない) なのでモックなしでテストできる

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "PRE_RESTORE_BACKUP_SUFFIX\|move(backupName)\|removeEntry(backupName" src/offscreen/opfsWorker/restoreStagingHandlers.ts
grep -n "getEngine\|setEngine\|initSqlite" src/offscreen/opfsWorker.ts | head -8
```
前提確認: PBI 2026-11-26-14 (単発 restore 7 層削除) が完了していること (backupHandlers.ts:155-165 の旧式 swap が消えていること)

### 実装手順
1. swapVerifiedStagingIntoLive を新設 (review 報告書のスケッチ: root と stagingHandle を受け取り、退避 → move → ロールバック → backup 削除)
2. handleStageRestoreCommit から swap コードを削除し呼び出しに差し替え (WHY コメント移設)
3. hardening テストの swap 系 4 件を移設 (または swap 手続きテストとして再 pin)
4. 既存テスト全て緑を確認

### 落とし穴
- エンジン close は swap に含めない (レビュー報告書: opfsWorker.ts アダプタ側に残す。swap 手続きは engine に依存しない)
- 移設時の import 追加は .js 拡張子必須
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新の要否判定: 内部構造の変更でユーザーに見える挙動不変のため、docs 更新は不要
