# PBI: 分割バックアップの作成側に復元側ゲートとの整合を保証する (結合長ゲート追加)

## ユーザーストーリー
大容量履歴 DB を持つ利用者として、分割形式でバックアップを作成したとき、そのファイル群が必ず復元できることを作成時点で知りたい、なぜなら現行は作成側がパート数 (16) しか検査せず、圧縮が効かない ~39MB 超 DB で「作成は成功するが復元で too-large と拒否される」不整合が起こるから。

## ビジネス価値
- 「作成が成功したバックアップは復元できる」不変条件が成立する
- 復元失敗という後発の静かな失敗の代わりに、作成時点で原因の明確な案内が出る
- 測定方法: 結合後 body 長が MAX_BACKUP_FILE_BYTES を超える入力に対し createSplitBackup が構造化エラーを返し、parseSplitBackup は変更なしで同水準の入力を拒否し続けること

## BDD受け入れシナリオ

```gherkin
Scenario: 結合長超過は作成時点で拒否される
  Given gzip で圧縮しても結合後 body 長が MAX_BACKUP_FILE_BYTES (50MiB) を超える履歴 DB がある
  When 分割形式でバックアップを作成する
  Then 作成は構造化エラー (split-backup-too-large) で失敗する
  And パートファイルは 1 つも書き出されない

Scenario: 上限ちょうどは作成できる
  Given 結合後 body 長が MAX_BACKUP_FILE_BYTES ちょうどの履歴 DB がある
  When 分割形式でバックアップを作成する
  Then 作成が成功し、16 パート以下のファイル群が得られる

Scenario: 復元側ゲートは据え置き
  Given 結合後 body 長が MAX_BACKUP_FILE_BYTES を超える分割バックアップがある
  When 復元を試みる
  Then 復元が too-large で拒否される (既存挙動を維持)
```

## 受け入れ基準
- [x] createSplitBackup に結合後 body 長 <= MAX_BACKUP_FILE_BYTES のゲートが追加されている (gzip 要否決定後の body で判定、パート構築前なので部分出力なし)
- [x] 超過時は既存の SplitBackupError の失敗区分に新区分 (split-backup-too-large) を追加して返す
- [x] panel が新区分を原因の分かる文言 (ja/en) で表示する (encryptedBackupSplitCreateTooLarge)
- [x] parseSplitBackup は変更しない (受信側防御点を維持)
- [x] 境界値試験 (ちょうど/超過、16 パート以下でも結合長超過で拒否) がある (codec 4 件 + service 1 件 + panel 2 件、Red 確認済み。base64 が 4 の倍数のため最小超過は cap+4 文字)
- [x] `npm run validate` が通る (type-check / lint / check:docs-chars / check-i18n / validate:json / 全 vitest 19,345/19,346。唯一の失敗は並行セッション編集中の docs/PRIVACY.md 同期待ちによる他セッション由来の失敗で、本 PBI 変更 stash でも再現するため無関係を特定済み。統合側で最終再実行)

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- (小規模構成) chunkChars を大きくして結合長超過を合成し、作成拒否と案内文言を画面で確認

### 統合テスト
- exportEncryptedSplitBackup が新失敗区分を伝播すること、panel の文言出し分け

### 単体テスト
- codec 境界: 結合長ちょうどで成功、1 文字超過で拒否、incompressible データでの超過検出
- 失敗時はパートファイル書き出し前であること (部分出力が無い)

## 見積もり
M (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 依存関係: PBI 2026-11-26-01 と直列 (panel のエラー文言を共有する可能性)。codec 自体は PBI 01 と独立
- 非機能要件: 復元側 (parseSplitBackup) のゲートは受信時メモリ増幅の防御点であり、緩和しない (VULN-008 趣旨)
- ユーザー向け上限の意味: 結合後 body は gzip 圧縮結果の base64 (圧縮効率次第で元 DB は 39MB 以上も可)。文言は「この履歴 DB は分割形式でも復元可能な上限を超えています。履歴を整理してから再試行してください」のような行動指針にする
- なぜなぜ分析 30 回: 作成/復元のゲート不一致は、復元側ゲートが同じ PBI 群で後から新設され、作成側への波及と cross-check が DoD に無かったこと。非対称ゲートは「形式の逆操作」の対称性を壊すため、作成側で拒否して整合させる

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "totalPlaintextLength\|MAX_BACKUP_FILE_BYTES\|too-many-parts" src/dashboard/encryptedBackupSplitCodec.ts
grep -rn "SplitBackupError\|splitBackup" src/dashboard/encryptedBackupPanel.ts | head -20
```
確認結果 (2026-11-26):
- parseSplitBackup は manifest.totalPlaintextLength > MAX_BACKUP_FILE_BYTES で too-large 拒否 (encryptedBackupSplitCodec.ts:582)
- createSplitBackup は chunkChars 分割と 16 パート上限のみ検査し、結合長を検査しない
- 失敗区分は SplitBackupError (unknown-format / too-many-parts など) で既存の枠がある

### 実装手順
1. codec 単体試験に境界試験を先に追加 (Red 確認)
2. createSplitBackup に結合長チェックを 1 箇所追加し新区分を返す (Green)
3. panel の文言出し分け (ja/en messages.json) と統合試験
4. Red-Green-Refactor で整える

### 落とし穴
- 結合長の対象は「gzip 適用後の body を base64 化した総文字数」(createSplitBackup が圧縮の要否を決めた後の値)。圧縮前の DB サイズと混同しない
- ESM import は .js 拡張子必須
- check-docs-chars 対象外のソースだが、i18n メッセージ (ja/en) は Shift-JIS 安全文字で書く

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (E2E/統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新済み (ユーザーガイドの上限表は PBI 2026-11-26-03 に含める)
