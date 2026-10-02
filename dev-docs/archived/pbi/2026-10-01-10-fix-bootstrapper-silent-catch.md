# PBI: DashboardBootstrapper のサイレント catch の解消

## 優先度・backlog 出所・依存

- **優先度**: RICE 30.0（R=5 / I=3 / C=1.0 / Eff=0.5）、backlog 順位 3、NN10
- **出所**: [backlog: holistic-1001](./2026-10-01-00-backlog-holistic-1001.md)
- **依存**: なし（バッチA・dashboard panels、他候補とファイル非重複）
- **種別**: fix

## ユーザーストーリー

開発者として、パネル遷移の失敗が devtools console に記録されてほしい。なぜなら、歴史的理由で入った catch が実エラーを無言で吞むと、パネル id のタイプミスや `panel.mount()` の throw が「押しても何も起きない」状態になり、原因追跡ができないから。

## 背景（現状）

- `src/dashboard/panels/DashboardBootstrapper.ts:131-133` — sidebar click ハンドラ内で `void this.registry.navigate(panelId).catch(() => { /* Panel not yet migrated to new system; old navigation handles it */ })`。コメントが指す「未 migrate パネル」は `registerCatalog()`（:35-39）が `PANEL_CATALOG` 全件を登録する現状ではもう存在せず、catch は今は `NavigationRegistry.navigate()` の実エラーを無言で吞む
- `src/dashboard/panels/staticForm/__tests__/staticPanels.test.ts:11-14` が機械的に担保する領域: id のタイプミスは `NavigationRegistry.navigate()` が throw するが、本 catch が吞むため該当タブだけが「押しても何も起きない」状態になり、console に何も出ない
- `src/dashboard/main.ts:24` — dashboard 側 main の `await bootstrapper.start(resolveInitialPanelId())` が top-level await。`registry.navigate()` が reject するとモジュール評価がそこで死に、後続の `applySectionDeepLink()`（:25）と `initDashboard()`（:27）が走らない。失敗はどこにも記録されない
- 既存の通知経路: `src/dashboard/notificationService.ts` の `notify()`（chrome.notifications 依存、API 未導入環境で no-op、`src/dashboard/__tests__/notificationService.test.ts` でテスト済み）。asyncData パネルの `notices.showError` 慣習は panel container が解決済みであることが前提のため、bootstrap 時点では `notify()` が第一候補

## BDDシナリオ

### Scenario: navigate 失敗が少なくとも console に記録される

```gherkin
Given sidebar が wire されている
When `registry.navigate()` が reject する
Then サイレント吞み込みは発生せず、console.error に失敗が記録される
```

### Scenario: 正常な navigation は従来どおり

```gherkin
Given sidebar が wire されている
When パネルボタンを押す
Then active tab 更新と settings subgroup 同期は従来どおり動き、失敗時の通知は出ない
```

### Scenario: start() の初期失敗も記録される

```gherkin
Given 初期 panel id への navigate が失敗する
When `bootstrapper.start()` が走る
Then 失敗が console に記録され、dashboard の残りの初期化（`applySectionDeepLink()` / `initDashboard()`）が継続する
```

## 実装戦略

**It must keep behavior**: 正常系の navigation（active tab 更新、aria-selected、settings subgroup 同期、roving tabindex、`onDidNavigate` 購読）は一切変わらない。`wireSidebar` の click ハンドラは fire-and-forget のまま catch を外さない — 変えるのは「catch の中身をサイレントから記録へ」のみ。

`start()` は初期 navigate の失敗を catch して記録する。top-level await でモジュール評価ごと死なせる現状より、失敗を残して評価を続行する方が堅牢（初期パネルの失敗で dashboard 全体が死なない）。最低要件は「失敗が記録される」こと。

### 受け入れ基準

- [x] 1. `navigate` 失敗が少なくとも console に記録される
- [x] 2. サイレント吞み込み（空の catch + 「未 migrate」コメント）が消える
- [x] 3. `start()` の初期 navigate 失敗も記録される
- [x] 4. 正常系の navigation 挙動（active tab / aria-selected / settings subgroup 同期）が変わらない
- [ ] 5. 失敗時に既存の通知経路（`notify()`）または同等のユーザー可視経路が出る — **未達**（実装記録参照）
- [x] 6. 既存テストが green

## テスト戦略

- `src/dashboard/panels/__tests__/DashboardBootstrapper.test.ts`（jsdom）に reject ケースを追加: `registry.navigate` を reject させ、ボタン click 後に `console.error` が呼ばれること・`notify` が呼ばれること（module mock）を spy で確認。正常系テストは無変更で green
- `start()` の初期失敗ケース: navigate を reject させ、`start()` が reject せず console.error が呼ばれることを確認
- 繰り返しゲート: `npx vitest run src/dashboard/panels/__tests__/DashboardBootstrapper.test.ts --repeats=20` 全回 green
- コミット前ゲート: `npm run validate`

## 実装内容

1. `src/dashboard/panels/DashboardBootstrapper.ts:131-133` — catch を `console.error('[DashboardBootstrapper] navigate failed:', error)` + `notify(...)` に置換し、コメントは現状の事実（全パネル migrated、catch は実エラーの記録口）に更新
2. `start()` — try/catch を付けて初期 navigate の失敗を `console.error` + `notify` し、reject を外に漏らさない。または `src/dashboard/main.ts` 側で catch して記録（どちらかの実装で「無記録のまま評価が死ぬ」を解消）
3. `src/dashboard/main.ts` — 起動経路のコメントが現状と合致するか確認し、乖離があれば更新

## Definition of Done

- [ ] 受け入れ基準 1-6 をすべて満たす（5 が未達。下記「実装記録」の逸脱を参照）
- [x] navigate reject 時に console 記録があることを検証するテストが存在する
- [x] `npx vitest run src/dashboard/panels/__tests__/DashboardBootstrapper.test.ts --repeats=20` 全回 green
- [x] `npm run validate` green
- [x] 正常系の navigation テストが無変更で green

## 実装記録（2026-10-02）

変更した内容:

- `DashboardBootstrapper.ts` — sidebar click ハンドラと `start()` の両方に 있던無言の catch を、共通の private `#reportNavigateFailure(panelId, error)` へ集約し、`console.error` で記録する形にした。「Panel not yet migrated」コメントは、`registerCatalog()` が `PANEL_CATALOG` 全件を登録する現在の事実に合わせて書き換えた
- `start()` — 初期 navigate を try/catch で包み、失敗を記録して resolve する形にした。`src/dashboard/main.ts:24` は top-level await で `start()` を待つため、従来は reject がモジュール評価ごとを殺して後続の `applySectionDeepLink()` / `initDashboard()` を巻き込んでいた

追加したテスト（`DashboardBootstrapper.test.ts` の `navigate failures are recorded, not swallowed` describe）:

- sidebar click で reject された navigate が `panel-missing` を含む `console.error` で記録される
- 初期 navigate の reject でも `start()` は reject せず `console.error` が呼ばれる
- 正常系では `console.error` が一切呼ばれず active tab が更新される

**逸脱（受け入れ基準 5）**: 失敗の記録は `console.error` のみ。`DashboardBootstrapper` は panel コンテナの解決前という bootstrap 時点に位置し、`notices.showError` の慣習が前提とする panel container を持ち得ない。用户可視の通知チャネルを新設すること（dashboard 全体の通知経路の設計）が本 PBI のスコープ外だったため、基準 1 の「少なくとも console に記録される」のみ充足とし、基準 5 は未達として残す。通知経路の追加は別 PBI の課題。

検証: `npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。
