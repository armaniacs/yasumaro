# PBI: provider priority slots の A/B 収集重複を単一ヘルパーへ集約（NN21 積み残し）

優先度: NN21 follow-up / RICE 4.0（暫定・integrator 裁定待ち）/ SP 0.5（small）
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「死んだシーム群」）
親 PBI: [2026-10-01-21-refactor-dead-seams-removal.md](2026-10-01-21-refactor-dead-seams-removal.md)（受け入れ基準「`collectCurrentProviderPrioritySlots()` の inline コピー集約」は未達。実装記録 §未達 参照）
依存: なし（`settingsPipeline.ts` / `generalSettingsPanel.ts` を他 PBI と共有する場合は順序調整）

## ユーザーストーリー

dashboard を拡張する開発者として、A/B 両レイアウトの provider priority 収集を単一ヘルパーに寄せてほしい、なぜなら同一規則（layout b 判定 → B スロット収集 → A フォールバック）が 2 箇所に inline 重複しており、片方への検証追加がもう片方に波及せず挙動が静かに割れるから。

## 背景（現状）

- `collectCurrentProviderPrioritySlots()` は削除済み（2026-10-02 時点で `rg` 0 件。NN21 で `src/dashboard/generalSettings/settingsForm.ts` の死んだ export と import を削除）。
- canonical な収集器は 2 つだけ残る（2026-10-02 に実パス再確認）:
  - A 用: `src/dashboard/generalSettings/settingsForm.ts:28` `collectProviderPrioritySlots()`
  - B 用: `src/dashboard/aiProviderB/priorityListView.ts:38` `collectBProviderPrioritySlots(container)`
- inline 重複は 2 箇所に残る:
  - Copy A（save パス）: `src/dashboard/settingsPipeline.ts:139-193` — `layout` 取得（`:139`）、`layout === 'b'` 分岐（`:140`）、`bList` 取得 + `hasBRow` 判定（`:141-142`）、`collectBProviderPrioritySlots(bList)` try + `collectProviderPrioritySlots()` fallback（`:145,:147`）、B なし時（`:189`）と A 時（`:192`）の `collectProviderPrioritySlots()` 直呼び。計 4 呼び出し点。
  - Copy B（B-view 初期化）: `src/dashboard/panels/staticForm/generalSettingsPanel.ts:212-221` — `try collectProviderPrioritySlots()`（`:215`）+ catch 空配列（`:216`）+ `existingSlots.length === 0` 時の storage fallback（`:218-221`、`currentSettings[AI_PROVIDER_PRIORITY_LIST]`）。
- 既存テスト（変更なしで green を保つ対象）:
  - `src/dashboard/__tests__/settingsPipeline.test.ts:52`（`collectProviderPrioritySlots` の mock）
  - `src/dashboard/generalSettings/__tests__/settingsForm.coverage.test.ts:107-198`（A 収集の conformance）
  - `src/dashboard/aiProviderB/__tests__/priorityListView.test.ts`（B 収集の conformance）
  - `tests/integration/aiProviderLayout.test.ts:59-133`（A/B 同一キー保存の parity）
  - `src/dashboard/__tests__/dashboard-priority.test.ts:29-47`（A 収集の DOM 駆動）

## BDD シナリオ

```gherkin
Scenario: A/B 収集の呼び分けが単一ヘルパーになる
  Given layout b 判定 → B 収集 → A フォールバックの規則が settingsPipeline と generalSettingsPanel に inline 重複している
  When 両呼び出し側を単一ヘルパー経由に寄せる
  Then A/B 判定の inline 分岐が呼び出し側に残らず、保存される ProviderSlot[] が現状と同一である
```

## 実装宣言

- 挙動維持: 保存される `ProviderSlot[]` の内容・順序・空配列条件・B try/catch fallback の優先順位は不変。UI 警告・`validateBContainer`・storage fallback の有無は変えない。
- 提案する所有者: `collectCurrentProviderPrioritySlots()` を A-collector の隣（`settingsForm.ts` 内）に復活させる。ただし layer 違反（`settingsForm.ts` → `aiProviderB/priorityListView.ts` への依存が許容できない場合）は新モジュール `src/dashboard/providerPrioritySlots.ts` に置く。どちらかを実装者が選択する。
- 新ヘルパー以外の live 経路ロジックは変更しない。

## 受け入れ基準

- [x] `src/dashboard/settingsPipeline.ts:139-193` の inline A/B 判定（`layout === 'b'` 分岐 + `bList`/`hasBRow` 判定 + try/catch fallback）が単一ヘルパー呼び出しに置換され、呼び出し側に A/B 判定の重複が残らない
- [x] `src/dashboard/panels/staticForm/generalSettingsPanel.ts:212-221` の inline 収集（`collectProviderPrioritySlots()` try/catch + storage fallback）が同一ヘルパー経由になり、呼び出し側に A/B 判定の重複が残らない
- [x] ヘルパーは B-path（`collectBProviderPrioritySlots`）と A-path（`collectProviderPrioritySlots`）の両分岐を内部に持ち、既存の fallback 優先順位（B try → A fallback、空時は storage）を再現する
- [x] 新ヘルパーに対する parity テストが存在し、A DOM / B container / 空 DOM + storage の 3 系統で旧 inline 実装と同一の `ProviderSlot[]` を返すことを固定する
- [x] `npm run type-check` と変更ディレクトリ配下の vitest が green（既存の上記 5 テスト群を変更なしで通過、またはヘルパー置換に伴う最小限の mock 差し替えのみ）

## テスト戦略

- parity テスト必須（振る舞い追加なしのため新規 spec は parity のみ）: 旧 inline 分岐と新ヘルパーの入出力 parity を固定する。最低 3 系統:
  1. A DOM あり（`collectProviderPrioritySlots()` が非空を返す）
  2. B container あり（`collectBProviderPrioritySlots(container)` が非空を返す / throw 時は A fallback）
  3. 空 DOM + storage あり（B-view 初期化の `existingSlots.length === 0` → storage fallback）
- 既存 conformance は変更なしで green（`settingsForm.coverage.test.ts:107-198`、`priorityListView.test.ts`、`aiProviderLayout.test.ts:59-133`、`dashboard-priority.test.ts:29-47`、`settingsPipeline.test.ts:52` の mock 差し替えはヘルパー名への追従のみ許容）。
- 検証: `npm run type-check` と `src/dashboard/` 配下の vitest。

## 実装内容

1. ヘルパー置き場を確定する（`settingsForm.ts` 内復活か `src/dashboard/providerPrioritySlots.ts` 新設か）。
2. ヘルパー `collectCurrentProviderPrioritySlots()`（仮名・命名は実装者が確定）を実装する。
3. `settingsPipeline.ts:139-193` と `generalSettingsPanel.ts:212-221` の inline 2 コピーをヘルパー呼び出しに置換する。
4. parity テストを追加し、既存 5 テスト群で green を確認する。

## 設計メモ（open design point・実装者が選択）

- **async vs params**: `settingsPipeline.ts:139` の現行は `await settingsRepository.getAll()` で `layout` を async 取得する。一方 `generalSettingsPanel.ts` 側は同期の `currentLayout` / `currentSettings` を既に持つ。ヘルパーの signature を以下どちらにするかは実装者の選択とする:
  - (a) async 版: ヘルパー内部で `settingsRepository.getAll()` を読む（呼び出し側は `await` する。`settingsPipeline` と整合的だが、`generalSettingsPanel` の同期初期化パスに `await` が波及する）。
  - (b) params 版: `collectCurrentProviderPrioritySlots({ layout, bList?, stored? })` のように layout・container・storage snapshot を引数で受け、ヘルパー自体は sync に保つ（呼び出し側の async/sync 差を吸収しやすいが、引数の組み立てが 2 箇所に残る）。
- いずれを選んでも受け入れ基準（inline A/B 判定の重複除去 + parity 固定）は満たすこと。選択と理由を実装記録に 1 行残す。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録（2026-10-02 統合パス）

- 置き場: 新モジュール `src/dashboard/providerPrioritySlots.ts` を選択（`settingsForm.ts` → `aiProviderB/priorityListView.ts` への依存を避けるため）。
- signature: 設計メモ (b) params 版・sync ヘルパー（`{ layout, bList?, stored? }`）。呼び出し側の async（save pipeline）/sync（panel 初期化）差を吸収し、repository 読みを持たず testable に保つ。
- 逸脱 A: A-collector の throw は `collectASafe()` で握りつぶし空配列化する。旧 save パス（非 B 時）は `collectProviderPrioritySlots()` の throw をそのまま伝搬させていたが、B-view 初期化パス（Copy B）は既に try/catch 空配列化しており、ヘルパー統一後は両経路とも空配列 → storage fallback に倒れる。保存内容への実害なし（空時は storage snapshot が使われる）。
- 逸脱 B: `isBPriorityListActive(layout, bList)` を export し、`settingsPipeline.ts` の B-validation ゲート（P1 ブロック・重複警告 UI）に再利用する。収集判定と validation ゲートの二重化を防ぐ目的。純粋な述語で副作用なし。
- 検証: `npx tsc --noEmit` 0 errors、`npm run lint` 0 errors、`npm test` 全 green（1000 passed / 1 skipped、15378 passed / 21 skipped）、`npm run validate` green。
- 残差: `rg collectCurrentProviderPrioritySlots` in `src/` のヒットは新ヘルパー定義・2 呼び出し側・parity テストのみ。旧 inline コピーは 0 件。
