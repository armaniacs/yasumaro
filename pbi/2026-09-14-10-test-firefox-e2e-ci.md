# PBI: Firefox E2E と CI 整備（プローブ取り込み + smoke 自動化）

## ステータス: ⬜ 未着手（順位2 / RICE 32.0 / 台帳: 2026-09-14-00-backlog-firefox-support.md）

## ユーザーストーリー

メンテナとして、Firefox ビルドの記録→検索経路が CI で回帰検知される仕組みがほしい。なぜなら Firefox 対応の劣化をユーザー報告前に発見したいから。

## 優先度

- 順位: 2 / 全候補数 3
- RICEスコア: 32.0（Reach=20 / Impact=1 / Confidence=80% / Effort=0.5人日）
- 根拠: 回帰網の確保。**09 に依存**（gecko.id と動く firefox ビルドが前提）+ `0914b` ブランチのプローブ取り込み。スコアは 11 と僅差だが依存関係によりこの順

## 背景

- VFS プローブ（chromium 対照 + firefox 被検体）は `0914b` ブランチに実装済みで全 green — **未マージ**
- Playwright の拡張機能読み込みは Chromium のみ公式サポート（`testDir/playwright.config.ts` の firefox プロジェクトは `@extension` を除外し file:// 静的テストのみ）
- Firefox の拡張込み E2E は「Developer Edition + `xpinstall.signatures.required=false` の事前シードプロファイル + `launchPersistentContext`」方式が Playwright 資産を活かせる（gecko.id は PBI 09 で導入済み）

## 実装ガイド

1. **`0914b` ブランチの取り込み**: `testDir/e2e/firefox-opfs-probe.spec.ts` + `testDir/e2e/test-pages/probe/`（probe Worker / probe.html）+ `server.mjs` 修正（クエリ文字列 404 バグ・`.wasm` MIME）を main へマージ
2. **Firefox 拡張 smoke の新設**: `testDir/e2e/firefox-smoke.spec.ts` — 事前シードプロファイルで firefox（Developer Edition）を `launchPersistentContext` し、popup で同意 → 記録 → options の検索 1 件を検証。拡張内部状態は UI と `chrome.storage` 経由で観測（イベントページは直接観測不可）
3. **CI 追加**: `.github/workflows/tests.yml` に firefox ビルド + プローブ実行ジョブを追加（`npx playwright install firefox` は既定で入る）。smoke は Developer Edition 二進が CI で入手できる場合のみ（できない場合はプローブのみ CI 化し smoke は手動手順書化）
4. **プローブの wasm ペア固定の維持**: probe の `copyFileSync` が `@subframe7536/dist/wa-sqlite-async.wasm` を使っていることを回帰で担保（spec 内アサーション済み）

## BDD受け入れシナリオ

```gherkin
Scenario: VFS プローブが firefox プロジェクトで回帰検知される
  Given main ブランチにプローブ spec が取り込まれている
  When  make test-all を実行する
  Then  firefox プロジェクトで wa-sqlite OPFS/IDB プローブが green になる

Scenario: 拡張込み smoke が Firefox で記録→検索を検証する
  Given 事前シードプロファイル用意済みの Developer Edition がある
  When  firefox-smoke.spec.ts を実行する
  Then  同意→記録→検索の一連が green になる
```

## 受け入れ基準

- [ ] `0914b` のプローブが main に取り込まれ、`make test-all` の firefox プロジェクトで実行される
- [ ] Firefox 拡張 smoke（記録→検索）が追加されている（CI 実行可否の判断も記録）
- [ ] CI に firefox ビルド + プローブが追加されている
- [ ] chromium プロジェクトの既存テストに影響がない

## テスト戦略

- E2E: 本PBIの成果物そのもの（probe + smoke）
- 単体: なし（インフラ整備）

## 見積もり

0.5人日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（TESTING_GUIDE の Firefox セクション）
