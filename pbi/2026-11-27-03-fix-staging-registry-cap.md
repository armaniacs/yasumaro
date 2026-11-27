# PBI: OPFS worker の staging-session registry に create-spam の cap/TTL を設ける (CWE-400 Low)

## ユーザーストーリー
保守担当者として、archive/restore の staging-session registry に並行セッション上限と TTL を設けたい、なぜなら現行は `registry.set` が無条件で、extension-page の create-spam が worker メモリ (Map) と OPFS root (0-byte ファイル) を offscreen 再起動まで無制限に肥大させる (VulnHunter VULN-001、CWE-400 Low) から。confirm token の MAX_CONFIRM_TOKENS=100 前例 (confirmTokenManager.ts:27,140) が同種 create-spam の解決策として存在する。

## ビジネス価値
- データ層 (offscreen/worker メモリ + OPFS root) の可用性を固定定数で保護する
- 測定方法: exploit test 001 の create-spam (5000 archive + 2000 restore prepares) が cap 到達で fail-closed になり、TTL 経過後の eviction で registry が回復すること

## BDD受け入れシナリオ

```gherkin
Scenario: cap 到達で fail-closed になる
  Given staging registry が cap (SSOT 定数) に達している
  When 新しい prepare 呼び出しが来る
  Then fail-closed で拒否され、registry と OPFS root は cap 以下のまま

Scenario: TTL 経過後は eviction で回復する
  Given cap に達した registry に TTL 経過のセッションがある
  When 新しい prepare 呼び出しが来る
  Then TTL 経過セッションが eviction され (OPFS ファイルも orphan sweep で削除)、新しいセッションが受理される
```

## 受け入れ基準
- [ ] archiveStaging.ts と restoreStaging.ts に cap 到達後の fail-closed 拒否 + TTL eviction が実装されている
- [ ] cap / TTL は src/utils/limits.ts に SSOT 定数として追加 (例: MAX_ARCHIVE_STAGING_SESSIONS / MAX_RESTORE_STAGING_SESSIONS + STAGING_SESSION_TTL)
- [ ] eviction 時は OPFS ファイルを既存 orphan-sweep helpers で削除する
- [ ] exploit test 001 を新契約 (cap 到達 fail-closed + eviction 回復) pin に更新
- [ ] 既存 restore staging テスト群 (ハードニング含む) が緑
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (統合 pin で裏取り)

### 統合テスト
- restore staging 系テスト群 (既存緑)

### 単体テスト
- cap 境界 (cap ちょうど受理、+1 拒否)、TTL eviction (clock 注入)、eviction でのファイル削除

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/phase2b_output.md VULN-001 (CONFIRMED Low)、phase3_output.md fix strategy
- 外部挙動: cap 到達時の拒否は新挙動 (create-spam 時のみ、正常フローには影響なし)。eviction は orphan sweep と同一メカニズム
- 依存関係: なし (confirmTokenManager 前例に倣う)
- ロールバック: cap/TTL 定数を limits.ts から削除し無条件登録に戻す (1 コミット)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '30,45p' src/offscreen/opfsWorker/archiveStaging.ts
sed -n '34,50p' src/offscreen/opfsWorker/restoreStaging.ts
sed -n '20,30p' src/background/confirmTokenManager.ts
```

### 実装手順
1. limits.ts に MAX_ARCHIVE_STAGING_SESSIONS / MAX_RESTORE_STAGING_SESSIONS / STAGING_SESSION_TTL を追加
2. prepareIncoming / prepareOutgoing / prepareRestoreIncoming に cap チェック (TTL eviction 後の再試行) を追加
3. exploit test 001 を新契約 pin に更新

### 落とし穴
- eviction の OPFS ファイル削除は既存 sweepOrphanStagings / sweepOrphanRestoreStagings helpers を使う (重複実装しない)
- cap は archive と restore で別定数 (経路が異なるため、片方の spam が他方を枯渇させない)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了 (セキュリティ変更のため For Security Review Agents 観点を PR 説明に明記)
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: cap/TTL 定数削除で旧挙動に戻る (1 コミット)
- [ ] ドキュメント更新の要否判定: 内部上限のため docs 更新は不要
