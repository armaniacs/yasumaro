# PBI 2026-11-07-05: read policy brand の pin test 追加

## Header
- rank: 5/9
- RICE: 1.2 (Reach 3 / Impact 1 / Confidence 0.8 / Effort 2)
- 依存: なし (本 PBI への依存: PBI 07 が本 PBI に依存する)
- テーマ: offscreen read seam 集約 (safety net first)
- 種別: refactor (振る舞い変更なし、pin test による安全網の追加)

## User Story
- 開発者として、offscreen の読み取り経路に pin test がほしい。なぜなら `AlreadyCappedQuery` brand と `applyReadPolicy` の契約を固定しないと、将来の集約作業で cap 抜けや SQL 到達経路の分岐が混入するためだ。

## Background
- `src/offscreen/queryPlan.ts` は 909 行であり、読み取り方針の中心であることを確認済み。
- `planQueryMode` は `src/offscreen/queryPlan.ts:43-45` で定義され、`text` の有無で `search` と `listing` を切り替える。
- `selectReadCap` は `src/offscreen/queryPlan.ts:55-57` で定義され、FTS か plain かに応じた cap を返す。
- brand 型 `AlreadyCappedQuery` は `src/offscreen/queryPlan.ts:59-64` で定義される。宣言本体は 63-64 行、説明コメントは 59-62 行である。当初指定の 55-64 は `selectReadCap` を含む広い範囲であり、厳密な定義位置として 59-64 に補正した。
- `ExtraWhere` は `src/offscreen/queryPlan.ts:73-78` で定義され、検索系の追加 WHERE 断片の単一表現である。
- `withTransaction` の import は `src/offscreen/queryPlan.ts:18`、`rowMatchesTagLike` の import は `src/offscreen/queryPlan.ts:19` で確認済み。
- `src/offscreen/queryPlanner.ts:1-19` は statement 構築を planner internals として宣言し、backend は計画済み query を消費する方針を示す。
- normalize-clamp-truncate の合成は `src/offscreen/queryPlanner.ts:51-65` で確認済み。`applyReadPolicy` が 51-56 行、`planQuery` が 63-65 行である。
- `Queryable` facet は `src/offscreen/StorageBackend.ts:69-93` で定義され、読み取り専用面を分離する。
- 本 PBI は振る舞いを変更しない。brand 生成経路と未 cap query の SQL 不到達を test で固定し、後続の PBI 07 の前提を作る。

## BDD 受け入れシナリオ

```gherkin
Scenario: brand は applyReadPolicy 経由でのみ生成できる
  Given 正規化済みの StorageQuery があり limit が未補正である
  When applyReadPolicy と planQuery と planSearch を呼ぶ
  Then 返り値は AlreadyCappedQuery として扱え limit は clamp され tag と text は truncate される
  And 直接の object literal では AlreadyCappedQuery に代入できず compile error になる
```

```gherkin
Scenario: cap なし query は SQL に到達しない
  Given cap を経由していない StorageQuery がある
  When buildQuerySpec を呼ぼうとする
  Then 型検査で拒否され SQL 組み立てに入らない
  And worker 境界の明示的な cast を除き回避経路は存在しない
```

```gherkin
Scenario: search と listing の dispatch は planQueryMode に一元化される
  Given text あり query と text なし query がある
  When planQueryMode を呼ぶ
  Then text ありは search になり text なしと空文字は listing になる
  And backend 側で個別に真偽判定を再実装しない
```

## 受け入れ基準
- [ ] `AlreadyCappedQuery` が `applyReadPolicy` / `planQuery` / `planSearch` / `applySearchPolicy` 経由でのみ生成できることが型 level と test で固定される。
- [ ] 未 cap の `StorageQuery` を `buildQuerySpec` に渡すと型検査で拒否されることが test で固定される。
- [ ] `planQueryMode` / `selectReadCap` / `ExtraWhere` の現行振る舞いに変更がない。
- [ ] `normalize -> clamp -> truncate` の合成順序が `queryPlanner.ts:51-65` の通りであることが test で固定される。
- [ ] 既存の関連 gate が green である (`npm run type-check`、`npm run validate`、対象 vitest)。
- [ ] 本番 code の振る舞い変更を含まない。変更は test 追加と必要最小限の注釈のみである。

## Test Strategy
- 方針は `dev-docs/TEST_RULE.md` に従う。固定時間待ちは使わない。非同期の完了は Promise の await または条件待ちで確認する。
- vitest の targeted suite を新設する。想定名は `queryPlan.brand.test.ts` と `queryPlanner.policy.test.ts` である。
- 単体 test 中心の構成とする。E2E は追加しない。
- 対象 case:
  - `applyReadPolicy` が limit を clamp し tag と text を truncate して brand 付きで返すこと。
  - `planQuery` と `planSearch` が normalize 後に同じ policy を適用すること。
  - `planQueryMode` が空文字を listing として扱うこと。
  - `selectReadCap` が FTS と plain で正しい cap を返すこと。
  - `buildQuerySpec` が `AlreadyCappedQuery` 以外を受け付けないこと (型 test を含む)。
  - `Queryable` facet の読み取り経路が未 cap query を直接受けないこと。
- 既存 test との重複は避け、pin test としての最小集合に絞る。

## Estimate
- 2SP

## 技術的考慮事項
- 依存関係: なし。ただし PBI 07 は本 PBI の完了を前提とする。
- 振る舞い変更は禁止である。実装は test 追加に限定し、本番 code を変える場合は comment の明確化のみとする。
- worker 境界の cast は文書化された例外として残し、test で迂回路として扱わない。

## 実装者向け注記
- 着手前に `src/offscreen/queryPlan.ts`、`src/offscreen/queryPlanner.ts`、`src/offscreen/StorageBackend.ts` を Read すること。
- brand の unique symbol の扱いに注意すること。実行時の値ではなく型 level の保証である。
- SQL 文字列の一致を assert する場合は完全一致にせず、cap と filter の有無に絞ること。SQL 整形の差分で test が壊れるのを防ぐためだ。

## Definition of Done
- [ ] 全 BDD シナリオが自動 test として実装され pass する
- [ ] test が固定時間待ちを使わない
- [ ] 振る舞い変更がないことが diff で確認できる
- [ ] `npm run type-check` が pass する
- [ ] `npm run validate` が pass する
- [ ] 関連ドキュメントの更新が不要であることが確認済みである
