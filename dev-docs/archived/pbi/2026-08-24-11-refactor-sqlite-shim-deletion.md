# PBI: SqliteClient shim削除 + call分割 — 20 Legacy Wrappers の除去と domain別 error taxonomy 分離

## 概要
- 優先度: 4 (RICE 20.0 — Reach 20 × Impact 0.5 × Confidence 100% / Effort 0.5w)
- 種別: refactor
- 見積もり: 1pt
- Recommendation: Worth exploring (Strongに近い pure deletion)
- 依存: なし

## ユーザーストーリー
開発者として、`src/background/sqliteClient.ts` の後方互換 20 `*Result` shim (例: `insertResult`, `queryResult`) を削除し、4 domain (`query/mutate/maintain/getStatus`) + domain別 `callQuery/callMutate/...` に整理したい。なぜなら shim は production 消費者0でテストのみが依存し、汎用 `call<T,R>(transform)` が domain別の error semantics を1つの `categorizeError` に混在させているから。

## ビジネス価値
- 削除: 100行削減、1つの汎用 `call` の型エラーが domainを指すように
- 明確性: `maintain({type:'restore'})` の失敗と `query({kind:'count'})` の失敗が文字列ではなく domain helper で区別される
- 前例: `syncTargetRegistry.ts` 削除 (PBI 2026-08-24-07) と同様の pure deletion でリスク低

## BDD受け入れシナリオ

```gherkin
Scenario: shim削除後もテストが新 API で動作する
  Given 20 shim (insertResult, updateResult, deleteResult, queryResult 等) が削除されている
  When 既存テストが query/mutate/maintain/getStatus の domain API を直接呼ぶように移行している
  Then 全テストが PASS し、production コードは shim を参照しない

Scenario: domain別 error taxonomy が分離される
  Given callQuery, callMutate, callMaintain, callStatus の4 helper が存在する
  When 各 domain で OffscreenResponse の subtype ごとに categorizeError が呼ばれる
  Then 型エラーが domainを指し、maintain の失敗が query の失敗と混同されない

Scenario: grep で shim 残存が0
  Given shim削除後
  When grep -rn "Result(" src/background/sqliteClient.ts を実行する
  Then ヒットが0件
```

## 受け入れ基準
- [ ] `src/background/sqliteClient.ts:280-385` の 20 shim を削除 (100行)。`query/mutate/maintain/getStatus` の4 domain のみを残す
- [ ] 汎用 `call<T,R>(type,payload,transform?,traceId)` を `callQuery/callMutate/callMaintain/callStatus` の4 domain-private helper に分割。各 helper が `OffscreenResponse` subtype と `categorizeError` を所有
- [ ] 既存テスト 13ファイルの shim 呼び出しを新 domain API に移行 (`grep -r "Result("` で移行漏れ0)
- [ ] `grep -rn "insertResult\|queryResult\|updateResult" src/` が0件
- [ ] type-check / lint / test PASS

## テスト戦略

### 単体テスト
- 各 helper が正しい categorizeError 分岐を呼ぶこと
- shim削除後の domain API が従来と同一の結果を返すこと (既存テストの移行で担保)

### 統合テスト
- dashboardSqliteWiring の 3 domain deps が正しく配線されること

## 見積もり
1 ストーリーポイント

## 技術的考慮事項
- 削除は `git rm` ではなく Edit で shim ブロックを除去。テスト移行は `query/mutate` の呼び出しに置換
- `Extract<>` 8 overloads も helper分割に伴い簡素化 (domain別に1 overloadずつ)
- リスク低: production grepで shim 消費者0を確認済み (Phase 0)

## Definition of Done
- [ ] 全BDDシナリオ検証済み
- [ ] shim 0件、helper 4件、type-check/lint/test PASS
- [ ] CHANGELOG に削除を記載
