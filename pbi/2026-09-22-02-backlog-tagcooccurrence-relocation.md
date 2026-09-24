# PBI: tagCooccurrence 計算層の dashboard 配下からの移設

## ユーザーストーリー
保守担当の開発者として、タグ共起の純粋関数を UI エントリ配下から独立した層に置きたい、なぜなら wasm/tag-cooccur と offscreen テストが dashboard 配下を cross-import しており、層の向きが逆になっているから。

## 優先度
- 順位: 02 / 3
- RICEスコア: 1.5（Reach=3 / Impact=1 / Confidence=0.5 / Effort=1）
- 根拠: 実害は未発生。移設先が offscreen かパイプラインかは、compute の実行場所の裁定に依存する。
- 再検討トリガー: compute を offscreen/パイプラインへ移設する時（dedup の offscreen 移設の再評価と同時）。それまでは着手しない。

## 背景（2026-09-22 時点の現状）
- `src/dashboard/tagCooccurrence.ts`（純粋関数）と `src/dashboard/tagCooccurrenceHybrid.ts`（WASM ハイブリッド）が dashboard 直下にある。
- wasm/tag-cooccur のパリティ・bench と offscreen 側テストがこれらを import している。
- 関連 PBI: `2026-09-20-17/21/22`（tag-cooccur の WASM 化・配線・CI ゲート。実機確認と PR レビュー待ち）。

## BDDシナリオ
Scenario: 移設後も出力が変わらない
  Given 移設前の tagCooccurrence の入出力を golden として pin してある
  When  純粋関数を新しい層へ移す
  Then  既存のパリティ・ハイブリッド・パネルのテストが変更なしで通る

Scenario: 層の向きが正しくなる
  Given 移設後のツリー
  When  wasm/ と offscreen/ から import 元を検索する
  Then  dashboard 配下への import が 0 件になる

## 受け入れ基準
- [ ] 移設先を裁定し、理由を PBI に記録した（compute の実行場所が確定していること）
- [ ] 関数の挙動は byte-identical で、golden テストが移設前後で同一
- [x] `2026-09-20-17/21/22` のレビューが終わり、競合しないことを確認した（2026-09-24 アーカイブ済み — `502c1093`/`7ea33e53` で再検証・反映。着手可能）
- [ ] 新規・移動ファイルを lint の層分類 SSOT と、必要なら `manifest.json` の `web_accessible_resources` に登録した
- [ ] 旧パスからの import が残っていない

## テスト戦略
- 単体: 既存パリティテスト（TS 対 WASM）をそのまま流用
- 統合: `npm run validate` と `npm run build`

## 見積もり
3 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] type-check / lint / test / build が通る
- [ ] コードレビュー完了
