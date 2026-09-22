# PBI: アーカイブ復元のワーカ側リソース上限

type: fix（VULN-004 Medium）

## ユーザーストーリー
ダッシュボードでアーカイブを復元する利用者として、復元処理が細工済みファイルでフリーズやメモリ枯渇を起こさないようにしたい、なぜなら復元は untrusted な `.db` を取り込む操作であり、現状はワーカ側に上限がないから。

## 優先度
- 順位: 3 / 6
- RICEスコア: 12（Reach=3 / Impact=2 / Confidence=1.0 / Effort=0.5）
- 根拠: 実害はハング・OOM（Medium）だが復元操作時限定のため Reach は小さい。修正は上限値の追加が中心で Effort も小さい。

## 背景（2026-09-22 時点の現状）
- VULN-004（CWE-400、Medium、テスト PASS）: `src/offscreen/opfsWorker/archiveRestoreHandlers.ts:88-142` の復元ループは `RESTORE_BATCH=5000`（`:35`）で LIMIT バッチを回すが、総行数・総バイトのシーリングがない。
- 唯一の上限はクライアント側で、`src/dashboard/.../archivePanel.ts:437` の `MAX_ARCHIVE_FILE_BYTES=200MiB` と `src/offscreen/opfsWorker/archiveGuards.ts:13` 定義に依存し、ワーカは再チェックしない。
- 実証: 12,000 行の細工アーカイブが全行 `sqlExec` に到達する。
- `src/offscreen/opfsWorker/archiveValidation.ts:193-219`（`validateArchiveEngine`）はメタ数の一貫性チェックのみで上限ではない。
- 監査エビデンス: `obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/README.md` の VULN-004（PoC: `poc/VULN-004_unbounded_archive_restore.md`、テスト: `exploit_tests/test_vuln_004_unbounded_archive_restore.test.ts`）。

## 修正戦略
1. `archiveRestoreHandlers.ts:88-142` にワーカ側の総行数シーリングと総バイトシーリングを設け、超過時は明確な `ARC_*` エラーで中断する。
2. `archiveValidation.ts:193-219` のメタ数整合チェックに加え、シーリング検査を追加する。
3. ワーカ側で受け取ったファイルサイズを再検証する（クライアント側の 200MiB cap は信頼しない）。

## 設計上の制約
- 上限値は正当なバックアップが取り込める値にする。現行のクライアント cap 200MiB と整合させ、行数上限・バイト上限を定数化すること。quota 10MB 規模のメタデータ保存先とは別の復元先を前提に設計する。
- 復元は single-flight worker のため、シーリング超過時は早期に中断して進捗を破棄できること。部分適用の残骸を残さない。

## BDDシナリオ
Scenario: 正常なアーカイブの復元は従来どおり成功する
  Given 上限内の行数・バイト数の正当なアーカイブがある
  When  ダッシュボードから復元を実行する
  Then  復元が成功し、従来と同じデータが取り込まれる

Scenario: 総行数が上限を超えるアーカイブは ARC_* エラーで中断し、部分状態を残さない
  Given 総行数が上限を超える細工済みアーカイブがある
  When  ワーカ経由で復元を実行する
  Then  `ARC_*` エラーで中断し、部分適用の残骸が残らない

Scenario: 総バイトが上限を超える入力も検証段階で拒否される
  Given 総バイトが上限を超えるアーカイブ入力がある
  When  `validateArchiveEngine` で検証する
  Then  検証段階で拒否され、復元ループに入らない

## 受け入れ基準
- [ ] ワーカ側に総行数・総バイトのシーリング定数があり、検証と復元ループの両方で効く
- [ ] 超過時にユーザーに分かるエラーコード（`ARC_*`）が返る
- [ ] クライアント側 cap のバイパス（ワーカ直叩き経路）でも上限が効く
- [ ] 正常系の復元回帰テストが緑

## テスト戦略
- 単体: シーリング境界（上限-1 / 上限 / 上限+1）
- エクスプロイト回帰: VULN-004 の PoC アーカイブで中断と残骸なしを pin する
- 統合: `npm run validate`

## 見積もり
2 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] type-check / lint / test / build が通る
