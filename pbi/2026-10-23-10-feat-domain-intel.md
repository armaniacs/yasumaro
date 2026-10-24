# PBI: ドメイン知能 ― 情報源の偏りと見直し提案

## ユーザーストーリー
読み込む人として、情報源の偏りと騒音を知りたい、なぜならどこで読むかが何を読むかより効くから

## 優先度
- 順位: 05 / 5候補
- RICEスコア: 240 (Reach=600 / Impact=1 / Confidence=0.8 / Effort=2.0人週)
- 根拠: 読む量が多い層に効くが直接効果は間接的でImpact 1。独立着手可
- 依存: なし。M3の未読穴検出と範囲を分けること

## 背景・制約
- `domainAnalysisAggregate`(`src/dashboard/panels/asyncData/`)の延長で作り、uBlock・信頼DBと接続する
- 提案は除外提案までとし、自動除外はしない。適用・取消を必ず付ける
- 偏り判定の根拠(件数・期間・算出式)を表示し、断定口調にしない

## BDD受け入れシナリオ
Scenario: 偏りが見える
  Given 記録が十分にある
  When ドメイン知能を開いた
  Then 情報源の偏りと根拠が表示される

Scenario: 見直しを適用できる
  Given 高騒音ドメインの提案がある
  When 除外提案を適用した
  Then フィルタに反映され、取消ができる

## 受け入れ基準
- [ ] 偏りと根拠(件数・期間・算出式)が表示される
- [ ] 除外提案の適用・取消ができる
- [ ] 自動除外はしない
- [ ] 少件数時の縮退表示がある

## テスト戦略
## 実装記録（2026-10-23・コア集計経路）
- 偏り判定: 完了。`src/dashboard/domainIntelAggregate.ts` の `computeSourceBias` が最上位ドメインの割合を集計。根拠(件数・期間・算出式)を結果に載せ、UIは断定口調にしない(「偏っている可能性があります」)。`(unknown)` バケットは判定対象外(既存 UNKNOWN_DOMAIN_LABEL を再利用)
- 少件数縮退: 完了。`MIN_RECORDS_FOR_BIAS`(10) 未満は `enough: false` で割合を断定せず、縮退表示(「記録が N 件と少ないため偏りを判定できません」)
- 見直し提案: 完了。`buildNoiseProposals` が割合 `NOISE_SHARE_THRESHOLD`(50%) 以上のドメインを最大3件提案。提案は助言のみ(自動除外はしない)。適用はユーザーアクション + インライン取り消し(取り消しはブラックリストを復元、エンドツーエンドで可逆)
- 適用/取消 seam: 完了。`src/utils/storage/domainIntelRepository.ts` の `addDomainToBlacklist`/`removeDomainFromBlacklist`(SettingsRepository 上の薄い read-modify-write。冪等。破損ストアは既定リストに縮退)。ドメイン分析パネルのインテル領域に配線
- 接続: 完了。uBlock・信頼DBと接続する ― 除外提案の適用先は simple blacklist(`DOMAIN_BLACKLIST`)で、uBlock形式/信頼DBの評価は既存 `isDomainAllowed` がそのまま従う(新規評価路は追加していない)
- ja/en: `domainIntel_heading`・`domainIntel_biasLine`・`domainIntel_notEnough`・`domainIntel_proposalHelp`・`domainIntel_proposalMeta`・`domainIntel_applyBtn`・`domainIntel_undoBtn`・`domainIntel_applied`・`domainIntel_undone` の9キーを双側追加
- pin: `src/dashboard/__tests__/domainIntelAggregate.test.ts` 8テスト(割合+算出式・少件数縮退・unknown除外・提案条件テーブル・cap・期間ラベル)
- 残: E2E通し(集計→表示→適用→取消)、少件数/偏りなし/騒音なしの統合分岐テスト、コードレビュー、ドキュメント更新(算出式と操作手順を含む)
- E2E: 集計→表示→適用→取消の通し
- 統合: 少件数・偏りなし・騒音なしの分岐テスト
- 単体: 偏り算出・提案条件のテーブルテスト

## 見積もり
2.0人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(算出式と操作手順を含む)
