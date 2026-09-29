# PBI: OPFS worker 死亡時の実行時デグレ（IDB への backend 再解決）

種別: fix
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ4）。fallback ラダー（OPFS → IDB → memory）が init 時の一回限りの決定に留まり、OPFS worker がセッション途中で死亡しても実行時に backend が再解決されない状態を解消する。

## ユーザーストーリー

拡張の利用者として、記録の追加と履歴閲覧が途中から全面的に失敗する状態を回避したい、なぜなら OPFS worker は拡張の更新やメモリ圧迫で途中で死にうるのに、offscreen 文書が生きている限り同じ backend が返り続けるから

## 優先度

- 順位: 6 / 10
- RICE スコア: 6.4（Reach=4 / Impact=2 / Confidence=80% / Effort=1.0）
- 根拠: 欠落がコードから確定している（解決結果のキャッシュと production に無い再解決経路）ため設計上の寄与は確実だが、発生条件が「init 成功後に worker が死亡する」というレアなケースであり、Confidence を 100% には置けない。よって C=80%。Reach は offscreen の backend 選択と `OpfsWorkerBackend` 全体、Impact は全 storage 操作の恒久失敗と大きいが発生頻度は未知のため 2 に留める。修正は adapter 側と host 側に分かれて 1.0 SP で収まる

## 現状と問題（file:line 証拠付き）

- `src/offscreen/sqliteEngineHost.ts:336` の `getBackend()` は解決結果を `this.#state._backend` にキャッシュし、以後は engine が死んでいても同一体を返し続ける
- `resetBackend()`（`sqliteEngineHost.ts:361-363`）は production 経路から呼ばれていない。参照は `resetForTesting()`（`sqliteEngineHost.ts:367`）とテスト `src/offscreen/sqliteEngineContext/__tests__/coverage.test.ts:336` のみ。よって実行時に backend を再解決する経路が存在しない
- worker 死亡後も `OpfsWorkerBackend` が返り続ける結果、`src/offscreen/OpfsWorkerBackend.ts:23, 46, 67, 73, 79, 85, 159, 170, 178, 184` の 10 箇所が同じエラーリテラル `OPFS Worker unavailable` を返す。リテラルと判定は手書きで、各メソッドが独立に `tryOpfsProxy` の `null` を見ている
- `tryOpfsProxy` は失敗を `null` に畳み込む: `src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts:134-142`（catch で warn を出し `null` を返す）。呼び出し側に失敗情報が渡らないため、デグレ判定の材料がない
- `StorageBackend` には既に `healthCheck()` がある: `src/offscreen/StorageBackend.ts:68-92`（Queryable フェセット、宣言は `:77`）。しかし backend 選択はこの結果を一切参照しない
- fallback ラダーは `_doInit` の catch で確定する: `src/offscreen/sqliteEngineHost.ts:237-287`（`:278` で `usingFallbackStorage = true`）。つまり「OPFS → IDB → memory」はフォールバックではなく init 時の一回限りの決定である
- 決定関数自体は正しい: `src/offscreen/backendResolver.ts:40-45` の `resolveBackend` は純関数で、8 組み合わせを `src/offscreen/__tests__/backendResolver.test.ts:8-62` がカバーしている。ただし実行時の再解決には使われていない

## 改善方針（方向性）

1. `OpfsWorkerBackend` に連続失敗カウンタを追加する。`tryOpfsProxy` が連続 N 回 `null` を返したら「degrade が必要」と通知する
2. `sqliteEngineHost` が通知を受けたら `resetBackend()`（`sqliteEngineHost.ts:361-363`）を呼び、既存の `resolveBackend`（`backendResolver.ts:40-45`）で IDB へ再解決する。再解決できない場合は既存の fallback storage 経路に乗せる
3. degrade はセッション内で 1 回だけ許可する。2 度目の degrade は fallback storage まで進め、flapping を防ぐ
4. degrade 発生時は `addLog`（`src/utils/logger/core.ts:86`）へ記録し、どこで落ちたかを追えるようにする

## BDD 受け入れシナリオ

```gherkin
Scenario: worker 死亡時に IDB へ degrade する
  Given OPFS worker backend が使用中で、解決結果がキャッシュ済みである
  When tryOpfsProxy が連続 N 回失敗する
  Then backend が IDB に再解決され、以降の操作が成功する

Scenario: degrade は 1 回だけ
  Given すでに IDB へ degrade 済みである
  When IDB も失敗する
  Then fallback storage へ 1 回だけ degrade し、無限に flap しない

Scenario: 一時的な 1 回の失敗では degrade しない
  Given OPFS worker backend が使用中である
  When tryOpfsProxy が 1 回だけ失敗し、続く操作が成功する
  Then backend は OPFS のままである
```

## 受け入れ基準

- [x] `src/offscreen/sqliteEngineHost.ts:361-363` の `resetBackend()` に production から到達する呼び出し元が存在する
- [x] `OpfsWorkerBackend` に連続失敗カウンタがあり、閾値到達時にホストへ通知する
- [x] 再解決は `src/offscreen/backendResolver.ts:40-45` の `resolveBackend` を経由し、優先順位ロジックを重複実装しない
- [x] degrade は 1 回まで。再 degrade は fallback storage のみとし、flapping しない
- [x] degrade 発生が `addLog`（`src/utils/logger/core.ts:86`）に記録される
- [x] `src/offscreen/OpfsWorkerBackend.ts` の手書き `OPFS Worker unavailable` が単一箇所に集約されている

## テスト戦略

- 単体: `OpfsWorkerBackend` の連続失敗カウンタ。1 回失敗では閾値未満、連続 N 回で通知が 1 回だけ発火、成功が挟まると 0 に戻ることを fault-injection mock で確認する
- 統合: `sqliteEngineHost` の degrade → `resetBackend()` → IDB 再解決。worker mock で `tryOpfsProxy` を失敗させ、以降の操作が成功すること、2 度目の degrade が fallback に落ちることを確認する
- 実 SW-kill による E2E 検証は本ラウンドの対象外とする（`pbi/2026-09-28-00-backlog-holistic-review.md:33` と同じ方針。fault-injection 統合テストで代替する）

## 見積もり

1.0 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録（2026-09-29）

### seam の設計

fallback ラダーを「決定」と「副作用」に分けて、決定は既存の `resolveBackend` に残し、副作用だけを host に足した。

- **adapter（`OpfsWorkerBackend.ts`）= 証拠だけを持つ**
  - proxy 呼び出しを `callWorker()` に一本化（メソッドごとにあった `null` 判定は、自分の 1 回の失敗しか見ていなかった）。成功で連続失敗を 0 に戻し、`null` が `OPFS_DEGRADE_FAILURE_THRESHOLD`（3）に達した adapter ごとに 1 回だけ `onDegraded` を呼ぶ。通知は `await` する（fire-and-forget だと、再解決が終わるまでの間も次の呼び出しが同じ死んだ adapter をキャッシュから取り出すため）。
  - degrade 通知は注入 seam（コンストラクタ第 2 引数）。adapter は host の state を持たず、閾値・one-shot の判断だけをここに閉じる。
- **host（`sqliteEngineHost.ts`）= ラダーだけを持つ**
  - `degradeFromOpfs()` が production から `resetBackend()` を呼ぶ唯一の経路。既存の `_doInit` に `skipOpfs` を足し、OPFS の段だけを外して init ラダーを再実行する。段の選択は `resolveBackend()` に任せ、優先順位は複製していない。
  - 3 つの state リテラル（`ensureBackend` / `getBackend` / 新設の degrade 経路が 4 つ目を書くことになる）は `resolverState` getter に集約。
  - latch は boolean ではなく段階（`#degradeStage`: `opfs` → `idb` → `fallback`）。再信号は IDB 段を再実行せず fallback storage へ直行し、3 回目以降は no-op。OPFS へ戻る経路は作っていない（`init()` は `idbEngine` の早期 return に入り、OPFS 段を歩き直さない）。
  - 再解決が失敗した場合も `finally` で `resetBackend()` する。失敗した再解決より死んだ adapter が長く生きると、以降の `getBackend()` が毎回それを返すため。
  - ログは `logWarn`（`logger/api.js` → `addLog`）。`logError` だと正常な縮退がエラー件数に載るため `WARN` にした（受け入れ基準は「`addLog` に記録」のみでレベル指定なし）。

### 変更ファイル

- `src/offscreen/OpfsWorkerBackend.ts` — 定数 2 個（`OPFS_WORKER_UNAVAILABLE_ERROR` / `OPFS_DEGRADE_FAILURE_THRESHOLD`）、`callWorker()`、degrade 通知、11 箇所のリテラルを 1 箇所へ集約
- `src/offscreen/sqliteEngineHost.ts` — `degradeFromOpfs()` / `#runDegrade()` / `#reinitWithoutOpfs()` / `#enterFallbackStorage()`、`resolverState`、`_doInit({ skipOpfs })`、`resetBackend()` の production 到達性のコメント
- `src/offscreen/backendResolver.ts` — `opfs` factory から `() => context.degradeFromOpfs()` を注入
- `src/offscreen/__tests__/opfsWorkerBackend-degradation.test.ts`（新規）— adapter 側 22 件
- `src/offscreen/__tests__/opfsDegradation.integration.test.ts`（新規）— host 側 13 件

### テスト

```
npx vitest run src/offscreen/__tests__/opfsDegradation.integration.test.ts \
                 src/offscreen/__tests__/opfsWorkerBackend-degradation.test.ts
  → Test Files 2 passed / Tests 35 passed（10 回連続実行も全て 35 passed）

npx vitest run src/offscreen
  → Test Files 91 passed / Tests 1194 passed

npx vitest run src/offscreen/__tests__/backendResolver.test.ts \
                 src/offscreen/__tests__/backendResolver-coverage.test.ts \
                 src/offscreen/sqliteEngineContext/__tests__/coverage.test.ts \
                 src/offscreen/__tests__/auditLogPurgeSeam.test.ts \
                 src/offscreen/__tests__/queryDispatchRegression.test.ts \
                 src/offscreen/__tests__/StorageBackend-comprehensive.test.ts \
                 src/offscreen/sqliteEngineContext/__tests__/opfsWorkerProxy.test.ts \
                 src/offscreen/__tests__/opfsWorkerProxy-coverage.test.ts
  → Test Files 8 passed / Tests 142 passed

npx tsc --noEmit -p tsconfig.json   → exit 0
npx eslint <変更 5 ファイル>         → 指摘 0
```

- BDD 3 シナリオの対応: 「worker 死亡時に IDB へ degrade」「degrade は 1 回だけ（再信号は fallback へ直行、3 回目は no-op）」「1 回の失敗では degrade しない」はいずれも `opfsDegradation.integration.test.ts` に。
- fault injection は worker の応答自体（`setOpfsWorkerFactory` で差し込んだ実 worker の onmessage ルーティング）で行うため、`tryOpfsProxy` の null 畳み込みも本物の経路を通る。engine 側（IDB / fallback storage）だけはスタブ。

### 逸脱・判断

- 現状と問題の `:23, 46, 67, 73, 79, 85, 159, 170, 178, 184` は 11 箇所だった（`getStatus` / `getCount` / `backupDb` を含む）。11 箇所すべてを 1 つの定数に集約。
- 記録にある「`sqliteAlert` の `INIT_SUPPRESSED_PATTERNS` が文言に依存」は認識した上で**文言を変えていない**（定数の値そのものをテストで pin している）。
- `IdbVfsBackend` には連続失敗カウンタを足していない（PBI のスコープは `OpfsWorkerBackend`）。IDB 段が失敗した場合の fallback への直行は host 側の段階 latch として実装し、「2 回目の信号」テストで固定した。IDB adapter 自身の障害検知は別件。
- OPFS worker を殺す実 E2E は本ラウンドの対象外（テスト戦略の記載どおり fault-injection 統合テストで代替）。
- `npm run validate` とコードレビューは未実施（DoD のチェックを外したまま残す）。
