# PBI: Logger の dual-module 正規化

## ユーザーストーリー
開発者として、`logger.ts`（バレル）と `logger/`（実装ディレクトリ）の2つのモジュールパスが存在する状態を整理したい。なぜなら、~120箇所の呼び出し元が logger.ts をインポートしているが、logger/* が実装詳細であることが明示されていないため、新規コードがどちらをインポートすべきか判断に迷うから。

## ビジネス価値
- logger.ts が stable な public API として明示される
- logger/* が実装詳細であることが明確になる
- 新規コードのインポートパスが統一される

## BDD受け入れシナリオ

```gherkin
Scenario: 公開 API の明確化
  Given logger.ts が stable な public API として定義されている
  When 開発者が new logger を追加する
  Then logger.ts からインポートする
  And logger/core.ts からインポートしない

Scenario: 実装変更の局所化
  Given logger/core.ts の実装が変更される
  When 呼び出し元に影響を与えない場合
  Then logger.ts の公開 API が維持される
  And 呼び出し元の変更が不要になる

Scenario: lint ルールによる強制
  Given logger/* への直接インポートが禁止されている
  When 開発者が logger/core.ts をインポートしようとする
  Then lint エラーが発生する
```

## 受け入れ基準
- [ ] logger.ts が stable な public API として JSDoc で明記されている
- [ ] logger/* が実装詳細として JSDoc で明記されている
- [ ] ESLint ルールで logger/* への直接インポートが禁止されている（オプション）
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- logger の公開 API が正しく動作することを検証

### 単体テスト
- 既存の logger テストがパスすることを確認

## 実装アプローチ
- **Outside-In**: JSDoc を追加し、lint ルールを設定
- **Red-Green-Refactor**: lint エラーが発生する場合のみ修正

## 見積もり
1ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: 変化なし
- リスク: 低（ドキュメントとlintルールの追加のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# logger/* への直接インポートを確認
grep -rn "from.*logger/core\|from.*logger/api\|from.*logger/types\|from.*logger/buffer\|from.*logger/sanitize\|from.*logger/storageAdapter\|from.*logger/flushScheduler\|from.*logger/criticalAlertSink" src/ --include="*.ts" | grep -v __tests__ | head -20
```

### 実装手順
1. logger.ts に stable な public API としての JSDoc を追加
2. logger/* の各ファイルに internal としての JSDoc を追加
3. （オプション）ESLint ルールで logger/* への直接インポートを禁止
4. 既存の logger/* へのインポートを logger.ts に変更

### 落とし穴
- logger/core.ts は内部モジュール（buffer, sanitize, storageAdapter, flushScheduler）をインポートしている。これらは internal であり、外部からはインポートしないこと
- ~120箇所の呼び出し元を変更する必要がある。段階的に進めるか、一括で行うか判断すること

## Definition of Done
- [ ] logger.ts が stable な public API として明記されている
- [ ] logger/* が実装詳細として明記されている
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
