# PBI: archive検証のspec表一本化（wire行validateの撤去）

## ユーザーストーリー
履歴アーカイブの利用者として、不正なstaging指定が検証を素通りしてほしくない。なぜなら直叩き経路では無検証のままdepsまで届くから。

## 優先度
- 順位: 02 / 12
- RICEスコア: 48（Reach=30 / Impact=2 / Confidence=0.8 / Effort=1.0）
- 根拠: 検証二重管理は欠陥混入の温床。D1と並列可。

## 背景
arch診断C1。envelopeゲートはSUBTYPE_SPECS、wire行は4行委譲＋archive_update手書き＋9行noValidate。`createArchiveHandler`直叩きではstagingName無しが素通りする。

## BDD受け入れシナリオ
Scenario: wire行がspec表に委譲する
  Given 未知stagingNameのarchive op
  When handler入口で検証する
  Then deps未到達で拒否される

Scenario: archive_updateの手書きが消える
  Given archive_update要求
  When 検証する
  Then spec表の文言・条件と一致する

## 受け入れ基準
- [x] wire行のvalidate欄が撤去されspec表が唯一の真実になる
- [x] 直叩きでも不正stagingがdepsに届かない（テストでpin）
- [x] parity見張りテストが被覆テストに置換されるか不要になる

## テスト戦略
- 単体: spec表の被覆テスト＋handler入口テスト（Red→Green）
- 既存: archive系テストで回帰確認

## 見積もり
2.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
