# PBI 12: 命名・コメント・文言の整備（long tail 24 箇所）

## ユーザーストーリー
メンテナーとして、嘘をつくコメント・誤解を招く名前・死んだ文言が整備された状態がほしい、なぜなら次の読み手がコメントを信じて実装を「戻す」リスクを常時抱えるから。

## 変更点の概要
コメント虚偽・誤解を招く命名・文言不整合を個別に整備する。すべて診断面の修正で、実行時挙動は不変。

## 現状と問題
- src/utils/urlWhitelist.ts:134-137（computeUrlsHash が '|' 連結でハッシュでない → 命名を buildUrlsKey へ）
- src/popup/trustPanel.ts:12-13（errorToastTimer のコメントが「要素ごと」を約束するが実装はモジュール単一トークン → コメント修正または WeakMap 化）
- src/background/rateLimiter.ts と src/utils/aiUsageTracker.ts（checkRateLimit 同名競合 → どちらかを rename）
- src/content/contentKernel.ts:78-81（clock 注入を約束するコメント虚偽 → コメント修正）
- src/utils/urlUtils.ts の no-op 置換（置換結果が入力と同値 → 分岐削除）
- src/utils/logger/api.ts:125（logDebug の恒真条件 → 削除）
- src/utils/logger/core.ts の logCritical マジックナンバー（定数化）
- src/background/pipeline/steps/payloadGuard.ts:141-142（サイズ超過メッセージが型エラー用の文言 → 文言修正）
- src/background/pipeline/steps/maintenanceBatchHandler.ts:162-163（"100MB" vs MAX_RESTORE_BASE64_BYTES=150MB（limits.ts:45）→ 文言修正）
- src/background/obsidianClient.ts:195-236（underscore-prefix の public メソッド、テストが呼ぶ → rename）
- src/utils/ublockParser/transform.ts:60-72（FNV コメント虚偽）+ 【...】装飾コメント（削除）+ テストの stale パス
- src/dashboard/settingsForm.ts:206（?? '365' のデッドデフォルト → 削除）
- src/background/handlers/readOnlyHandler.ts の同一行詰め（formatting）
- src/background/recordRequestBuilder.ts の改行（formatting）
- src/background/handlers/tabEventHandlers.ts の optional port 条件分岐（可読性）
- src/utils/storage/encryptionSession.ts:162（isMasterPasswordRequired の module-var 変異にコメント追加）
- src/utils/settingsMigration.ts の MigrateSettingsOptions 並行定義（1 定義へ）
- src/utils/computeLimits.ts:53-56（「paginates with offset」コメント虚偽、実装は keyset cursor → コメント修正）
- scripts/check-docs-chars.mjs:85-94（cp932.has は throw しない死んだ catch + 古い TextDecoder コメント → 削除）
- eslint/rules/no-tautology-expect.mjs:8（実在しないマッチャー名 toBeStrictEqual → 削除）
- entrypoints/permissions/main.ts:4-5（privacy.js を副作用 import と名前付き import で二重 → 1 行へ）
- src/popup/statusChecker.ts:115（SKIPPED_PROTOCOLS が SSOT と subset 関係をコメントで明記）
- src/utils/storage/storagePort.ts の redact 冗長ループ（簡素化）
- src/utils/tagClusterLoading.ts:116（`${step.number}/4` のステップ総数ハードコード → LOADING_STEP_KEYS.length へ）

## 変更の理由
[可読性] すべて診断面。実行時挙動は不変（文言・コメント・命名のみ）。

## BDD受け入れシナリオ
Scenario: コメント修正後の実装一致
  Given keyset cursor 実装の fetchPeriodRows
  When computeLimits のコメントを修正する
  Then コメントは実装と一致し、実行時挙動は変わらない

Scenario: rename 後のテスト整合
  Given underscore-prefix の public メソッド
  When rename する
  Then テスト呼び出しも同時に更新され、全テストが通過する

## 見積もり
2 pt（RICE: 24 = Reach 24 × Impact 1 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [ ] 全箇所で診断面の修正が完了し、実行時挙動が不変であることを確認
- [ ] npm run validate 通過
- [ ] node scripts/check-docs-chars.mjs 通過（コメント変更時）
