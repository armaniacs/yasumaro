# PBI 2026-11-08-06: queryPlan facade の段階削除

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 6/9
- RICE: 4.0 (R5 / I1 / C0.8)
- 依存: 02の後 (queryPlan.ts競合回避)
- 種別: refactor
- 規模: M
- プライバシー: 接触なし
- 振る舞い変更: なし (import 経路のみ)

## ユーザーストーリー

保守担当者として、queryPlan 末尾の compat facade を段階削除してほしい。なぜなら WHERE 生成 SSOT 化は成功したが interface が二重化し、新規 filter 追加時の正しい import 先が曖昧だから。

## 背景 (Read確認済み)

- `src/offscreen/queryPlan.ts:308-353`: 約25シンボル re-export の pass-through facade。
- 実装は `src/offscreen/sqliteQueryBuilder.ts:1-22`・`purgeRunner.ts:1-13`。呼出約20箇所: searchExecution, searchHandlers, crudHandlers, purgeHandlers, auditHandlers, IdbVfsBackend, storageFallback。
- `sqliteQueryBuilder.ts:19` に queryPlan⇔builder の型循環が残存。
- 方針: 新規コードは builder/queryParityPredicate/purgeRunner 直 import に切替、facade に @deprecated 付与→テスト移行後に削除。一括削除不可 (facade import のテスト約10件)。

## BDD受け入れシナリオ

```gherkin
Scenario: facade が非推奨になる
  Given compat facade が残っている
  When PBIが実施される
  Then facade に @deprecated が付与される
  And 新規コードの直 import 方針が文書化される
```

```gherkin
Scenario: import graph が DAG に戻る
  Given queryPlan⇔builder の型循環がある
  When 移行が進む
  Then 定義-参照の locality が回復する
  And 既存テストが緑である
```

## 受け入れ基準

- [x] facade に @deprecated が付与される
- [x] 製品コードの呼出が直 import に切り替わる (最低でも新規 filter の模範経路が文書化される)
- [x] 型循環が解消されるか、残存する場合は理由と追跡 PBI が記録される
- [x] 既存テスト緑

## テスト戦略

- 単体: 既存 offscreen テストで緑確認。facade 経由テストは直 import へ段階移行。
- E2E追加なし。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-06-facade.md`
