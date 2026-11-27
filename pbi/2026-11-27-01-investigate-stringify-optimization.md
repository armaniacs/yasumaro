# PBI: stringify 3 箇所の削減可能性を調査する

## ユーザーストーリー
保守担当者として、ログエクスポート/インポート経路の `JSON.stringify` 3 箇所の削減可能性を調査したい、なぜなら次回インポート上限引き上げ (30 MiB → 50 MiB 等) の前に「stringify 2 回実行のメモリ・時間コスト」と「1 回化の技術的実現可能性」を固めておく必要があるから。

## ユーザーへの背景 (台帳: pbi/2026-11-26-00 の後続候補、台帳送り済み)
- 現状の 3 箇所 (実測済み、2026-11-27):
  - `src/dashboard/exportLogsService.ts:170` 署名用 stringify (signature を含まない body、HMAC-SHA256 の対象)
  - `src/dashboard/exportLogsService.ts:171` 出力用 stringify (signature 付き body、ダウンロードされるファイル)
  - `src/dashboard/importLogsService.ts:190` インポート検証用 stringify (再構築した body を HMAC 検証に使用)
- 計測 (PBI 17 bench): 軽量 100k 行 130ms/8.0MB (RSS +171.6MB)、フルフィデリティ 50k 行 200ms/27.8MB (peak 565-620MB)
- トリガー未達のため着手不要と裁定済み (2026-11-27) ― 本 PBI は「トリガー達成時にすぐ動ける状態」を作る調査タスク

## ビジネス価値
- 次回上限引き上げ PBI が計測ベースの裁定で開始できる (技術的リスクが前倒しで判明する)
- 測定方法: 調査報告書に (1) stringify 単体の時間/RSS 計測結果 (2) 1 回化の手法候補と実現可能性 (3) 裁定が記録されること

## BDD受け入れシナリオ

```gherkin
Scenario: 計測と実現可能性の検証が裁定として記録される
  Given stringify 3 箇所の現状計測が存在する (PBI 17 bench と統合 pin)
  When 調査 (1 回化の手法候補検証、byte-level 互換性の検証) を実行する
  Then 裁定 (着手する場合の手法と規模 / 現状維持) が台帳に記録される

Scenario: 互換性の制約で着手不可と裁定される場合
  Given 手動挿入による signature 追加が JSON エスケープ整合を破る可能性、
    または envelope 構造変更が既存バックアップ互換性を壊す可能性が確認された
  When 調査が完了する
  Then 「現状維持」の裁定と根拠が台帳に記録される (着手しない裁定も有効な成果)
```

## 受け入れ基準
- [ ] stringify 単体の時間 / RSS 計測結果が記録されている (PBI 17 bench の f4 をベースに、stringify 部分を分離計測する)
- [ ] 1 回化の手法候補が最低 2 つ検証されている: (A) 署名済み文字列への signature 後挿入 (pretty-print 固定フォーマット下でのエスケープ整合)、(B) envelope 構造変更 (signature を payload の外へ分離、互換性バージョン昇格のコスト)
- [ ] 各手法の「インポート側検証 (importLogsService.ts:190) との整合」が検証されている (1 回化はエクスポート側だけでは成立しない)
- [ ] 裁定 (着手 PBI 起案 / 現状維持) が台帳に記録されている
- [ ] 調査報告書が plans/ 配下に作成されている (本 PBI はコード変更を伴わない)

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (調査タスク、コード変更なし)

### 統合テスト
- なし

### 単体テスト
- 調査用の計測スクリプト / 検証コードは一時的なもの (コミットしない)。調査で手付かずの手法を試す場合も、本番コードには反映しない (着手 PBI の材料にする)

## 調査手順（t_wadaスタイル・Outside-In の代わりに）

1. **計測**: PBI 17 の f4 bench をベースに、stringify ①②③ の所要時間と RSS を分離計測する (一時スクリプト)
2. **手法 A の検証 (signature 後挿入)**: pretty-print 固定フォーマット (`JSON.stringify(x, null, 2)`) の末尾構造は決定論的であることを確認し、`\}\s*$` 置換で signature を挿入する安全性をプロトタイプで検証する。rows 内の文字列に `\}` 相当のエスケープが入っても末尾置換は影響しないことを実証する
3. **手法 B の検証 (envelope 構造変更)**: `{ signature, payload: <stringified body> }` 構造への変更コストを評価する (importLogsService.ts の検証フロー変更、旧バックアップ互換のためのバージョン分岐、テスト影響)
4. **裁定**: 削減効果 (時間 / RSS) とコストを突き合わせ、「着手 PBI 起案 / 現状維持」を台帳に記録する

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: 台帳 00 の後続候補 (stringify 最適化、台帳送り済み 2026-11-27 裁定)、Ops/Tuning レビュー指摘 (holistic-1126 レビュー報告書)
- 外部挙動: 不変 (調査タスク、本番コード変更なし)
- HMAC の制約: 署名対象は「signature を含まない body の stringify 結果」であり、この契約は importLogsService.ts:190 の検証と対になっている。エクスポート側だけ 1 回化してもインポート側検証 (③) のコストは残る
- 依存関係: なし (PBI 17 bench が前提条件として存在)
- テスタビリティ: 計測は PBI 17 の f4 bench を流用 (一時スクリプト)
- 非機能要件: なし (調査)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "JSON.stringify" src/dashboard/exportLogsService.ts src/dashboard/importLogsService.ts
grep -n "exportHmacSigner\|verifier.verify" src/dashboard/exportLogsService.ts src/dashboard/importLogsService.ts | head -4
```
既実装確認 (2026-11-27 実測): stringify 3 箇所は実在し、1 回化は未実装。本 PBI は調査タスクのため再実装の心配はない。

### 実装手順
1. f4 bench をベースに stringify 分離計測スクリプトを作成 (/tmp または plans/ 配下の調査用)
2. 手法 A のプロトタイプ検証 (末尾置換の安全性)
3. 手法 B のコスト評価 (コード変更なし、設計評価のみ)
4. 裁定を台帳に記録し、調査報告書を plans/ 配下に作成

### 落とし穴
- 手法 A の末尾置換は「pretty-print 固定フォーマット」が前提。`JSON.stringify(x, null, 2)` の出力末尾は `\n}` で決定論的だが、将来の stringify オプション変更で壊れる ― 調査報告書にこの前提を明記する
- インポート側検証 (③) は body 再構築の stringify であり、エクスポート側の 1 回化では削減できない (両側で 1 回化するには手法 B が必要)
- RSS 計測は f3 の sqlite-wasm 残留に影響される (PBI 17 bench 冒頭の注意) ― `--filter f4` でクリーン計測する
- 本 PBI はコード変更を伴わない (着手 PBI が別途起案される)。調査用コードをコミットしない
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする → 調査タスクのため「裁定が台帳に記録され、報告書に実測値が載る」に置換して判定
- [ ] コードレビュー完了 (調査報告書のレビュー)
- [ ] リファクタリング完了 → 調査タスクのため該当なし (本 PBI はコード変更なし)
- [ ] ドキュメント更新済み (台帳への裁定記録と調査報告書)
- [ ] ロールバック手段の検討 → 調査タスクのため該当なし (コード変更なし)
