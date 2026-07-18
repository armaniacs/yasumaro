# PBI: ログ呼び出しのsourceパラメータ自動補完ヘルパー導入

## ユーザーストーリー
開発チームとして、ログ呼び出し時に呼び出し元ファイル情報（source）を毎回手動指定せずに済むようにしたい、なぜなら現状は多くの箇所で `source` パラメータが省略されており、障害調査時に「どのファイルから出たログか」を追跡しづらいから

## ビジネス価値
- 障害調査時のログトレーサビリティ向上
- 開発者が `source` を手動指定する手間を削減（自動補完によるDX改善）

## 実装者向け注記（フェーズ0の既実装確認結果）

grep で確認済み:
- `src/background/pipeline/RecordingPipeline.ts:295` — `logError(...)` 呼び出しで `source` パラメータなし
- 対象は「`RecordingPipeline.ts`, `saveSqliteStep.ts` 他多数」（親レポート記載）と広範囲
- 対処案（親レポートより）: `import.meta.url` から自動補完するヘルパーを導入

```bash
# 実装前の必須調査コマンド（対象箇所の全体像把握）
grep -rn "logInfo(\|logWarn(\|logError(\|logDebug(" src/ --include="*.ts" | grep -v __tests__ | wc -l
grep -n "logError\|logInfo\|logWarn\|logDebug\|ErrorCode" src/utils/logger.ts | head -20
```

**設計判断が必要**: `import.meta.url` はESMのファイルURLを返すが、これをそのまま `source` に使うと冗長（フルパス）になる可能性がある。ファイル名のみを抽出するヘルパー関数の設計、または呼び出し側での明示指定を維持しつつデフォルト値としてのみ自動補完を使う設計、のいずれかを実装前に決める。

## BDD受け入れシナリオ

```gherkin
Scenario: sourceを省略したログ呼び出しで呼び出し元ファイル名が自動的に記録される
  Given logError等のログ関数をsourceパラメータなしで呼び出す
  When ログエントリが生成される
  Then sourceフィールドに呼び出し元のファイル名（import.meta.urlベース）が自動的に設定される

Scenario: sourceを明示指定した場合は指定値が優先される
  Given logError等のログ関数にsourceパラメータを明示的に渡す
  When ログエントリが生成される
  Then sourceフィールドには明示指定された値が使用される（自動補完で上書きされない）
```

## 受け入れ基準
- [ ] `import.meta.url` からファイル名を抽出する自動補完ヘルパーを `src/utils/logger.ts` に追加
- [ ] `logInfo`/`logWarn`/`logError`/`logDebug` の `source` パラメータを省略可能にし、省略時は自動補完される
- [ ] 既存の明示的な `source` 指定箇所は変更しない（後方互換）
- [ ] 主要な省略箇所（`RecordingPipeline.ts`, `saveSqliteStep.ts` 等）に自動補完が適用されることを確認

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- 不要

### 単体テスト
- 自動補完ヘルパー関数に対して、様々な `import.meta.url` 形式の入力から正しいファイル名が抽出されることを検証
- `source` 省略時と明示指定時の両方でログエントリの `source` フィールドが期待通りになることを検証

## 実装アプローチ
- **Outside-In**: 「source省略時に呼び出し元ファイル名が自動記録される」単体テストをRedで書き、自動補完ヘルパー実装でGreenにする
- 既存の全呼び出し箇所を一括変更する必要はなく、ヘルパー導入後は新規コードから自然に恩恵を受ける設計とし、既存箇所への適用は段階的に行う（L12自体は「多数」箇所に及ぶため、本PBIではヘルパー導入と主要箇所への適用に留め、全箇所の一斉置換は別タスクとする）

## 見積もり
2pt（半日。ヘルパー実装と主要箇所への適用まで）

## 技術的考慮事項
- 依存関係: `import.meta.url` はESM環境でのみ利用可能（本プロジェクトはESM前提のため問題なし）
- テスタビリティ: `import.meta.url` の値はビルド/実行環境で変わるため、テストではモックまたは正規表現ベースの検証を行う
- 非機能要件: ログ品質・トレーサビリティ向上

## 落とし穴
- Service WorkerやContent Scriptなどバンドル後のコードでは `import.meta.url` がビルド後のファイルパス（例: `chunks/xxx.js`）を指す場合があり、開発時のソースファイル名とは異なる可能性がある。バンドル後の挙動を実機Chromeで確認すること
- 「多数」の呼び出し箇所全てを本PBIで一斉修正するとスコープが膨らみすぎるため、ヘルパー導入＋代表的な数箇所への適用に留め、残りは段階的移行とすることを推奨（Definition of Doneも合わせて調整）

## Definition of Done
- [ ] `source` 自動補完ヘルパーが実装されている
- [ ] 単体テストが追加されパスする
- [ ] 主要な省略箇所（2〜3ファイル）に適用され、動作確認済み
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
