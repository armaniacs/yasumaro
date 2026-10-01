# PBI: replay 書き込みの SavePhase seam 移設

## ユーザーストーリー

保守担当の開発者として、replay 時の `dedupe: true` 差し替えを SavePhase の seam 内に移したい、なぜなら orchestrator が prototype hack で協調者の隠し option を知る必要があり、書込可視性の方針に家がないから。

## 優先度

- 順位: 6 / 7（2026-10-01 arch-delivery-loop ラウンド。全体像は [00-backlog-archloop-1001](2026-10-01-00-backlog-1001.md)）
- RICEスコア: 6.4（Reach=3 / Impact=2 / Confidence=0.8 / Effort=0.75）
- 根拠: 最後の手書き retry 知識を gate-order 派生則の家に移す。依存なし。

## 背景

- `src/background/pipeline/RecordingOrchestrator.ts:159-185`（`Object.assign(Object.create(this.obsidian))` による `dedupe` 注入）、`src/background/pipeline/contextBuilder.ts:49-75`（`createRetryContext`）、`src/background/pipeline/savePhase.ts:97-152`（`SAVE_FAN_OUT` table＋`retryProjection()`）。方針: 初回書込は無条件、replay は dedupe（PBI 2026-09-25-13）。

## BDD受け入れシナリオ

```gherkin
Scenario: replay が冪等に書かれる
  Given retry 用 context
  When SavePhase の replay 経路で保存する
  Then 協調者には冪等書込として到達する

Scenario: 通常書込は無条件のまま
  Given 通常 context
  When SavePhase の通常経路で保存する
  Then dedupe なしで書かれる
```

## 受け入れ基準

- [x] `Object.create` による prototype hack を除去する
- [x] replay 区別を SavePhase の seam 内に置く（`saveReplay(context, deps)` または retry-mode flag のいずれか 1 方式）（採用: retry-mode flag。`createRetryContext` が `replayWrite: true` を付け、SavePhase seam の saveObsidian sink が消費して dedupe 付き 3 引数で append する）
- [x] orchestrator は mutex＋context 生成に専念し順序・継続判断を持たない（`Object.create`/`dedupe` の実装は残存ゼロ）
- [x] `createRetryContext` は context builder として残す

## テスト戦略

- 単体: fake 協調者で append 引数を記録し、通常/ replay の書込差を SavePhase seam 越しに検証（13-step 全走なし）→ `src/background/pipeline/__tests__/savePhaseReplay.test.ts`（新規・BDD 2 シナリオ + マーカー pin + retryObsidianWrite 経由の dedupe 検証）
- 既存: replay 冪等テストは不変で通ること（noteSectionEditor・retryObsidianWrite-result は無変更で通過）
- 統合: `npm run validate` が通ること

## 見積もり

0.75 SP（要チームでの見積もり）

## 実装記録（2026-10-01）

- `PipelineInput` に `replayWrite?: boolean`（replay 書込マーカー）。`createRetryContext` が `replayWrite: true` を設定（context builder として残留）
- `saveToObsidianStep` が flag を消費: `replayWrite === true` なら `{ dedupe: true }` 付き 3 引数、通常は従来どおり 2 引数（通常経路の呼び出しシグネチャ完全不変）
- `RecordingOrchestrator`: prototype hack（`Object.assign(Object.create(this.obsidian), ...)`）と方針コメントを削除。`retryObsidianWrite` は `this.obsidian` を直接渡す
- 検証: focused vitest 7 ファイル / 48 tests passed、type-check green

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test / build が通る
- [x] コードレビュー完了
