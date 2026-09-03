# PBI: composition root を型付き化し global setter を port injection に

## ユーザーストーリー
エンジニアとして、DI container が型安全なほしい、なぜなら Map<string,unknown> + resolve cast が seam が消した型を復元し、依存欠落が実行時 throw になるから。ADR 2026-08-20 の未解消項目（utils→background 逆依存）も global setter として残存

## 優先度
- 順位: 5 / 7
- RICEスコア: 4.0（Reach=1 / Impact=2 / Confidence=80% / Effort=0.5）
- 根拠: token-branded container + setSqliteHealthCheck/setPendingWriteQueue の port 化

## BDD受け入れシナリオ
Scenario: 依存欠落はコンパイルエラー
  Given manifest に未登録の token で resolve
  When  type-check を実行
  Then  コンパイルエラーになる

Scenario: global setter が不要
  Given setSqliteHealthCheck を呼ばない
  When  storageMaintenance.ensureStorageQuota が動く
  Then  injected port から healthCheck を受ける

## 受け入れ基準
- [ ] ServiceContainer を token-branded 化（resolve cast 廃止）
- [ ] storageMaintenance の global setter を port injection 化
- [ ] createBackgroundServices の cast 削除

## テスト戦略
- 単体: container override / port injection

## 見積もり
0.5 人週

## Definition of Done
- [ ] 全BDDシナリオがパスする
- [ ] type-check / lint / build green
