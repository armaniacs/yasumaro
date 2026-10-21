# PBI: migration allowlist への未収載キー追加と URL 許可オプトイン reader の意図明文化

## ユーザーストーリー

拡張機能を日々使っているユーザーとして、設定 migration が再実行された後も AI 使用量カウンタ・sqlite エンジン移行フラグ・URL 許可のオプトイン状態が黙ってリセットされないことがほしい、なぜなら allowlist（TOP_LEVEL_ONLY_KEYS）未収載のキーは migration で top-level から削除され、reader は undefined を「月が変わった」「移行前」と同一視して黙って壊れるから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴なし（保護的追加のみ。挙動は「消えなくなる」方向）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 1・9。なぜなぜ分析 /tmp/whywhy/outofscope-A.md（15 分析）・outofscope-B.md（7 分析）2026-10-21

## 実装内容（owner 判断済み 2026-10-21）

1. （対象外 1a）TOP_LEVEL_ONLY_KEYS に AI 使用量カウンタの直接読み書き 6 キーを追加する。AI_RATE_LIMIT_MAX / AI_RATE_LIMIT_MAX_MONTHLY_TOKENS は readNumberSetting の blob tier fallback が生きているため含めない
2. （対象外 1b）OPFS / IDB / YASUMARO 移行フラグ 10 キーを個別に追加する。StorageKeys の分類型（設定 / ランタイム状態）分割は将来 PBI 候補として記録する
3. （対象外 9）'allow_all_urls_opt_in' を allowlist に追加する。あわせて popup の contentFetchGateway にある legacy 生リテラル fallback を削除し、reader-only である意図（writer なし・banner 経路が requestAllUrls を直接呼ぶ非対称）をコメントで明文化する。writer 追加と Level 2 ゲート削除は不採用

## 受け入れ基準（BDD）

```gherkin
Scenario: migration 再実行後もカウンタが保持される
  Given AI 使用量カウンタが top-level に存在する
  When 設定 migration が再実行される
  Then カウンタキーは top-level から削除されない
    And reader は同じ値を読み続ける

Scenario: 移行フラグが migration で消えない
  Given sqlite エンジンの移行フラグが top-level に存在する
  When 設定 migration が再実行される
  Then フラグは top-level に残る

Scenario: オプトインフラグが migration で消えない
  Given 'allow_all_urls_opt_in' が top-level に存在する
  When 設定 migration が再実行される
  Then フラグは top-level に残る
    And reader は SSOT キーだけを読む（legacy fallback なし）
```

## テスト戦略

- settingsMigration の completion-state 契約テストと同型の「allowlist 収載キーは移行されない」テストを追加する
- contentFetchGateway の既存テスト（contract / permissionLadder / main）で pin された現行挙動を fixture として先に確認する

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 1・9・処理記録）
- dev-docs/archived/pbi/2026-10-20-04-refactor-constant-ssot-consolidation.md（allowlist の既存構造）

## 実装記録（2026-10-21）

- allowlist に 17 キーを追加: AI 使用量カウンタ 6 キー（AI_USAGE_MONTH / TOKENS_SENT / TOKENS_RECEIVED / REQUEST_COUNT / AI_RATE_LIMIT_WINDOW_START / AI_RATE_LIMIT_COUNT。AI_RATE_LIMIT_MAX / MAX_MONTHLY_TOKENS は blob tier が生きているため含めず、テストで migratable=true を pin）、移行フラグ 10 キー（YASUMARO_MIGRATION_STATUS / PROGRESS / RETRY_COUNT、OPFS_FALLBACK_MODE、OPFS_MIGRATION_V2_DONE / LAST_ATTEMPTED_AT / COMPLETED_AT / RECORD_COUNT、IDB_MIGRATION_V2_DONE / IDB_MIGRATION_BACKUP）、ALLOW_ALL_URLS_OPT_IN
- contentFetchGateway の legacy 生リテラル fallback（'allowAllUrlsOptIn' 二度読み）を削除し、reader-only の意図を英語コメントで明文化
- テスト: settingsMigration-completion-state.test.ts に「allowlist 収載 17 キーは移行されない」分類テスト + 実 seam happy-path pin、contentFetchGateway.contract.test.ts に「SSOT キーだけを読む」pin を追加
- 検証: 対象 136 tests 全 green、フルスイート 1112 ファイル / 16563 tests 全 green、type-check 通過、eslint 通過、validate:fast green
