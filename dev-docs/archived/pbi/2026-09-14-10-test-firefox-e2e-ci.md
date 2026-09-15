# PBI: Firefox E2E と CI 整備（プローブ取り込み + smoke 自動化）

## ステータス: ⬜ 未着手（順位2 / RICE 32.0 / 台帳: 2026-09-14-00-backlog-firefox-support.md）

## ステータス: ✅ 完了（2026-09-15 — 実現可能な範囲で完了・拡張レベル自動化は技術的に不可と判断して記録）

**結果サマリ**: CI に `firefox-storage` ジョブを追加（firefox ビルド → VFS プローブ + worker smoke を実 dist 成果物で実行）。**拡張込み（moz-extension origin）の自動化は技術的に不可**と実験で確定したため、PBI 自身の代替計画（プローブのみ CI 化・拡張 smoke は PBI 11 の手動チェックリスト）どおりに完了。実験の記録と再現手順は下記「実験記録」参照。

## 実験記録: Playwright Firefox での拡張 sideload は不可（2026-09-15）

Playwright の Firefox ビルド（Juggler・リリース系ベース）に、シード済みプロファイル経由で未署名拡張を sideload する実験を実施:

- プロファイル準備: `user.js` で `xpinstall.signatures.required=false` + `extensions.autoDisableScopes=0` + `extensions.webextensions.uuids` に固定 UUID を事前シード、拡張を `extensions/<gecko-id>/` に展開
- 結果: **Firefox 起動時に `extensions/` が空にされ、UUID も割り当てられない**（署名強制がリリース系ビルドでロックされており、`xpinstall.signatures.required=false` は無効）→ `moz-extension://` ページが `NS_ERROR_NOT_AVAILABLE` で失敗
- Developer Edition / Nightly なら署名強制を解除できるが、**Playwright は Juggler 非搭載の素の Firefox を駆動できない**ため自動化経路にならない
- 結論: 拡張込みの Firefox E2E 自動化は Playwright では不可。Selenium + geckodriver（`installAddon(xpi, true)` は通常版で動作）が代替だが、Playwright fixtures の書き直しを伴うため将来判断（必要になったら別 PBI）

## ユーザーストーリー

メンテナとして、Firefox ビルドの記録→検索経路が CI で回帰検知される仕組みがほしい。なぜなら Firefox 対応の劣化をユーザー報告前に発見したいから。

## 優先度

- 順位: 2 / 全候補数 3
- RICEスコア: 32.0（Reach=20 / Impact=1 / Confidence=80% / Effort=0.5人日）
- 根拠: 回帰網の確保。**09 に依存**（gecko.id と動く firefox ビルドが前提）。スコアは 11 と僅差だが依存関係によりこの順

## 背景

- VFS プローブ（chromium 対照 + firefox 被検体）は main に実装済みで全 green
- Playwright の拡張機能読み込みは Chromium のみ公式サポート（`testDir/playwright.config.ts` の firefox プロジェクトは `@extension` を除外し file:// 静的テストのみ）
- Firefox の拡張込み E2E は「Developer Edition + `xpinstall.signatures.required=false` の事前シードプロファイル + `launchPersistentContext`」方式が Playwright 資産を活かせる（gecko.id は PBI 09 で導入済み）

## 実装ガイド（実施結果）

1. **CI 追加**: `.github/workflows/tests.yml` に `firefox-storage` ジョブを追加 — `build:firefox` → `npx playwright install --with-deps firefox` → `--project=firefox` で VFS プローブ + worker smoke（実 dist 成果物）を実行、レポートをアーティファクト化
2. **拡張 smoke 自動化は不可と確定**（上記「実験記録」）→ 拡張レベルの検証は PBI 11 の手動チェックリストが担当
3. **プローブの wasm ペア固定の維持**: probe の `copyFileSync` が `@subframe7536/dist/wa-sqlite-async.wasm` を使っていることを回帰で担保（spec 内アサーション済み）
4. **worker smoke の追加**（プローブの補完）: `testDir/e2e/firefox-worker-smoke.spec.ts` — 実 dist の `opfs-worker.js` を INIT（安定パス wasm URL 注入）→ INSERT → SEARCH(FTS5) → STATUS で駆動。テストサーバに `/dist/` 配信（ディレクトリトラバーサル制限付き）を追加

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

- [x] Firefox 拡張 smoke の自動化は技術的に不可と実験で確定・記録（拡張レベルの検証は PBI 11 の手動チェックリストに委譲。将来の Selenium 経路は別 PBI 候補）
- [x] CI に firefox ビルド + プローブ + worker smoke が追加されている（`firefox-storage` ジョブ）
- [x] chromium プロジェクトの既存テストに影響がない

## テスト戦略

- E2E: 本PBIの成果物そのもの（probe + smoke）
- 単体: なし（インフラ整備）

## 見積もり

0.5人日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（TESTING_GUIDE の Firefox セクション）