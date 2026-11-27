# PBI: backup 経路の byte 増幅を予算境界で止める (CWE-400 Low)

## ユーザーストーリー
保守担当者として、`backup_db` の応答を JS number array (byte ~8x 増幅) ではなく、作成側バイト予算 (MAX_BACKUP_FILE_BYTES 50 MiB) を満たす形式にしたい、なぜなら現行は `handleBackup` が OPFS DB 全体を `file.arrayBuffer()` で読み (バイト予算なし)、`sqliteMessageHandlers.ts:204-211` が `Array.from(result.data)` で再実体化し、wire hop で増幅する (VulnHunter VULN-002、CWE-400 Low) から。

## ビジネス価値
- backup 経路のメモリ増幅をバイト予算で対称化する (restore/panel 側の MAX_BACKUP_FILE_BYTES と 1 定数で両方向)
- 測定方法: exploit test 002 を新契約 pin に更新 (over-budget backup が fail-closed、in-budget backup は base64 で届く)

## BDD受け入れシナリオ

```gherkin
Scenario: over-budget backup は fail-closed になる
  Given MAX_BACKUP_FILE_BYTES (50 MiB) を超える OPFS DB がある
  When backup_db が実行される
  Then 予算超過で拒否され、Array.from による増幅配列は作られない

Scenario: in-budget backup は期待形式で届く
  Given 予算内の OPFS DB がある
  When backup_db が実行される
  Then応答データが base64 (または直接転送) で届き、restore/panel が消費できる
```

## 受け入れ基準
- [x] handleBackup (backupHandlers.ts:76-80) が file.arrayBuffer() 前にバイト予算 (MAX_BACKUP_FILE_BYTES) を強制し、over-budget は fail-closed で拒否する
- [x] sqliteMessageHandlers.ts:204-211 の Array.from を予算チェック後の base64 (または直接転送) に置換している
- [x] exploit test 002 を新契約 pin に更新
- [x] 既存 backup 経路テスト (restore/panel 側) が緑
- [x] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (統合 pin で裏取り)

### 統合テスト
- backup 経路テスト群 (新契約 pin)

### 単体テスト
- 予算境界 (in-budget 通過、over-budget 拒否)、増幅なし (配列長 pin 削除)

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/phase2b_output.md VULN-002 (CONFIRMED Low)、phase3_output.md fix strategy
- 外部挙動: over-budget backup が拒否される新挙動 (限界容量到達時のみ、現行も部分的取得に相当)。in-budget backup は現行どおり
- 依存関係: MAX_BACKUP_FILE_BYTES は既存 (limits.ts:171、restore/panel 側で使用) ― 新定数は不要
- ロールバック: Array.from 形式に戻す (1 コミット)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '200,215p' src/offscreen/sqliteMessageHandlers.ts
sed -n '68,84p' src/offscreen/opfsWorker/backupHandlers.ts
grep -n "MAX_BACKUP_FILE_BYTES" src/utils/limits.ts src/dashboard/encryptedBackupPanel.ts | head -3
```

### 実装手順
1. backupHandlers.ts に file.size 事前チェック (MAX_BACKUP_FILE_BYTES) を追加
2. sqliteMessageHandlers.ts の Array.from を base64 エンコード (または direct transfer) に置換
3. exploit test 002 を新契約 pin に更新、境界試験追加

### 落とし穴
- 旧形式 (Array.from) を期待する応答コードがあるか確認 (backupDb の呼び出し元 encryptedBackupService/exportLogsService が data: number[] を期待していないか)
- base64 化は ~1.33x 増幅 (Array.from は ~8x) ― wire validator の cap (MAX_RESTORE_BYTES 系が削除済みなら要確認) に抵触しないか
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (統合/単体)
- [x] コードレビュー完了 (セキュリティ変更のため For Security Review Agents 観点を PR 説明に明記)
- [x] リファクタリング完了 (グリーン後)
- [x] ロールバック手段: Array.from 形式に戻す (1 コミット)
- [x] ドキュメント更新の要否判定: 内部転送形式のため docs 更新は不要
