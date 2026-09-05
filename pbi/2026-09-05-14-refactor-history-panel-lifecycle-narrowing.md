# PBI 14: History panel lifecycle interface の狭窄（onNavigateIn/onNavigateOut へ折り畳み）

優先度: Round 5 4 位 / RICE 5.0 = (3 × 1 × 60%) / 0.4w / Strength: Worth exploring
backlog: [2026-09-05-00-backlog-arch5.md](2026-09-05-00-backlog-arch5.md)
依存: なし。ただし arch3/arch4 で 2 回見送られた「history-panel 完全統合」の**絞り込み版**であり、legacy panel 移行・tag-filter SQL 化は本 PBI に含めない（前提未達: panel-history の navigation 監査が未実施）

## ユーザーストーリー
Dashboard 履歴パネルの遷移挙動を保守する開発者として、遷移時（navigate in/out）の処理順序が Model の 2 method の裏に隠れてほしい。なぜなら現在は lifecycle 配管 6 method（checkFallbackStatus / retryInitialLoad / consumePendingInit / loadPersistedSortIntoState / bumpGenerationOnUnmount / resetFiltersForFreshLoad）が Model interface に露出し、正しい呼び順の知識が Panel と Model に分裂し、テストが interface を越えて配管を直接叩いているから。

## 現状の遷移 choreography（2026-09-05 ファクトチェック済み）

- `NavigationRegistry.ts:56-66` — mount-once、タブ切替では `init → load` のみ（`destroy` は teardown 時のみ・設計）
- `sqliteHistoryPanel.ts:558-598` —
  - `init(initParams)`: searchTag → `activateWithTag` / searchDomain → `activateWithDomain` / else → `resetFiltersForFreshLoad`
  - `load()`: `checkFallbackStatus` → `loadPersistedSortIntoState` → `renderState()` → `consumePendingInit` → `retryInitialLoad`
  - `destroy()`: debounce 解除 + unsubscribe + `bumpGenerationOnUnmount` + `clearEntrySelection`
- `sqliteHistoryModel.ts` — interface 27 method、うち lifecycle 配管 8（上記 6 + activateWithTag / activateWithDomain）。cache.clear() が 5 箇所（`:550` / `:566` / `:582` / `:602` / `:612`）に散在

## なぜなぜ分析（設計判断の導出）

**問い: なぜ lifecycle 配管が Model interface に露出しているのか**

1. なぜ 6 method が公開されたのか → Round 2（PBI 17）で Model へ状態を集約した際、「Panel が今まで呼んでいた関数」をそのまま公開 API にしたから。
2. なぜ呼び順の知識が分裂したのか → 「init で filter を決め、load で status → sort → init 消費 → 取得」という**順序**の所有者が決まらず、Panel が順序を、Model が部品を持ったから。
3. なぜ destroy で generation bump するのか → registry がタブ切替で destroy を呼ばない（panel は mount 維持）ため、unmount 時の generation 増加と fresh-load 時の filter reset が別々の場所に置かれたから（`sqliteHistoryModel.ts:553-569` のコメントが順序の理由を文書化）。
4. なぜそれが friction か → 遷移時の正しい呼び順を知るには Panel と Model の両方を読む必要があり、テストも `consumePendingInit` の exactly-once 等を Model レベルで white-box 検証するしかない（interface is the test surface 違反）。
5. → 解: 順序の owner を Model に集約し、interface は **`onNavigateIn(initParams?)` / `onNavigateOut()` の 2 method** に狭窄する。Panel は「いつ呼ぶか」だけを知る。

**問い 2: cache 無効化の 5 箇所散在をどう扱うか**

1. なぜ 5 箇所あるのか → 無効化の契機が 3 種あるため（unmount / fresh-load の stale / mutation 後）。
2. なぜ散在が friction か → 「どの契機で無効化が必要か」の規則がコードから読み取れず、新規 mutation 追加時に cache.clear() を足し忘れて stale cache バグを生む（fresh-load の stale コメント `:560-564` はまさにその手の過去バグの記録）。
3. → 解: internal に `invalidateCache(reason)` を新設し、規則（3 契約機）を 1 箇所に文書化。5 call site はヘルパー経由に。generation bump との組み合わせは現行どおり（mutation sites は bump しない — in-flight query 保護の意味論を変えない）

## BDD受け入れシナリオ

```gherkin
Scenario: タブ再訪時の fresh-load が 1 呼び出しで完結する
  Given 前回の訪問で tag filter と date filter が残っている panel
  When  init({}) を経て load() が 1 回呼ばれる
  Then  filter が reset され、fallback 確認 → 永続 sort 反映 → 初回取得（retry 付き）が内部で実行される

Scenario: tag 引き継ぎ遷移が 1 呼び出しで完結する
  Given タグクラスタパネルから searchTag を付けて遷移してくる
  When  init({ searchTag }) → load() が呼ばれる
  Then  tag filter が有効な初回取得が 1 回の onNavigateIn で実行される（今日の activateWithTag + retryInitialLoad と同一）

Scenario: destroy 時の後片付けは 1 呼び出しで完結する
  Given 選択中エントリと未フラッシュの sort persist がある panel
  When  destroy() が呼ばれる
  Then  generation 増加・persist flush・cache 無効化・選択解除が内部で実行される（今日の bumpGenerationOnUnmount + clearEntrySelection と同一）

Scenario: 遷移 2 method の外から lifecycle 配管に触れない
  Given sqliteHistoryModel の interface
  When  公開 method 一覧を検査する
  Then  checkFallbackStatus / retryInitialLoad / consumePendingInit / loadPersistedSortIntoState / bumpGenerationOnUnmount / resetFiltersForFreshLoad / activateWithTag / activateWithDomain が公開されていない
```

## 受け入れ基準
- [ ] `SqliteHistoryModel` interface に `onNavigateIn(initParams?: { searchTag?: string; searchDomain?: string })` と `onNavigateOut()` が追加される
- [ ] lifecycle 配管 8 method（checkFallbackStatus / retryInitialLoad / consumePendingInit / activateWithTag / activateWithDomain / loadPersistedSortIntoState / bumpGenerationOnUnmount / resetFiltersForFreshLoad）が interface から外れ、クロージャ内関数になる（interface 27 → 21 method）
- [ ] `sqliteHistoryPanel.ts` の init/load/destroy が Model の 2 method 呼び出しに縮減する（Panel.init は initParams の保持のみ。PanelLifecycle interface・NavigationRegistry は無修正）
- [ ] `invalidateCache(reason)` 内部ヘルパーが新設され、5 call site が経由する（mutation sites は generation bump をしない現行意味論を維持）
- [ ] 既存 13 テストファイルの lifecycle 関連テストが onNavigateIn/onNavigateOut 契約テストに移行する（fetchData・reducer・cache・sort persistence の各テストは無修正）
- [ ] 振る舞いが変更前と同一（リファクタリング）。generation / pendingInit exactly-once / sort persistence の既存アサーションを契約テストとして維持

## テスト戦略（t_wadaスタイル）
### 単体テスト
- Model 契約テスト新設: onNavigateIn の 3 分岐（tag / domain / plain）× 取得パラメータ、onNavigateOut の副作用 4 点
### 統合テスト
- Panel+Model+Registry の順序契約テスト（init→load 順序・onNavigateIn 1 回・destroy 経由の onNavigateOut）を 1 本に集約 — 現状の Panel 単体テストの白盒部分を置換
### 例外ハンドリング
- checkFallbackStatus の失敗無視・retryInitialLoad の backoff は現行実装のまま（既存テストが担保）

## 見積もり
0.4w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: Model は引き続き DOM-free。テストは 2 method を通るため jsdom 不要のまま
- 非機能要件: fetch・cache・persist のタイミングを変えない（renderState の位置は Panel に残す）
- 見送り境界: legacy `panel-history` の統合（navigation 監査が必要）と tag-filter の SQL 移行（5000 over-fetch cap）は含めない。次ラウンドの再評価対象
- 関連: `sqliteHistoryPanelController.ts` / `sqliteHistoryPanelState.ts` の re-export shim は本 PBI の対象外（既存の PBI-17 残置物）

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '331,360p' src/dashboard/panels/asyncData/sqliteHistoryModel.ts   # interface
sed -n '489,570p' src/dashboard/panels/asyncData/sqliteHistoryModel.ts   # lifecycle 実装
sed -n '552,599p' src/dashboard/panels/asyncData/sqliteHistoryPanel.ts   # init/load/destroy
rg -n "activateWithTag|activateWithDomain|consumePendingInit|bumpGenerationOnUnmount" src --glob '!**/__tests__/**'
```

### 実装手順
1. Model 内部に `onNavigateIn` を新設（init 3 分岐 → status → sort → pendingInit 消費 → retryInitialLoad の順序を 1 関数に）し、Panel.load から呼ぶ
2. `onNavigateOut` を新設（bumpGenerationOnUnmount 内包 + clearEntrySelection）し、Panel.destroy から呼ぶ
3. 配管 8 関数をクロージャ内に移動（interface から削除）
4. `invalidateCache(reason)` を新設し 5 call site を付け替え
5. lifecycle 系テストを契約テストに移行（他は無修正 green を確認）

### 落とし穴
- `activateWithTag` は呼んだ**直後**に fetchData を発火し、かつ pendingInit を積む（後の retryInitialLoad が同じ条件を再取得する — 今日の意図的挙動）。onNavigateIn 内でこの二段構えを崩すと取得回数が変わる。現行の呼び出し回数を契約テストで固定してから動かすこと
- `resetFiltersForFreshLoad` は sort だけ保存して残りを初期化する（`:567-568`）。onNavigateIn 内での実行順（status/sort より前）を維持する
- Panel.init は `container` 未設定でも呼ばれ得る（registry の init→load 順序）。initParams の保持のみにし副作用を持たせない
- `sqliteHistoryPanelController.test.ts` が consumePendingInit の exactly-once を検証している — shim 経由のこのテストは契約テスト移行後も意味が通る形に調整する

### 実装メモ
- 二重 init の stale-tag 漏れを意図的に修正：旧実装は `init(tag)→init()` でも `pendingInit` が残るため、素の再訪が stale tag で再取得し得た。新実装は Panel が `pendingNavParams` を後勝ちで保持し `load()` で exactly-once 消費するため最後の init が勝つ（`sqliteHistoryPanel.navigate.test.ts` の二重 init テストで担保）。純粋リファクタを超える振る舞い修正として記録する。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] dashboard 関連テスト全 green（type-check / lint / build 含む）
- [ ] コードレビュー完了
- [ ] ドキュメント更新（DESIGN_SPECIFICATIONS.md の history panel 節に lifecycle interface を反映。arch3 backlog の「history-panel unify 見送り」条に「絞り込み版は実装済み・legacy 移行と tag SQL 化は残置」と追記）
