# PBI: sidebar クリック経路の navigate 失敗時にタブ active 状態を整合させる

## ユーザーストーリー

dashboard の利用者として、サイドバーのタブをクリックしてパネル遷移が失敗した場合でも、タブの active/aria-selected 状態が実際に表示されているパネルと一致していることを期待する。失敗時に新パネルのタブだけが active になり中身は旧パネルのまま、という不整合は支援技術の読み上げと操作対象を狂わせる。

## 優先度

- 順位: 11 / 15
- RICE: 2.0（R=2 / I=0.5 / C=1.0 / Effort=0.5）
- 根拠: 発生条件は navigate 失敗（typo'd id、mount throw）に限られ Reach は小さいが、dashboard パネル遷移の a11y 状態（aria-selected）を直接壊す実在バグ。配線を直接読んで確定済み（C=1.0）で quick win。

## 背景（file:line 付き現状）

- `src/dashboard/panels/DashboardBootstrapper.ts:129` — クリックハンドラ内で `#updateActiveTabForPanel(panelId)` を先に実行し、`:133-135` の `void this.registry.navigate(panelId).catch((error) => this.#reportNavigateFailure(panelId, error))` は後から走る。active 状態は navigate の成否と無関係に新パネルへ先に更新される。
- navigate 失敗時（typo'd id、mount throw）は catch で `#reportNavigateFailure`（`:182-184`、`console.error` のみ）が走るだけで、active 状態のロールバックは存在しない。結果: 新パネルのタブが active/aria-selected=true（`#updateActiveTabForPanel` `:41-52` が `:46-51` で `active` クラスと `aria-selected`/`tabindex` を割り当て）のまま、表示は旧パネルのまま残る。
- 対照的に `start()`（`:169-180`、try 内 `:171-173`）は `await navigate` → `#updateActiveTabForPanel` の逆順（update after resolve）で、失敗時は catch `:174-179` に落ちるため state 更新が起きず不整合が発生しない。

## BDD受け入れシナリオ

### Scenario 1: navigate 成功時は新パネルのタブが active になる（現行挙動を維持）

```gherkin
Given サイドバーのタブ A が active である
When ユーザーがタブ B をクリックし registry.navigate が成功する
Then タブ B が active/aria-selected=true/tabindex=0 になりタブ A は外れる
And B パネルが表示される
```

### Scenario 2: navigate 失敗時に active 状態が表示と整合する

```gherkin
Given サイドバーのタブ A が active である
When ユーザーがタブ B をクリックし registry.navigate が reject する
Then タブ B が active/aria-selected=true のまま残らない
And タブ A が active のまま（またはロールバック後の一貫した状態）である
And 失敗が console.error を超えてユーザーに見える形で扱われる方針が決定・実装されている
```

### Scenario 3: start() の既存挙動は不変

```gherkin
Given start(defaultPanelId) が dashboard 初期化で呼ばれる
When registry.navigate(defaultPanelId) が成功する
Then navigate 解決後に updateActiveTabForPanel が走る（現行の順序と挙動のまま）
And 失敗時は reportNavigateFailure のみで state を壊さない
```

## 受け入れ基準

- [x] 1. クリック経路の失敗時、新パネルのタブが active/aria-selected のまま残らない: `src/dashboard/panels/DashboardBootstrapper.ts:129` の `#updateActiveTabForPanel` を `:133-135` の `navigate` 解決後に移動するか、catch で旧パネルへロールバックする。どちらを採るかは失敗のユーザーへの見せ方（フィードバック表示の有無）とセットで決定し記録する。
- [x] 2. 失敗時のユーザーへの見え方（フィードバックの有無・文言）が決定され、`console.error`（`:182-184`）だけで不整合を放置しない。
- [x] 3. 成功時の外部挙動は不変: `:41-52` の active/aria-selected/tabindex 割り当てと `:126` の settings 展開の順序は保たれる。
- [x] 4. `start()`（`:169-180`）の順序・catch 挙動は無変更。
- [x] 5. 対象ファイルは `src/dashboard/panels/DashboardBootstrapper.ts` とそのテストに限定する。

## テスト戦略

- 単体（jsdom）: `registry.navigate` を reject させるモックでクリック → 失敗 → 新パネルのタブに `active`/`aria-selected=true` が残らないことを assert。成功経路（Scenario 1）は既存テストの互換確認。
- `start()` の既存テストが無変更で green であることを回帰確認。
- 待ちは `waitForMock()` 等の完了シグナルで実時間待ちを入れない。`npx vitest run <file> --repeats=20` で全 run green。

## 見積もり

2 SP（Effort 0.5）

## Definition of Done

- [x] BDD 3 シナリオがテストとして実装され green
- [x] 失敗時にタブ状態と表示パネルが一致することを assert するテストが存在する
- [x] 失敗時のユーザーフィードバック方針が決定・記録されている
- [x] `npm run validate` と `npm run type-check` が green
- [x] backlog（順位 11）としての完了報告が紐づく — アーカイブ/台帳更新は別ステップ

## 実装記録（2026-10-03）

- 裁定: catch でのロールバック方式（update 先移動ではなく）。`#rollbackActiveTab(panelId, previousTab)` を新設し、クリック前に active タブを snapshot（`:159`）、navigate 失敗時は `#updateActiveTabForPanel` の後でも snapshot へ戻す。
- 失敗時の見え方: ロールバック自体がユーザー可視のハンドリング（クリックがパネルを切り替えなかったことが分かる）。`#reportNavigateFailure`（console.error）での追加記録は維持。toast は意図的に入れない — パネルコンテナが存在する前に走るため、dashboard 全体通知経路は別作業。
- `#setActiveTab` を `#updateActiveTabForPanel` から抽出（単一タブへの active/aria-selected/tabindex パターン適用、null で全タブ解除）。
- テスト: `DashboardBootstrapper.test.ts` に 4 件を追加（失敗時ロールバック、成功時維持、start() 不変、post-activation ケース待ち `waitForMock` 使用）。修正前 RED 2 件を確認。21/21 green、`--repeats=20` 全 run green。
- 検証: tsc --noEmit 0 エラー / npm test 15,465 pass / npm run validate exit 0。
- 逸脱: ロールバックは `registry.activeId === panelId` の場合に発火しない — registry が先に clicked パネルへ切り替えてから失敗した場合（activation 後の mount throw）、表示されている要素が clicked パネル自身であり、ロールバックすると本修正が防ぐべきタブ/表示不整合を作り直すため。受け入れ基準 1 の「どちらかを採るかは見せ方とセットで決定」の裁定部分として記録。
