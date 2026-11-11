# PBI: ログ経路の分散・二重化の一本化

## ユーザーストーリー
開発者として、ログ排出が構造化loggerのseamに一本化されてほしい、なぜなら `console.*` 直書きと `console+addLog` 二重発射の併存はSW終了時の欠損・PII混入・レベル不統一の温床になるから。

## 優先度
- 順位: 3/3 (Round 1)
- RICE: 2.0 (Reach=5 / Impact=1 / Confidence=0.8 / Effort=2)
- 根拠: 全経路の保守性。挙動はログのみで機能不変。lintで再発防止まで含める。
- 依存: なし

## 現状 (file:line付き・要実装時再確認)
- `src/utils/wasmHybridRuntime.ts:97-98` / `:114-115`: `console.warn + addLog` の二重発射 (意図的コメント付きだがseam外)。
- `src/privacy/privacy.ts:231`: `loadPrivacyPolicy().catch(console.error)` 生エラー直結。
- `src/dashboard/panels/diagnostic/issueReportLink.ts:202-205`: `console.error('[BugReport]...', err)` 直書き。
- `src/utils/sensitiveDataMask.ts:202-208`: `consoleSecureError` が `console.error` 直叩きの第3seam。
- `src/utils/logger/api.ts:56-58`: `writeStructuredLog` のcatchが `console.error` に落とす。`:165-173` CRITICAL行がconsoleにJSON全量。

## BDD受け入れシナリオ

```gherkin
Scenario: ログはseam経由で一本化される
  Given 各経路で警告・エラーが発生する
  When ログが出力される
  Then 構造化loggerのseam経由で記録される
  And console直書きの二重発射がない

Scenario: logger自体の失敗が見える
  Given writeStructuredLogが失敗する
  When フォールバックする
  Then 不可視にならず検出可能な形で残る

Scenario: 新規のconsole直書きは検出される
  Given 新たにconsole直書きを追加した
  When lintを実行する
  Then 違反として検出される (既存分はgrandfather台帳化)
```

## 受け入れ基準
- [x] (1) wasmHybridRuntimeの二重発射がseam経由 (`isDevelopment` ガード付き等の整理) になる
- [x] (2) privacy/issueReportの直書きがseam経由になる
- [x] (3) `consoleSecureError` がlogger seamに委譲する (公開名維持の薄いラッパー可)
- [x] (4) `writeStructuredLog` 失敗時が不可視にならない
- [x] (5) console直書き禁止のlintルール追加 + 既存残存分がある場合は台帳化してgate緑
- [x] (6) PII混入がないこと (base64 heuristic等の既存対策を維持)

## テスト戦略
- 単体テスト: 各seam委譲の呼び出し検証 (loggerモック)。
- lintテスト: 新規直書きの検出テスト。
- 回帰: logger・wasmHybrid・privacy系テスト全件実行。

## 見積もり
- S

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され、すべてパスする
- [x] コードレビューが完了している
- [x] 受け入れ基準のすべての項目が満たされている

## 出典
- holistic-code-review 2026-11-11 Round 1 (SoCテーマ2)
