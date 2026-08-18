# PBI: 既存ESLintエラーを解消しCIにlintを組み込む

## ユーザーストーリー
開発者として、`npm run lint` が既存コードに対してクリーンに通り、CI（`npm run validate` およびGitHub Actions）にlintが組み込まれている状態にしたい。なぜなら、現状lintはCI/validateから外れており、新規コードのlint違反がマージ後まで検出されず、既存コードには83件のエラーが蓄積しているから。

## ビジネス価値
- 未使用変数・importの蓄積を防ぎ、コードの可読性を維持する
- CIでlint違反を早期検出し、レビュー負荷を下げる
- `npm run lint` が「実際に使えるコマンド」として機能する

## 背景（2026-08-18 調査済み）
`npm run lint`（`eslint .`）を実行すると91件の問題（83エラー、8警告）が検出される。内訳の大半は `@typescript-eslint/no-unused-vars`（未使用のimport/変数/引数）で、一部`local/require-response-size-limit`（レスポンスサイズ上限チェック未実装、2箇所）も含まれる。

対象ファイル（エラー確認済み、一部抜粋）:
- `src/offscreen/opfsWorker.ts`, `src/offscreen/opfsWorker/searchHandlers.ts`, `src/offscreen/opfsWorker/types.ts`
- `src/offscreen/schema.ts`, `src/offscreen/sqliteEngineContext/idbEngineLifecycle.ts`
- `src/popup/errorUtils.ts`（未使用のエラー判定関数群）
- `src/utils/contentExtractor/index.ts`, `src/utils/logger/criticalAlertSink.ts`
- `src/utils/obsidianConfigBuilder.ts`, `src/utils/obsidianConfigValidator.ts`（要サイズ上限チェック）
- `src/utils/promptSanitizer.ts`, `src/utils/settingsExportImport.ts`
- `src/utils/trustDb/trancoUpdater.ts`（要サイズ上限チェック）, `src/utils/trustDb/trustDb.ts`

これらは直近のリファクタリング（sqliteEngineContext分割、trustDb分解等）で意図的に整理された関数群の一部が未使用のまま残った可能性が高い。

## 受け入れ基準
- [ ] `npm run lint` がエラー0件で終了する
- [ ] `local/require-response-size-limit` の2箇所（`obsidianConfigValidator.ts:144`, `trancoUpdater.ts:147`）にサイズ上限チェックが実装される、または意図的に未実装である理由がコードコメントで明記される
- [ ] `package.json` の `validate` スクリプトに `npm run lint` が追加される
- [ ] `.github/workflows/ci.yml` の validate ジョブに lint ステップが追加される（既存の `validate` スクリプト経由でも可）
- [ ] 既存テストがすべてパスする

## 実装アプローチ
1. `npm run lint` の出力を精査し、各未使用変数が「本当に不要（削除可）」か「将来使う予定で残している（`_`プレフィックスを付ける、または実際に使用する）」かを1件ずつ判断する
2. `local/require-response-size-limit` の2箇所は実際のセキュリティ観点（レスポンスサイズ制限がないとメモリ枯渇DoSのリスク）から実装を検討する
3. 全エラー解消後、`validate`スクリプトとCIワークフローにlintを追加する

## 見積もり
3pt

## 技術的考慮事項
- 未使用変数の削除は基本的に安全な機械的作業だが、意図的に残されたAPI（将来の拡張用エクスポート等）でないか個別確認が必要
- `require-response-size-limit` はカスタムESLintルール（`local/`プレフィックス）。プロジェクト独自のセキュリティルールなので実装が必須の可能性が高い

## Definition of Done
- [ ] `npm run lint` エラー0件
- [ ] `npm run validate` にlintが含まれる
- [ ] CI設定にlintが含まれる
- [ ] 既存テストパス
- [ ] コードレビュー完了
