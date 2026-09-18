# PBI: logger barrel 移行の完了（refactor）

優先度: 台帳 RICE 3.2（Reach 8 / Impact 1 / Confidence 1.0 / Effort 2.5pt）
backlog: [2026-09-18-00-backlog-archloop-0918.md](2026-09-18-00-backlog-archloop-0918.md)（台帳、候補 C3）
依存: なし

## ユーザーストーリー

任意のモジュールにログを足す開発者として、logger を1つの正しい import 先から使えるようにしてほしい、なぜなら Wave 4（PBI 2026-09-05-03）で barrel 分割と lint 反転まで完了したのに、呼び出し側133箇所が barrel 経由のまま残っており、eslint warn が常時発火して「どこから import するか」の判断コストが毎回発生しているから。

## 背景（現状と課題）

- LAYERS.md Wave 4 の明示的残作業: 「約120箇所の呼び出し側の直接 import 移行（別 PBI 化を推奨）」
- 実測: production 94 import（93ファイル）+ test 39 import。直接 import は6のみ
- barrel の再export分布（実測）: `LogType` 47 + `ErrorCode` 38 → `logger/types.js`、`logError` 13 / `logWarn` 10 / `logInfo` 4 / `logDebug` 4 / `logCritical` 1 → `logger/api.js`、`addLog` 1 → `logger/core.js`
- storage 系の dynamic import 3箇所（savedUrlRepository・encryptionSession・SettingsRepository）が `await import('../logger.js')` — 循環回避を意図するが、logger/* は storage/* を import しない（実測）ため静的直参照に置換可能

対応方針:

1. 全呼び出しを名前ごとに対応する直接 import へ機械移行（1ファイルが types と api の両方を必要とする場合は2本の import）
2. storage 系3箇所の dynamic import も静的直参照化
3. 完了後（barrel importer 0 を grep で確認）`src/utils/logger.ts` を削除
4. `eslint.config.js` の barrel 関連設定（`src/utils/logger.ts` の ignores・no-restricted-imports の `**/logger.js` group・logger.ts 特例ブロック）を除去
5. `LAYERS.md` の Wave 4 残作業記載を更新（完了を記録）

## BDD受け入れシナリオ

```gherkin
Scenario: barrel 経由の import が消滅する
  Given 全呼び出しを直接 import に移行した状態
  When grep で `utils/logger.js`（または `../logger.js`・`./logger.js`）を検索する
  then src 配下で 0 件になる（tests を含む）

Scenario: ログ出力の挙動が不変である
  Given 移行後の任意の呼び出し経路
  When logError / logWarn / addLog を呼ぶ
  Then 構造化ログの内容・ソース・エラーコードは移行前と同一である
```

## 受け入れ基準

- [x] production 94 import が直接 import に移行されている
- [x] test 39 import も移行されている（vi.mock パスを含む）
- [x] storage 系3箇所の dynamic import が静的直参照化されている
- [x] `src/utils/logger.ts` が削除されている
- [x] `eslint.config.js` から logger barrel 関連の特例・warn ルールが除去されている
- [x] `npm run type-check` / `npm run lint`（新規 error 0）/ `npm test` が green

## テスト戦略

- 機械移行のため既存テスト全体で担保（この PBI はフルスイート検証を前提とする統合側作業を含む）
- `vi.mock('../utils/logger.js')` 形のテストは `vi.mock('../utils/logger/api.js')` 等への移行が必要 — モック対象モジュール名の機械置換漏れに注意

## 見積もり

2.5pt（133 import 移行 + barrel 削除 + eslint 設定 + LAYERS.md 更新。機械的だが量が最大）。

## 実装ガイド

- 移行マッピング: `LogType` / `ErrorCode` / `LogEntry` / `ErrorCodeValues` / `ErrorCodePattern` / `LogTypeValues` → `logger/types.js`、`logInfo` / `logWarn` / `logError` / `logDebug` / `logSanitize` / `logCritical` / `extractSourceFromImportMetaUrl` → `logger/api.js`、`addLog` / `getLogs` / `clearLogs` / `flushLogs` / `isDevelopment` / `getPendingLogCount` / `clearPendingLogs` → `logger/core.js`
- テストの `vi.mock` 対象も同じマッピングで移行する（mock したい名前が複数 submodule に跨る場合は複数 mock）
- `logWarn(message, details, undefined, source)` のように errorCode を undefined 渡しする既存呼び出しに手を入れないこと（import 移行のみ）
- git mv による pbi アーカイブは統合側が行う
