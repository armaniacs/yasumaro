# PBI: retryPolicy の 'ai ' false positive 修正

## ユーザーストーリー
エンジニアとして、network error 判定が ADR 2026-08-27 の列挙に一致するほしい、なぜなら lower.includes('ai ') が「Failed for ai pipeline」等を全て network error と誤判定し、offline queue に 7日 TTL で誤格納されるから

## 優先度
- 順位: 2 / 7
- RICEスコア: 9.6（Reach=1 / Impact=2 / Confidence=80% / Effort=0.125）
- 根拠: 実害バグ。修正は1行+テスト

## BDD受け入れシナリオ
Scenario: network error のみ offline enqueue
  Given error.message が "Failed for ai pipeline"
  When  isNetworkError(error) を呼ぶ
  Then  false を返す（offline queue に入らない）

Scenario: 本物の network error は enqueue
  Given error.message が "fetch failed: ENOTFOUND"
  When  isNetworkError(error) を呼ぶ
  Then  true を返す

## 受け入れ基準
- [ ] 'ai ' 部分一致を廃止し ADR 列挙語（network/fetch/timeout/offline/econnrefused/enotfound）のみ
- [ ] 単体テスト追加

## テスト戦略
- 単体: isNetworkError の境界値表

## 見積もり
0.125 人週

## Definition of Done
- [ ] 全BDDシナリオがパスする
- [ ] type-check / lint green
