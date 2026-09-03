# PBI: Trust seam を 1 つの deep module に再集約

## ユーザーストーリー
エンジニアとして、信頼判定が 1 つの seam で完結するほしい、なぜなら v1/v2 レビューで orphan singleton が全 isTrusted() を UNVERIFIED 固定する CRITICAL バグを2度生んでおり、5-module passthrough chain が状態の所在を曖昧にしているから

## 優先度
- 順位: 1 / 7
- RICEスコア: 12.0（Reach=1 / Impact=3 / Confidence=100% / Effort=0.25）
- 根拠: deletion test で TrustDbAdmin(30 delegates)が moves 確定。globalThis.__trustDbKernel は ADR 2026-08-20 が将来解消と記録した負債の恒久化

## BDD受け入れシナリオ
Scenario: pipeline step が1メソッドで信頼判定する
  Given TrustDbKernel が未初期化の状態
  When  checkTrustDomainStep が checkDomain(url) を呼ぶ
  Then  UNVERIFIED が返り promise rejection にならない

Scenario: globalThis に依存しない
  Given globalThis.__trustDbKernel を削除した状態
  When  isTrusted(url) を呼ぶ
  Then  正しい判定が返る（module-scope singleton）

## 受け入れ基準
- [x] globalThis registry 廃止 + getTrustPolicy 委譲一本化（delegate 統合は Admin class 維持のため見送り、次ラウンドへ）
- [x] globalThis.__trustDbKernel / __TrustPolicyClass を廃止し module-scope singleton 化
- [x] getTrustPolicy() 契約（初期化前 throw）を isInitialized() で維持
- [x] 158 tests passed (10 files)

## テスト戦略
- 単体: TrustModule.checkDomain の境界（未初期化/初期化済/tranco更新後）
- 統合: pipeline step 経由の injection

## 見積もり
0.25 人週

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] type-check / lint / build green
