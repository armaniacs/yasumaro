# PBI: E2E シード済みパネル fixture の導入

## ユーザーストーリー

E2E テストの保守者として、パネル表示テストごとに繰り返される 4 ステップの準備手順を seeded fixture に集約したい。各 spec が同じ準備を複製していると、シード手順の変更時に複数ファイルへ同じ修正を波及させることになり、壊れやすいからだ。

## 優先度

- 種別: test
- 順位: 17 / 20
- RICEスコア: 4.0（Reach=5 / Impact=1 / Confidence=0.8 / Effort=1.0）
- 根拠: 重複は 2 spec 以上にまたがり 8 箇所の waitFor が同一パターン。fixture 化で変更点が 1 箇所に集まる。
- 依存: rank-11 e2e launch context 統一の後。launch 手順が固まってから fixture に組み込む。

## 背景

- 準備の 4 ステップが spec ごとに複製されている: `openOptionsPage` → `createDashboardSqliteClient` → `migrationSettled` → `seedRows` → パネル click。
- `waitFor({state:'visible', timeout:15000})` の同一パターンが 8 箇所重複:
  - `testDir/e2e/history-panel-ui.spec.ts:50,65,93,119`
  - `testDir/e2e/regenerate-summary.spec.ts:240,329,369,421`
- 修正方針: `seededHistoryPanel` fixture が上記 4 ステップとパネル表示待ちをカプセル化し、spec 側は fixture を受けるだけにする。

## BDD受け入れシナリオ

```gherkin
Scenario: fixture を使う spec は準備手順を書かない
  Given seededHistoryPanel fixture が 4 ステップの準備とパネル表示待ちを提供している
  When history-panel-ui.spec.ts と regenerate-summary.spec.ts を fixture 利用に書き換える
  Then spec 内に openOptionsPage から seedRows までの複製が残らない
  And 全 E2E テストが成功する

Scenario: パネルが visible になるまで fixture 内で待つ
  Given fixture が seedRows 完了後にパネル click を行う
  When fixture がパネルの表示を待つ
  Then waitFor({state:'visible'}) は fixture 内の 1 箇所だけで定義される
  And spec 側には timeout:15000 の重複が残らない
```

## 受け入れ基準

- [x] `seededHistoryPanel` fixture が openOptionsPage → createDashboardSqliteClient → migrationSettled → seedRows → パネル click をカプセル化している。
- [x] `history-panel-ui.spec.ts` と `regenerate-summary.spec.ts` が fixture を利用し、4 ステップの複製が消えている。
- [x] `waitFor({state:'visible', timeout:15000})` の重複 8 箇所が fixture 内の単一定義に置き換わっている。
- [x] E2E テストが実時間待ちの追加なしに成功する（`testDir/waitPolicy.ts` のポリシーに従う）。
- [x] fixture の導入により spec の観測対象（アサーション内容）が変わっていない。
- [x] `npx playwright test` が成功している。

## テスト戦略

### E2Eテスト

- 既存 spec のアサーションはそのままに、準備部分だけ fixture へ置き換える。
- fixture 利用後もテスト件数・結果が変わらないことを確認する。

### 安定性検証

- `npx playwright test <対象> --repeat-each=10 --retries=0 --workers=4` を回し、全 run が通ることを確認する。

## 見積もり

**1.0 SP**

fixture 1 本の新設と 2 spec の書き換え。launch context が統一済みであることが前提。

## Definition of Done

- [x] seededHistoryPanel fixture が実装されている。
- [x] 対象 2 spec が fixture 利用に移行している。
- [x] 重複していた waitFor が fixture 内に集約されている。
- [x] E2E 全テストが成功している。
- [x] repeat-each 検証が通っている。
- [x] rank-11 との統合順序が確定している。

## 実装記録

**2026-10-03 完了。**

- `testDir/e2e/fixtures/seeded-history-panel.fixture.ts` を新設。4 ステップの準備 + パネル click + entry-visible 待ちを `seededHistoryPanel` fixture にカプセル化
- `history-panel-ui.spec.ts` / `regenerate-summary.spec.ts` を fixture 利用に移行。両 spec の `waitFor` は 0 件になり、visible 待ちは fixture 内 1 箇所（`ENTRY_VISIBLE_TIMEOUT_MS`）に集約
- spec 固有の差分（rows / rowText / seedConsent / onPage / beforeSeed）は `panelSeedParams` オブジェクトで明示的に保持（暗黙の統一をしない）
- repeat-each 検証: `npx playwright test <対象 2 spec> --repeat-each=10 --retries=0 --workers=4` で全 run green（実装エージェント報告 + 統合検証で再実行確認）
- ゲート（2026-10-03）: `tsc --noEmit` 0 errors / `vitest` 15,594 passed / `npm run validate` PASS
- 逸脱: なし
