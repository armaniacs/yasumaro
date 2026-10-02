# PBI: recoveryClaimStore の期限切れ claim を掃除する

優先度: 17 / RICE 6.4
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「無制限に成長するデータ構造」）
依存: なし（他 PBI とファイル重複なし）

## ユーザーストーリー

この拡張機能を長期運用する開発者として、recovery claim のエントリが document 生命期内ずっと残り続けるのを防ぎたい、なぜなら service worker の停止で recovery run が中断された記録は、同じ URL が再 claim されるまで delete されないため、Map が時間経過とともに際限なく増えるから。姉妹の pending キューは `MAX_PENDING_PAGES` と prune を持っているのに、この Map だけが無制限である。

## 背景（現状）

- `src/utils/recoveryClaimStore.ts:50-65` `claimRecoveryOwner` はエントリの追加と take-over のみ行う
- `src/utils/recoveryClaimStore.ts:71-82` `releaseRecoveryOwner` は自分のエントリのみ削除する
- `src/utils/recoveryClaimStore.ts:37-39` `isFresh` の TTL は 10 分で、古い claim は論理的には期限切れとして扱われるが、**同じ URL が再 claim されない限り delete する経路が存在しない**
- 呼び出し側（いずれも sweep しない）: `src/background/offlineQueueProcessor.ts:88,95`、`src/background/handlers/recordingHandlers.ts:240,260`、`src/background/handlers/notificationHandlers.ts:87,97`

## BDD シナリオ

```gherkin
Scenario: 期限切れ claim が掃除される
  Given 10 分より前の timestamp の claim エントリが 1 件ある
  When 新しい claim を取得する
  Then 期限切れエントリが削除され、新しいエントリだけが残る

Scenario: 掃除は take-over の挙動を変えない
  Given 同じ URL の別 owner が-take-over 済みの claim がある
  When 新しい claim を取得する
  Then take-over は従来どおり成功する
```

## 実装宣言

- 挙動維持: TTL 10 分・take-over 判定・戻り値の型は不変
- 掃除は既存の claim 取得パスに付ける（新しい公開 API は追加しないか、最小限にする）
- 注入可能な時刻源を使う（テストで実時間待ちにしない）

## 受け入れ基準

- [x] 期限切れ（TTL 超過）エントリが claim 取得時に削除される
- [x] take-over・戻り値の契約が不変
- [x] Map のエントリ数が無制限に増えない（掃除後の上限が TTL 内の claim 数に一致する）
- [x] 既存テストが green

## テスト戦略

- 手動 clock で「TTL 超過後に掃除される」を固定（`vi.useFakeTimers` と注入可能な時刻源）
- 境界: **freshness は `age < CLAIM_TTL_MS`。よって age = TTL - 1ms は fresh、age = TTL でちょうど期限切れ**（TTL ちょうどは fresh ではない。take-over 判定に使われる `isFresh` は TTL を越えた瞬間に false になり、その判定が take-over と sweep の両方に共有されている）
- 検証: `npm run type-check` と `src/utils/__tests__/`（および recoveryClaimStore の既存テスト）

## 実装内容

1. 時刻源の注入（既定は `Date.now`）
2. claim 取得時の期限切れ sweep
3. 境界条件のユニットテスト

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [x] コードレビュー完了（統合担当が実装内容と diff を照合して確認）

## 実装記録（2026-10-02）

変更した内容:

- `recoveryClaimStore.ts` — `createRecoveryClaimStore({ now })` ファクトリを新設し、`claimRecoveryOwner` / `releaseRecoveryOwner` をその内部関数としてクロージャにする形にした。既存の 2 つの自由関数は `createRecoveryClaimStore()` の既定インスタンスからの分割 export として同じ名前・同じシグネチャで公開されるため、呼び出し側（`offlineQueueProcessor` / `recordingHandlers` / `notificationHandlers`）は変更不要
- `withoutExpiredClaims(claims, now)` を追加し、`claimRecoveryOwner` の updater で「対象 URL が fresh なら無変更、take over なら sweep 済みの map に自分のエントリを足す」ようにした。sweep は take-over と同じ `withOptimisticLock` の CAS 内に載っているため、掃除と取得は 1 つの write で原子的に行える
- 時刻源は `options.now ?? (() => Date.now())` として**呼び出しごとに解決**する（参照で捕捉すると、テストで fake clock を入れても実際の clock が残り続けるため）
- モジュール docstring から PBI ID 参照を削り、claim が 1 つの storage key を共有しているため、claim 取得が sweep を伴うという WHY を追記。`isFresh` の doc に「age < TTL」を明記

追加したテスト（`src/utils/__tests__/recoveryClaimStore.test.ts` の `expired-claim sweep` と `claim TTL boundary` describe）:

- TTL より前のエントリが、その URL を再 claim されずに削除され、TTL 内の 2 件が残り、map が 2 件に収まることを assert（fake timers は `toFake: ['Date']` のみ。CAS 経路は実 timer のままで走らせる必要があるため）
- 拒否された claim（`false`）は sweep を含めて何も書かないため、既に期限切れのエントリはその場で消えないことを assert
- 注入した時刻源（`createRecoveryClaimStore({ now })`）で TTL の判定がその時計に従うことを assert
- 境界: age = TTL - 1ms で claim は保持（`false`）、age = TTL で再 claim が成功して `claimedAt` が更新されることを assert

**逸脱（境界の文言修正）**: 本 PBI のテスト戦略は「TTL ちょうどは fresh 扱い、1ms 超過で掃除対象」と書いていたが、これは実装と食い違っていた。実際の切り替え点は `isFresh` の `now - claim.claimedAt < CLAIM_TTL_MS`、すなわち **age < TTL が fresh** で、TTL - 1ms は fresh、TTL ちょうどで期限切れ（sweep 対象）になる。`isFresh` は take-over 判定と sweep で共有されているため `<` を `<=` に変えて TTL ちょうどを fresh にすると take-over のセマンティクスが変わる（TTL ちょうどで別 owner が claim を奪えなくなる）。TTL と take-over の意味は現状のまま維持する前提なので、判定式には触れず、説明の文言側を実挙動に合わせて修正した。境界は `claim TTL boundary` describe が固定している。
