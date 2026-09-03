# PBI: SQLite gateway を 1 seam + 2 adapters に統合

## ユーザーストーリー
エンジニアとして、SQLite RPC が 1 つの interface で完結するほしい、なぜなら 6 hops の往復と confirm-token 2重 fetch、timeout セマンティクスの分岐が maintenance を困難にしているから

## 優先度
- 順位: 7 / 7
- RICEスコア: 2.0（Reach=1 / Impact=1 / Confidence=50% / Effort=0.5）
- 根拠: 動作中システムの churn risk > payoff。最終着手

## BDD受け入れシナリオ
Scenario: dashboard と background が同一 interface
  Given SqliteRpcClient seam
  When  query({kind:'search'}) を dashboard から呼ぶ
  Then  background と同一の SqliteResult が返る

## 受け入れ基準
- [ ] timeout/error 分類/traceId を共有化
- [ ] confirm-token を decorator 化

## テスト戦略
- 統合: InMemorySqlitePort 注入

## 見積もり
0.5 人週

## Definition of Done
- [ ] type-check / lint / build green
