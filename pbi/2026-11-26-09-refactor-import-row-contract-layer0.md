# PBI: import 行契約を layer 0 に単一実装として集約する

## ユーザーストーリー
保守担当者として、import 行の受け入れ契約 (validateImportRow) を単一実装にしたい、なぜなら現行は messaging (権威検証) と dashboard (lenient 前検証) に byte-identical な二重実装があり、契約変更のたびに 2 箇所を同時編集する構造が続くから。

## ユーザーへの背景 (レビュー報告書: テーマ 4)
- 現状: `src/messaging/validators.ts:441-483` (validateImportRow) と `src/dashboard/importLogsService.ts:226-321` (validateImportRowWithOptions、重複の正当化コメント 212-222) が二重実装。正当化は「dashboard must not depend on the messaging layer」だが、実際には dashboard は messaging に依存している (`src/dashboard/dashboardSqliteService.ts:7` の DashboardSqliteRequest 型 import)。依存方向の SSOT は「chrome 依存のない layer 0 は全層から import できる」(`src/offscreen/opfsWorker/archiveGuards.ts:6-9` の NOTE、`src/messaging/validators.ts:1` も `@layer 0` を自称) であり、重複の理由は依存方向ではなく「同じ layer 0 の純粋関数をどのモジュールに置くか」だけ
- pin テスト (`src/dashboard/__tests__/importLogsService-validateRow.test.ts`) は drift を検出するが、重複自体は解消しない

## ビジネス価値
- import 契約が 1 回変わる (オプショナルフィールド追加等) たびの 2 箇所編集を 1 箇所に減らす
- 測定方法: validateImportRow の単一定義が存在し、messaging/dashboard 両層が同一関数を参照し、byte-identical pin テストが「単一実装の pin」に縮約されて緑であること

## BDD受け入れシナリオ

```gherkin
Scenario: 単一実装への参照が成立する
  Given utils/logImportContract.ts に validateImportRow の単一実装がある
  When messaging と dashboard から import する
  Then 両層の検証は同一の実装を参照する (二重実装は存在しない)

Scenario: pin テストが契約の変更を検出する
  Given import 行契約に新フィールドが追加される
  When 既存の pin テストを実行する
  Then 単一実装の pin が期待どおり動作する (外部挙動は不変)
```

## 受け入れ基準
- [x] `src/utils/logImportContract.ts` (新規、chrome 依存なし、layer 0) に validateImportRow が移動している
- [x] `src/messaging/validators.ts` は移動先から import し re-export する (既存の参照経路を壊さない)
- [x] `src/dashboard/importLogsService.ts` の lenient 分岐重複を削除し、同一関数を import する (strict 側の追加ルール = length caps は dashboard 固有オプションのまま残る)
- [x] byte-identical pin テスト 2 系統は「単一実装の pin」に縮約され、緑である
- [x] 既存の import 関連テスト (importLogsService、validators 系) が緑である
- [x] `npm run validate` が通る (1,378 ファイル / 19,395 件)

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (既存の E2E が import 経路を通る)

### 統合テスト
- 既存の importLogsService 試験群 (移行後も緑)、validators 試験群

### 単体テスト
- logImportContract.ts の純粋関数テスト (既存 pin の移設。検証挙動は変えない)

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-26-1113-holistic-review-fix-encrypted-backup-large-capacity.md テーマ 4 [影響度: 中 | 難易度: 低]
- 外部挙動は完全に不変 (移動と re-export のみ)。lenient/strict の差は validateImportRowWithOptions のオプション層に残る
- 依存規約: layer 0 は chrome 依存を持たない。logImportContract.ts に chrome API import を持ち込まないこと
- なぜなぜ分析: 重複の正当化コメント (importLogsService.ts:212-222) は依存方向を理由にしていたが、layer 0 規約が SSOT であり、正当化は成立しない。byte-identical pin は重複の検出器として機能していたが、重複自体の解消はしなかった

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "validateImportRow" src/messaging/validators.ts src/dashboard/importLogsService.ts | head -10
grep -rn "validateImportRowWithOptions" src/ --include="*.ts" | grep -v test | head -5
```

### 実装手順
1. `src/utils/logImportContract.ts` を新設し、validateImportRow (と共依存の型・定数) を移動
2. validators.ts から import + re-export (既存参照を壊さない)
3. importLogsService.ts の lenient 分岐を削除し import に差し替え
4. pin テストを縮約 (byte-identical 比較 → 単一実装 pin)

### 落とし穴
- 移動で import を追加する場合 .js 拡張子必須
- lenient 分岐の削除で「dashboard 固有の緩い規則」も消さない (strict 追加ルールは残す)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (単体)
- [x] コードレビュー完了 (統合側、統合検証で担保)
- [x] リファクタリング完了 (グリーン後)
- [x] ドキュメント更新の要否判定: 内部構造の変更でユーザーに見える挙動不変のため、docs 更新は不要
