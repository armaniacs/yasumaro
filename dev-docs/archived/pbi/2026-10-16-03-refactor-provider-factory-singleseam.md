# PBI: AI戦略生成seamの統一（Remote内Mapの廃止）

## ユーザーストーリー
AI要約の利用者として、provider設定の配線破損がテストを素通りしてほしくない。なぜならcatalog行の欠落が本番でのみ発覚するから。

## 優先度
- 順位: 03 / 12
- RICEスコア: 48（Reach=40 / Impact=1.5 / Confidence=0.8 / Effort=1.0）
- 根拠: C1と同点だが検証系を先にし、こちらを後に回す。B1（Hook統一）の前提。

## 背景
arch診断B2。生成seamがCATALOG行／FACTORY registry／Remote内Mapの3つ。Remoteは起動時に写し替え、public registerProviderで上書き可能。テストは偽id差しでcatalogを素通りし、単体テストは直構築でcreateProviderStrategyを素通りする。

## BDD受け入れシナリオ
Scenario: 生成入口が1本になる
  Given 未知id
  When 生成する
  Then UnknownProviderError契約が本番seam経由で検証できる

Scenario: テストが本番seamを通る
  Given Remoteテスト
  When 偽Adapterを差す
  Then 生成関数差し替えで入り、catalog行欠落を検出できる

## 受け入れ基準
- [x] Remote内Mapとpublic registerProviderが撤去され生成関数1本注入になる
- [x] provider単体テストがcreateProviderStrategy経由になる
- [x] `npx vitest run src/background/ai/` 全緑

## テスト戦略
- 単体: 生成契約テスト（Red→Green）
- 既存: ai系テストで回帰確認

## 見積もり
2.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
