# PBI: tranco CSV の split 先行実体化を tier limit 以前で止める (CWE-400 Low)

## ユーザーストーリー
保守担当者として、tranco リストの fetch + parse が derived 配列 (~400MB) を materialize する前に 100k tier limit を適用してほしい、なぜなら現行は `csvText.trim().split('\n')` が ~50M エントリ (~400MB+) を materialize し、その後で per-line tier limit が効く。retry ループが最大 3 回 fetch+parse を繰り返すため、compromised tranco-list.eu / TLS MITM での availability 消費が重複する (VulnHunter VULN-060、CWE-400 Low) から。

## ビジネス価値
- 50MB byte cap (:158-159) が derived 配列の増幅 (~8x) を止められない構造を解消する
- 測定方法: exploit test 060 を新契約 pin に更新 (12MB body で RSS 増幅 <2x に収まること)

## BDD受け入れシナリオ

```gherkin
Scenario: 12MB body は RSS を ~2x 以内に収める
  Given 12MB の tranco CSV (50M エントリ相当) がある
  When updateTrancoList が実行される
  Then 1000 domains (tier limit) で停止し、RSS 増幅は 2x 以内である
  And tier limit を超えた行は解析されない (early bound)
```

## 受け入れ基準
- [ ] trancoUpdater.ts:177 の `split('\n')` が、tier limit (100k 行) を超える materialization をしない実装 (行数インデックススキャン、またはバッチ分割 parse) に変更されている
- [ ] exploit test 060 を新契約 pin に更新 (RSS 増幅 <2x、tier limit で停止)
- [ ] 既存 tranco / trustDb テスト群が緑
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- tranco / trustDb テスト群 (新契約 pin)

### 単体テスト
- 行数バウンド (12MB 入力で早期停止、tier limit で停止、RSS pin)

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/phase2b_output.md VULN-060 (CONFIRMED Low)、phase3_output.md fix strategy
- 外部挙動: 不変 (取得されるドメイン数・内容は同一。メモリ特性のみ改善)
- 依存関係: なし (1 モジュール)
- 実装選択: (a) 文字列インデックススキャンで先頭 100k 行の終端を探して slice → split (追加配列は tier 分のみ)、(b) バッチ分割 parse (チャンクごとに split して tier 到達で打ち切り)。実装は (a) を第一候補 (byte bound が明確)、(b) は代替

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '155,200p' src/utils/trustDb/trancoUpdater.ts
grep -n "TRANCO_TIER_COUNT" src/utils/trustDb/trancoUpdater.ts src/utils/limits.ts 2>/dev/null | head -3
```

### 実装手順
1. 先頭 100k 行の終端をインデックススキャンで特定する helper を実装 (String.indexOf ループ、tier 超過で打ち切り)
2. slice → split → parse に置換 (挙動不変: 取得ドメイン数・内容は同一)
3. exploit test 060 を新契約 pin に更新

### 落とし穴
- CSV の行は CRLF / LF 混在の可能性 (現行の split('\n') は trailing \r を残す ― 現行パースが \r を想定しているか確認してから置換しないと挙動が変わる)
- retry ループ (最大 3 回) の各回で cap が効くことを確認 (重複 fetch+parse を繰り返さない)
- tier limit 定数が limits.ts に無い場合、現行のハードコード (100k) を SSOT 化するか現状維持かを判断して報告
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了 (セキュリティ変更のため For Security Review Agents 観点を PR 説明に明記)
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: split('\n') に戻す (1 コミット、脆弱状態に戻る)
- [ ] ドキュメント更新の要否判定: 内部実装のため docs 更新は不要
