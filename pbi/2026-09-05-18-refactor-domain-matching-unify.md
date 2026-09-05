# PBI: ドメインマッチングの重複ラッパーを一本化

## ユーザーストーリー
拡張機能の開発者として、ドメイン一致判定の入口はひとつにしてほしい、なぜなら同名の `matchesPattern` が複数箇所に散在していると修正漏れや挙動差異が生まれ追跡が困難だから

## 優先度
- 順位: 13 / 26
- RICEスコア: 1,400（Reach=1000 / Impact=1 / Confidence=0.7 / Effort=0.5日）
- 根拠: ワイルドカード判定の重複実装は ReDoS 対策漏れの温床になる。既に単一エンジンへの委譲は済んでおり、残作業はラッパー削除のみで効果が確実。

## BDD受け入れシナリオ
```gherkin
Scenario: ワイルドカード判定が単一の入口に集約される
  Given 有効なドメイン設定が保存された状態
  When  各呼び出し元（background・content script・dashboard）から URL の許可判定を行う
  Then  すべて同じ判定結果を返し、重複ラッパーは存在しない

Scenario: 過剰なワイルドカードを含むパターンは安全に拒否される
  Given 上限を超えるワイルドカードを含むパターン
  When  許可判定を行う
  Then  例外なく不一致として扱われる
```

## 受け入れ基準
- [ ] `matchesWildcardPattern`（非推奨ラッパー）が削除され、全呼び出しが単一の入口経由になる
- [ ] `domainUtils.matchesPattern` と `urlSkipper.matchesPattern` のいずれか一方に集約され、もう一方が削除または再エクスポート shim になる
- [ ] `extractDomain`・`isDomainInList` の重複が整理され、関連テストが全パスする

## テスト戦略
- 単体: 集約後の入口に対する既存テスト（`storage.test.ts` の `matchesWildcardPattern` 系、`loader-utils.test.ts` の `matchesPattern` 系）を移行・更新し、ワイルドカード上限・大文字小文字の境界を検証する
- 単体: `DomainFilter` / `DomainFilterCacheAdapter` 経由の許可判定テストがパスすること

## 実装アプローチ
`wildcardToRegex` を唯一のワイルドカードエンジンとして残し、その上の薄いラッパー（`domainUtils.matchesPattern`、`urlSkipper.matchesPattern`、`domainFilterCache.matchesWildcardPattern`、私設の `isDomainInList`・`extractDomain` 群）を `DomainFilter` 系の単一シームに集約する。content script から import できないモジュールは再エクスポート shim で段階移行する。

## 見積もり
1ポイント（0.5日相当：ラッパー削除と呼び出し元の付け替え、テスト移行が中心）

## 実装者向け注記
- 確認済み現状: `src/utils/domainUtils.ts:59`（`matchesPattern`）、`src/content/urlSkipper.ts:58`（`matchesPattern`）、`src/utils/storage/domainFilterCache.ts:81`（`matchesWildcardPattern`、@deprecated 済み）はいずれも `wildcardToRegex` への委譲済み。`extractDomain` も3箇所（`domainUtils.ts:37`、`urlSkipper.ts:35`、`domainFilterCache.ts:61` の `normalizeDomainUrl`）、`isDomainInList` も2箇所＋`DomainFilter.ts:24` の私設版あり。`DomainFilter.isAllowed`（`DomainFilter.ts:76-78`）は現状 live への単なる委譲で、シームは存在するが一本化は未完了
- 調査コマンド: `rg -n "matchesPattern|matchesWildcardPattern|isDomainInList" src/ --glob '!*.test.ts'`、`rg -n "extractDomain|normalizeDomainUrl" src/ --glob '!*.test.ts'`
- 注意: content script は background モジュールを直接 import できない場合があるため、集約先は両者から参照可能な配置にすること。`DESIGN_SPECIFICATIONS.md:136-149` の収束方針と整合させること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（該当ガイドがあれば）
