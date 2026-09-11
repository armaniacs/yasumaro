# PBI 01: DeadlineTimer の thresholds getter を null 安全化し gate との非対称を解消

## ユーザーストーリー

visit gate を消費する開発者として、初期化前の getter 読み取りが crash ではなく no-op である契約を望む。なぜなら `get gate` は `| null` を返すのに `get thresholds` は非 null assert で throw し、同一 interface 内で非対称だから。

## 優先度

- 順位: 01 / 9
- RICE スコア: 20.0（Reach=2 / Impact=0.5 / Confidence=100% / Effort=0.05 人週）
- 根拠（2026-09-11 round 6 直接検証）: `src/content/deadlineTimer.ts` — `get thresholds(): return this.cachedThresholds!`（:96-98）は初期化前読み取りで throw。`get gate`（:100-102）は `| null`。:70 の `!` は `refreshCachesIfStale()`（:68）が先行するため self-heal するが interface は嘘。`get isE2E` も `boolean | null` で全 consumer に null-check を強いる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 初期化前の thresholds 読み取りは null を返す
  Given DeadlineTimer が未 initialize
  When thresholds を読む
  Then null が返る（throw しない）

Scenario: isE2E は初期化前でも boolean を返す
  Given DeadlineTimer が未 initialize
  When isE2E を読む
  Then false が返る（null でない）
```

## 受け入れ基準

- [x] `get thresholds(): VisitGateThresholds | null` に変更（gate と対称）
- [x] `get isE2E` を non-null（未初期化 default false）に
- [x] :70 の `!` を refresh 保証の明示コメント or メッセージ付き throw に
- [x] 関連テスト green

## テスト戦略

単体: 未初期化状態での thresholds/isE2E 読み取り。

## 見積もり

XS（0.05 人週）。種別: fix。

## 実装メモ（2026-09-11 round 6）

- `get thresholds` を `| null` に（gate と対称化）。`get isE2E` を non-null（未初期化 default false）に。:70 の `!` を refresh 保証の明示 throw に置換。
- contentKernel.checkVisitConditions の thresholds 読み取りを `?? this.pageState.toVisitGateThresholds()` フォールバックに更新。
