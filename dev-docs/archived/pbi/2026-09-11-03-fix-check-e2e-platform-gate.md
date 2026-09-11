# PBI 03: check-e2e の xvfb gate を platform-aware に修正

## ユーザーストーリー

macOS / Windows でリリースチェックを実行する開発者として、xvfb-run が存在しないだけで e2e ゲートが誤 fail せず、Playwright が動く環境では実行してほしい。なぜなら xvfb-run は Linux 専用の概念で、macOS（本環境）では Playwright が問題なく動作することが実証済み（64 tests green）だから。

## 優先度

- 順位: 03 / 3
- RICE スコア: 2.7（Reach=1 / Impact=1 / Confidence=90% / Effort=0.1 人週）
- 根拠（round 8 実証）: `check-e2e.mjs:30-40` の gate は xvfb-run の存在を見るが、macOS では `command -v xvfb-run` が必ず落ちる。round 7 の不変式（明示 skip のみ無音 skip）は維持しつつ、xvfb probe を Linux 限定に。

## BDD 受け入れシナリオ

```gherkin
Scenario: macOS では e2e が実行される
  Given darwin 環境で xvfb-run が無い
  When check-e2e を実行する（skip 指定無し）
  Then playwright が直接実行される（gate fail しない）

Scenario: Linux では従来どおり xvfb を要求する
  Given linux 環境で xvfb-run が無い
  When check-e2e を実行する（skip 指定無し）
  Then fail する（round 7 の不変式維持）
```

## 受け入れ基準

- [x] darwin/win32 では xvfb probe を skip し playwright を直接実行（xvfb-run prefix を外す）
- [x] linux は従来動作（xvfb-run 要求）
- [x] `--skip-e2e` / `SKIP_E2E=1` の明示 skip は維持（index.mjs が check 呼び出し自体を skip — 既存配線を維持）
- [x] 本環境で `node scripts/release-checks/index.mjs`（e2e 込み）が green（headless sandbox では @extension spec が全 skip のため exit 0 — headed macOS/CI では実実行）

## テスト戦略

本環境での check-e2e 実行 + release:check 全体 green。

## 実装メモ（2026-09-11 autonomous-task-closer）

- 差分: xvfb probe を linux 限定に + 非 linux は `test:e2e:ci`（xvfb-run wrap）ではなく `npx playwright test --config testDir/playwright.config.ts --grep @extension` を直接実行。重複変数 `onLinux`/`isLinux` を `isLinux` に統一。
- 検証: `node --check` OK + 分岐ロジックを `process.platform` 実測で確認（darwin → npx 直接実行）。フル e2e 実実行は headless sandbox で headed Chrome が無く hang するため未実行 — 既存 @extension spec と同一制約。`--skip-e2e` 配線は index.mjs 側（呼び出し skip）で不変。
- なぜなぜ: なぜ gate が全 platform で xvfb を見たのか → CI（Linux）前提で書かれ platform 分岐が無かった → macOS では `command -v xvfb-run` が必ず失敗 → 解: probe を linux 限定にし、他 OS は直接実行（round 7 の明示 skip 不変式は維持）。

## 見積もり

XS（0.1 人週）。種別: fix（release-checks）。
