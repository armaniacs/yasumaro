# PBI: 分割バックアップの形状検証を純粋関数に集約する

## ユーザーストーリー
保守担当者として、分割バックアップの形状検証ルール (パート数上限、index/total 整合、重複、不足) を 1 つの純粋関数に集約したい、なぜなら現行は復号前の UX 案内用 (panel) と復号後の権威検証用 (codec) に 2 実装が分散し、パート数上限の検査だけで panel 3 箇所 + codec 1 箇所の計 4 箇所に書かれている。新ルール追加が 5 箇所編集になり、層間の文言整合リスクが常時あるから。

## ユーザーへの背景 (レビュー報告書: テーマ 5 [影響度: 低 | 難易度: 低])
- 現状: panel 側 `src/dashboard/encryptedBackupPanel.ts:345-399` (逐次読みの早期打ち切り検証)、`442-453`、`503-599` (マニフェスト/パート群検証、`setStatus + resetInput + return` が ~15 回反復)。codec 側 `src/dashboard/encryptedBackupSplitCodec.ts:574-579` (parts cap)、`604-621` (part-count/length 照合)、`702-714` (missing 計算、`findMissingPartIndices` と同型)
- 多層防御自体は意図的で正しい (KDF を走らせる前に不足・順序誤りを弾く、VULN-036 の順序維持)。問題は「ルール」が 2 箇所に書かれていること

## ビジネス価値
- 新ルール追加 (例: パート長上限) が 5 箇所編集から 1 箇所編集になる
- panel を通過した入力が codec で弾かれるときの文言が層間で整合する
- 測定方法: checkSplitBackupShape の単一実装が存在し、panel は問題コードの i18n 写像のみ、codec は権威検証で同一関数を再実行し、既存 codec/panel テスト 34 件超が pin として残ること

## BDD受け入れシナリオ

```gherkin
Scenario: 同一関数の 2 回呼びで多層防御が維持される
  Given checkSplitBackupShape の単一実装がある
  When panel (復号前) と codec parseSplitBackup (復号後) が同一関数を呼ぶ
  Then 両層で同一の問題コードが検出される (fail-closed は codec 側必須検証で維持)

Scenario: 形状問題は i18n に写像される
  Given panel に不足パートがある状態でファイル群が選択された
  When checkSplitBackupShape が missing-parts を返す
  Then panel は既存どおり対応する i18n 文言を表示する (挙動不変)
```

## 受け入れ基準
- [ ] `encryptedBackupSplitCodec.ts` に `checkSplitBackupShape` (純粋、復号なし、KDF なし) が追加されている: `SplitShapeProblemCode = 'too-many-parts' | 'out-of-range-index' | 'duplicate-index' | 'total-mismatch' | 'missing-parts' | 'envelope-too-long'` を返す
- [ ] panel の逐次検証 (345-399、442-453、503-599) が同一関数呼び出しに集約され、`setStatus + resetInput + return` の反復が 1 か所の失敗ハンドラに集約されている
- [ ] codec の parseSplitBackup は既存どおり自分でも同一関数を再実行する (権威検証)
- [ ] 既存の codec/panel テスト 34 件超が pin として残り、緑である (挙動不変)
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (既存 E2E が分割復元を通る)

### 統合テスト
- encryptedBackupPanel-split 試験群 (無変更で緑)

### 単体テスト
- checkSplitBackupShape の純粋関数テスト (各問題コードの境界: cap ちょうど/超過、重複、不足、total 不一致)

## 見積もり
S (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-26-1113-holistic-review-fix-encrypted-backup-large-capacity.md テーマ 5 [影響度: 低 | 難易度: 低]、ロードマップ 3 位
- 外部挙動は完全に不変 (検証の順序と結果、文言は変わらない。集約は実装の重複解消のみ)
- YAGNI の注意: 「変わる理由が同じ」候補だけを集約する。panel と codec は「同じ形状ルールで同時に変わる」関係 (ルール変更は常に両層に波及する) なので共通化は過剰でない

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "MAX_SPLIT_PART_COUNT" src/dashboard/encryptedBackupPanel.ts src/dashboard/encryptedBackupSplitCodec.ts | head -8
grep -n "findMissingPartIndices" src/dashboard/encryptedBackupSplitCodec.ts
```

### 実装手順
1. checkSplitBackupShape を codec に追加 (純粋関数、既存ルールを 1 箇所に)
2. parseSplitBackup から同一関数を呼ぶ (既存ロジックの置換、挙動不変)
3. panel の逐次検証を関数呼び出し + i18n 写像に置換
4. 単体テスト追加、既存テストで pin 確認

### 落とし穴
- panel の逐次読み (stream で part を読みながらの早期打ち切り) は checkSplitBackupShape の「全部分既知」前提と合わない場合がある。逐次打ち切りの部分は checkSplitBackupShape を部分入力でも使える形にするか、逐次は現状のまま残し「形状ルールの定数と判定」だけ集約する (差分最小を選び、判断を報告に記録)
- 既存の i18n キーと文言は変えない (ユーザーに見える文言の変更は本 PBI のスコープ外)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新の要否判定: 内部構造の変更でユーザーに見える挙動不変のため、docs 更新は不要
