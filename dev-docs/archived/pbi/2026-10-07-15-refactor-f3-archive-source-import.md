# PBI: f3-archive bench を importFromSource で production 派生にする

## ユーザーストーリー

bench の保守担当者として、「実バッチ INSERT パターンを計測」と宣言する bench が production 変更を追跡してほしい。f3 が archive-create pass を手写経していて、batch size や scope 節の production 変更が bench に伝播しないから。

## 優先度

- 順位: 15/17
- RICE: 2.0（R2 / I1 / C1.0 / E1）
- 根拠: 計測対象の invariant が静かに drift する false confidence。importFromSource seam は既存（c5/c6 が使用）
- 依存: なし

## 背景（file:line 現状）

- 手写経: `bench/micro/f3-archive.bench.mjs:25`（`INSERT_BATCH = 5000`）/ `:27-30`（手書き DDL）/ `:53-76`（archivePass カーソルループ）
- production: `src/offscreen/opfsWorker/archiveCreateHandlers.ts:48`（`ARCHIVE_INSERT_BATCH = 5000`）/ `:170-194`（同一ループ・`ARCHIVE_INSERT_COLUMN_NAMES` / `buildArchiveInsertParams`）
- 既存 seam: `bench/harness/bundle.mjs:24-54` の `importFromSource`（c5/c6 が production モジュール読み込みに使用）
- 影響: production が batch size / scope 節 / 列射影を変えても bench は旧パターンを計測し続ける

## BDD受け入れシナリオ

```gherkin
Scenario: bench が production の batch 定数を消費する
  Given importFromSource で archiveCreateHandlers を読む
  When f3 が batch INSERT を計測する
  Then INSERT_BATCH が production の ARCHIVE_INSERT_BATCH と一致する

Scenario: bench の計測ループ自体は維持する
  Given archivePass が計測対象の本体
  When production 派生に寄せる
  Then sqlite-wasm エンジン起動と計測構造は bench 側に残る
```

## 受け入れ基準

- [x] `ARCHIVE_INSERT_BATCH`（必要なら列名定数）を importFromSource で取り込む
- [x] 手書き `INSERT_BATCH = 5000` を production 派生に置き換える
- [x] DDL はローカル維持（エンジン差分）し、列リストは可能なら production 定数から派生
- [x] bench スモーク（`bench/__tests__/smoke.test.ts` 系・実在する smoke に追従）が green
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- smoke: 実在する bench smoke テストが pin。bench 計測自体は `@bench` 領域で `make clean test` の対象外
- 配置: `bench/micro/__tests__/`（実在配置に追従）

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [x] 手動確認: bench:micro の f3 実行（計測値の形が崩れない）を報告に残す

## 実装記録

- 変更ファイル: `bench/micro/f3-archive.bench.mjs`（importFromSource 経由の production import + drift guard）/ `src/offscreen/opfsWorker/archiveCreateHandlers.ts`（ARCHIVE_INSERT_BATCH を export）
- ゲート: micro f3 quick green（scaling 0.90）/ bench vitest 101 tests / type-check PASS / lint PASS / validate PASS
