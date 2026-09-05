# PBI: confirmToken フォールバックを Math.random から削除

## ユーザーストーリー
開発者として、破壊的操作の認可ゲートである confirmToken を暗号学的に安全な乱数でのみ発行したい、なぜなら予測可能なトークンでは delete / clear_all / restore_db の認可前提が崩れるから

## 優先度
- 順位: 02 / 26
- RICEスコア: 6,400（Reach=1000 / Impact=2 / Confidence=0.8 / Effort=0.25日）
- 根拠: 破壊的操作の唯一の関門に関わるセキュリティ修正であり、Effort が小さく効果が高いため上位

## BDD受け入れシナリオ
```gherkin
Scenario: 暗号学的乱数が使える環境ではトークンを発行できる
  Given 暗号学的乱数が利用可能な環境
  When  破壊的操作の確認トークンを要求する
  Then  トークンが発行される

Scenario: 暗号学的乱数が使えない環境ではトークンを発行しない
  Given 暗号学的乱数が利用不可の環境
  When  破壊的操作の確認トークンを要求する
  Then  トークン発行が失敗し、破壊的操作に進めない
```

## 受け入れ基準
- [x] 暗号学的乱数が利用不可の場合に `Math.random()` ベースのトークンが発行されない
- [x] 暗号学的乱数が利用不可の場合はトークン発行が失敗（fail-closed）として扱われる
- [x] 対象操作（delete / clear_all / restore_db）が予測可能トークンで承認されない

## テスト戦略
- 単体: 乱数源が利用不可の条件でトークン発行が失敗すること、利用可能な条件で発行できること

## 実装アプローチ
fail-closed 方針に統一し、予測可能なフォールバック経路をなくす。起動時または発行時に安全な乱数源の有無を検出できる状態にする。

## 見積もり
1 ストーリーポイント（Effort 0.25日相当の小規模修正）

## 実装者向け注記
- 対象: `src/background/confirmTokenManager.ts:37-45`
- 着手前に Read で現状のフォールバック有無を確認すること
- 指摘スコープ外のトークン仕様（TTL・使い捨て・検証条件）は変更しないこと

## 実装メモ
- 2026-09-05 完了（commit `eebc9c66`）: `generateToken` を fail-closed 化 — randomUUID / getRandomValues のいずれも使えない環境では throw し、`Math.random` フォールバック経路を物理削除。テスト: `confirmTokenManager-failclosed.test.ts`（RNG 不可・部分可・getRandomValues 経由の 3 ケース、24 tests のうち 3 件）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
