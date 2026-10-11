# PBI: friction-metrics の Markdown export テストのハングを分類・解消する

- 種別: investigate
- RICE: 0.7（R2 × I1 × C0.5 / E1.5）
- 依存: なし
- バッチ: usability-followup
- 台帳: `pbi/2026-10-11-00-backlog-usability-followup.md`
- 出所: headed E2E 失敗（2026-10-11 ユーザー実行、`task-friction-metrics` の exporting Markdown が fixture setup timeout＋9.1分）

## ユーザーストーリー

E2E 担当者として、friction 計測がハングするのか負荷 flake なのかを確定させたい。
なぜなら真のハングなら E2E 全体を止める実害があり、flake なら再実行手順の明確化で済むから。

## 優先度

- 順位: 2 / 2
- RICEスコア: 0.7（Reach=2 / Impact=1 / Confidence=0.5 / Effort=1.5）
- 根拠: 単発観測で原因不明（C 0.5）。分類のための単独再実行＋診断が必要（E 1.5）。flake 確定なら即閉じる。

## 背景（現状・証拠）

- 失敗形態: `Test timeout of 60000ms exceeded while setting up "context"`（fixture の `launchExtensionContext` が SW 登録を 60s 待ってタイムアウト）＋当該テスト自体が 9.1 分計測。
- 同 run は 15.8 分の並列全量実行で、bench・parity 等の重量テストも同時に timeout している（NN08 中継化の検証記録に記載）。負荷 flake の疑いが濃い。
- NN08 差分は fixture 起動経路・SW 登録・friction 計測に触れていない（無関係を確認済み）。
- 2回目の run（6.4分）では同テストは失敗していない（flake 示唆。ただし確証なし）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 単独再実行で通る
  Given 対象 spec のみを単独実行する
  When 3 回繰り返す
  Then すべて green になる（flake 確定→手順明記で閉じる）

Scenario: 単独でも再現する
  Given 対象 spec のみを単独実行する
  When 実行する
  Then fixture setup timeout が再現する（真のハング→原因を特定し fix PBI を起票する）
```

## 受け入れ基準

- [ ] 単独再実行（3回）の結果を記録し、flake／真のハングを裁定する
- [ ] flake の場合: 再実行手順（単独・`--workers` 絞り等）を PBI に記録して閉じる
- [ ] 真のハングの場合: 原因（SW 登録 stall・port 競合等）を特定し、後続 fix PBI を起票する（本 PBI は investigate として裁定記録で閉じる）
- [ ] `npm run validate` が green

## テスト戦略

- E2E: `npx playwright test --config testDir/playwright.config.ts testDir/e2e/usability/task-friction-metrics.spec.ts` を単独×3（headed 必須）。
- 真のハング再現時は SW コンソール・`waitForServiceWorker` のポーリング状況を採取する。

## 見積もり

1.5 SP（単独再実行・分類 0.5＋診断／fix 起票 1.0）

## 技術的考慮事項

- 全量並列実行時は `--workers` を絞る（vitest 設定の所見と同様にメモリ・CPU 競合が timeout を誘発する）。
- NN16（同系統 export テストのロケール修正）とは独立。両方 green になるまで E2E 全体 green とは言わない。

## 実装者向け注記

### 実装手順

1. 単独再実行×3で分類する
2. flake→手順記録で閉じる／hang→原因特定＋fix 起票
3. `npm run validate`

### 落とし穴

- 全量実行の結果だけで hang と断定しない（必ず単独で再現させる）
- テストで実時間待ちを入れない

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が green
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 状態記録（2026-10-11 autonomous-task-closer）

本 PBI の第一手順（単独再実行×3による分類）は headed 必須のため、当環境では
着手不可。コード変更を伴う作業も発生していないため live のまま残置する。
headed 実行手順: `npx playwright test --config testDir/playwright.config.ts testDir/e2e/usability/task-friction-metrics.spec.ts` を単独で3回。
