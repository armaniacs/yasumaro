# PBI: 暗号化バックアップ復元ホップの分割輸送 (staging チャンク方式)

## ユーザーストーリー
履歴の多い利用者として、分割形式の暗号化バックアップ (PBI 2026-11-23-01/02) を復元したい、なぜなら復号後の DB 転送が base64 一発の `restore_db` メッセージで、ワイヤバリデータ `MAX_RESTORE_DB_BYTES = 10,000,000` 文字 (DB 実体約 7.5MB) に当たり、分割形式で作成した大容量バックアップが復元直前に失敗するから。

## ビジネス価値
- 分割形式で作成できるバックアップが、実際に復元できるようになる (作成と復元の能力の一致)
- 復元時のエラー文言が「data exceeds 10000000 chars」ではなく原因の分かる案内になる
- 測定方法: 30MB 級履歴 DB を含む分割バックアップの作成と復元が、実ワイヤ経路 (dashboard -> service worker -> offscreen -> OPFS) で往復成功すること

## BDD受け入れシナリオ

```gherkin
Scenario: 大容量 DB が分割輸送で復元される
  Given 分割形式で作成した 30MB 級履歴 DB のバックアップがある
  When 別プロファイルでマニフェストとパート群を選択しパスワードを入力する
  Then 履歴と設定が復元される
  And 復元途中のどの単一メッセージも MAX_RESTORE_DB_BYTES を超えない

Scenario: チャンク転送の中断は既存データを壊さない
  Given 復元セッションの途中で転送が失敗した
  Then 既存の履歴 DB は変更されない
  And 失敗した staging ファイルは後片付けされ、次回 begin で掃除される

Scenario: 改変したセッションは拒否される
  Given restore_commit で totalBytes が実際の転送量と不一致
  Then 復元が拒否される
  And 既存の履歴 DB は変更されない
```

## 受け入れ基準
- [ ] 30MB 級 DB を含む分割バックアップの作成と復元が実ワイヤ経路で成功する (統合試験で裏取り)
- [ ] 復元経路の各メッセージが既存 cap 内 (restore_chunk.data は MAX_RESTORE_CHUNK_BASE64 以下)
- [ ] SW が staging 状態をメモリに持たない (stagingName を各メッセージで運ぶ、MV3 エフェメラル規則)
- [ ] confirm token (create_confirm_token + scopeHash) が新 3 subtype に適用される
- [ ] 旧 `restore_db` 単発経路が dashboard 側から除去され、呼び出し元が無いことを確認の上で削除する
- [ ] エラー文言が原因特定できる形でユーザーに届く
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存 encrypted-backup E2E が新経路を通る (restoreDb 置換により自然に回帰ガードになる)

### 統合テスト
- dashboard クライアント (チャンク分割) -> SW handler -> offscreen staging -> commit による DB 差し替えの往復
- totalBytes 不一致、途中失敗、残置 staging の掃除

### 単体テスト
- 新 3 subtype の validator 境界 (data 長ちょうど/超過、offset 非負、stagingName 形式、正整数)
- SW handler の offscreen deps への委譲とステートレス性の pin
- dashboard クライアントのチャンク分割ロジック (順序、offset 累積、失敗時 abort)

## 見積もり
L (8 SP、要チームでの見積もり)

## 技術的考慮事項
- 依存関係: PBI 2026-11-26-02/03 より先行する (本 PBI が土台)。ただし本 PBI と PBI 02 は codec ファイルを共有しないため、実装は直列を推奨 (panel のエラー文言が重なる可能性)
- 非機能要件: VULN-008 の趣旨 (受信時メモリ増幅の抑制) を維持する。各メッセージが cap 内に収まること。cap の引き上げは行わない
- 設計詳細は [dev-docs/plans/2026-11-26-pbi01-restore-chunked-transport-plan.md](../dev-docs/plans/2026-11-26-pbi01-restore-chunked-transport-plan.md) を参照
- なぜなぜ分析 30 回: 復元ホップが 1 発送信のまま残った根本原因は、アーカイブの staging 方式 (offscreen 内完結) が復元方向 (dashboard -> offscreen への大量書き込み) に転用されてこなかったこと。staging チャンク方式は archive_incoming_ 前例と opfsWorker の既存 RESTORE 実装を再利用する

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -rn "MAX_RESTORE_DB_BYTES\|MAX_RESTORE_BASE64_BYTES" src/ --include="*.ts" | grep -v __tests__
grep -rn "restore_db" src/ --include="*.ts" | grep -v __tests__
grep -rn "restoreDb" src/ --include="*.ts" | grep -v __tests__
```
確認結果 (2026-11-26):
- 復元呼び出しの dashboard 側起点は encryptedBackupService.ts:199 の restoreDb (dashboardSqliteService.ts:347 が restore_db を送る) のみ
- ワイヤバリデータは validators.ts:624-629 (10M 文字 cap)、handler は maintenanceBatchHandler.ts:197-212 (150MB pre-decode、到達不能)
- offscreen 側は OpfsWorkerBackend.restoreDb -> opfsWorker RESTORE -> backupHandlers.handleRestore (一時ファイル検証 + 差し替え)
- archive の staging 前例: archivePrepareIncoming / stagingName 検証 (archive_incoming_<uuid>.db) / archiveExport の offset/length チャンク

### 実装手順
1. Outside-In: 統合試験 (30MB 級 DB の復元往復、失敗を確認) から書く
2. plan のワイヤ契約に従い messaging -> SW -> offscreen -> dashboard クライアントの順に実装
3. 旧 restore_db の削除は、dashboard 側の呼び出し元が新経路に置き換わった後で行う
4. Red-Green-Refactor で各層を潰す

### 落とし穴
- ESM import は .js 拡張子必須
- SW 変数に staging 状態を持たない (MV3 規則)。stagingName は各メッセージで運ぶ
- offscreenGateway の wire 表 two-way sync assert と payloadGuard の coverage 試験が fail closed で拾う。スキーマ漏れは試験で落とす
- validators-limits.test.ts の restore_db 試験 (101 行付近) は新契約の pin に書き直す。期待値を黙って合わせない
- append の offset は実バイト単位。base64 文字単位と混同しない
- offscreen 側の 'restore' maintain op (単発 Uint8Array) の削除は波及が大きい。波及が過大なら残し、判断と理由を実装報告に記録する

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (E2E/統合/単体すべて)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新済み (ユーザーガイドの復元上限は PBI 2026-11-26-03 で更新するため、本 PBI では ENGINEERING 側の整合のみ確認)
