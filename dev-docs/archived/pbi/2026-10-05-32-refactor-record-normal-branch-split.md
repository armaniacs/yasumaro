# PBI: `runNormalBranch` が 8 責務のゴッド関数で、到達不能な分岐と死んだ設定読みを含む

## ユーザーストーリー

記録系の保守担当者として、通常記録経路を責務ごとに分割したい。98 行の 1 関数に変更理由が 8 つ同居し、死んだ設定読み・到達不能分岐・二重 fallback・tail の順序不一致まで含むから。

## 優先度

- 順位: 31/32
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: 記録経路の改修時のみ関わる。NN09 と `recordSession.ts` の経路を共有するため NN09 の後に実行
- 依存: NN09

## 背景（file:line 現状）

すべて `src/popup/recordCurrentPage/recordSession.ts`（`runNormalBranch` は :394-491 の 98 行）:

- 8 責務の同居: 設定読み / コンテンツ取得 + fallback / 統計反映 / trust 更新 / preview 実行 / settlement / 成功 tail / 失敗 tail
- (a) `:412-413` の `_usePreview` は読みだけして未使用（同一設定を `previewFlow.ts:122-123` がもう一度読む = 二重読み）。`recordSession.ts:2-3` の `settingsRepository` / `StorageKeys` import はこの 2 行のみで消費
- (b) `:430-436` の `!contentResponse` 分岐は `src/popup/contentFetchGateway.ts:77-140` の型上到達不能
- (c) force 時の `{content:''}` fallback が `:416-428`（recordSession 側）と `contentFetchGateway.ts:103, :132`（gateway 側）で二重
- (d) catch tail の順序が normal（`:484-490` で button → showError）と force（`:527-531` で showError → button）で逆
- 関連する null ガード / try-catch: `:378`、`:404-490`、`:481`、`:502-531`、`:521`
- 依存テスト: `src/popup/__tests__/main.test.ts:993, :1018`、`recordOrchestrator.test.ts:685`（null 想定）

## BDD受け入れシナリオ

```gherkin
Scenario: 通常記録経路が 4 関数に分割される
  Given runNormalBranch の呼び出し
  When 実行する
  Then fetchContent / applyExtractionStats / finishSuccess / fail の 4 つを経由し、runNormalBranch 自体は約 40 行のオーケストレーションになる

Scenario: 死んだ読みと到達不能分岐が消える
  Given 整理後の recordSession.ts
  When _usePreview と null 分岐を探す
  Then 両者が存在せず、null 想定のテストは gateway の契約テストへ移っている

Scenario: catch tail の順序が統一される
  Given normal 側と force 側の失敗時
  When 表示順を確認する
  Then normal 側の順（button → showError）に統一されている
```

## 受け入れ基準

- [x] `fetchContent(tab, force)` / `applyExtractionStats(resp)` / `finishSuccess(tab, result, statusDiv)` / `fail(error, btn)` の 4 つに分割され、`runNormalBranch` が約 40 行のオーケストレーションになっている
- [x] `:412-413` と import `:2-3` が削除されている（唯一の読み手は PreviewFlow）
- [x] `:430-436` が削除され、null 想定のテスト（`main.test.ts:993, :1018`、`recordOrchestrator.test.ts:685`）が gateway の契約テストへ移っている
- [x] catch tail が normal 側の順に統一されている
- [x] 既存の try/catch と null ガードは分割後の各関数の先頭へ移されている
- [x] NN09 の `recordSession.ts` 変更（経路 B 置換）と競合しない形になっている
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 分割後の各関数のテスト、gateway 契約テストへの移設
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/popup/recordCurrentPage/recordSession.ts`（4 関数に分割。`fetchContent` は spinner 所有 + force 時 throw→空 content 変換を内包。catch tail は `fail()` 経由で normal 側の順に統一。gateway は無変更）、`src/popup/__tests__/main.test.ts`（null 想定 2 件を削除）、`src/popup/__tests__/recordOrchestrator.test.ts`（fetch→null 前提の 1 件を削除）、新規 `src/popup/__tests__/contentFetchGateway.contract.test.ts`（gateway 契約 4 件）
- ゲート: 対象 114 tests green / type-check PASS / lint 0 errors
