# PBI: ProviderCatalog から SSRF security policy を分離

## ユーザーストーリー
エンジニアとして、SSRF ガードが provider data から分離されているほしい、なぜなら 124 行の security policy が data catalog に融合し、直近 7 コミットの churn を生んでいるから

## 優先度
- 順位: 6 / 7
- RICEスコア: 2.7（Reach=1 / Impact=1.5 / Confidence=60% / Effort=0.5）
- 根拠: aiModelKey の modelKey 再導出廃止とセットで catalog を唯一の truth に

## BDD受け入れシナリオ
Scenario: security policy 単体テスト
  Given ProviderSecurityPolicy のみ import
  When  isAllowedProviderBaseUrl(url, isLocal) を呼ぶ
  Then  catalog map なしで判定できる

## 受け入れ基準
- [ ] isAllowedProviderBaseUrl を別モジュールに分離
- [ ] aiModelKey fallback 導出を廃止

## テスト戦略
- 単体: policy 境界（既存 38 テスト移植）

## 見積もり
0.5 人週

## Definition of Done
- [ ] type-check / lint / build green
