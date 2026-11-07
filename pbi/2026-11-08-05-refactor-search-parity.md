# PBI 2026-11-08-05: searchExecution backend parity (extraQualification廃止)

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 5/9
- RICE: 4.8 (R3 / I2 / C0.8)
- 依存: なし
- 種別: refactor
- 規模: M
- プライバシー: 接触なし
- 振る舞い変更: FTS JOIN 修飾の統一に伴う SQL 差分あり (pin 更新)。検索結果の意味は不変を狙う

## ユーザーストーリー

保守担当者として、検索経路の backend 差を寄せてほしい。なぜなら filter 追加のたび2経路検証が必要で locality が欠けているから。

## 背景 (Read確認済み)

- `src/offscreen/searchExecution.ts:23-27,54-64,85-119`: runSearch skeleton 共有は成功例 (6ステップ集約、SearchInput union)。
- 残差: (a) FTS JOIN の b.修飾有無が backend で異なる (`src/offscreen/opfsWorker/searchHandlers.ts:29-31` は履歴理由のみ)。(b) orderDir 不正時の error/coerce 分岐 (`src/offscreen/sqliteQueryBuilder.ts:322-351`, `src/offscreen/IdbVfsBackend.ts:149-162` per-path+error, worker `:60-64` none+coerce)。
- 方針: 修飾を buildFtsSearchStatements 側で強制し extraQualification 引数を廃止 (per-path 統一、worker 出力を pin 更新の上で寄せる)。(b) は host fail-closed を正とし列挙に残す (意図的 divergence として pin)。

## BDD受け入れシナリオ

```gherkin
Scenario: 修飾引数がなくなる
  Given extraQualification が backend で異なる
  When PBIが実施される
  Then 引数が廃止され per-path に統一される
  And COUNT/rows SQL のバイト一致テストが可能になる
```

```gherkin
Scenario: 不正 orderDir の扱いが文書化される
  Given orderDir 不正時の error/coerce 分岐
  When PBIが実施される
  Then host fail-closed が正として pin される
  And 意図的 divergence として記録される
```

## 受け入れ基準

- [ ] extraQualification 引数が廃止され per-path 統一になる
- [ ] parity pin (COUNT/rows バイト一致) が追加される。現行 pin の更新差分は PBI に記録する
- [ ] orderDir 分岐が pin され意図的 divergence として文書化される
- [ ] 既存テスト緑

## テスト戦略

- 単体: `src/offscreen/__tests__/` に parity pin。SQL 差分は期待値ではなく実装原因を正す方針で記録する。
- E2E追加なし。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-05-parity.md`
