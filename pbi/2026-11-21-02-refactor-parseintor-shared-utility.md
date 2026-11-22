# PBI: 2026-11-21-02-refactor-parseintor-shared-utility

## ユーザーストーリー
開発者として、DOM 入力要素の数値パース（フォールバック付き）を共通ユーティリティから呼び出したい。なぜなら、`parseIntOr` が `aiSummaryCleansingSettingsV2.ts` にのみローカル定義されており、他ファイルでも同等のパースロジックが重複実装されるおそれがあるから

## ビジネス価値
- 数値パースのフォールバックロジックを 1 か所に集約し、挙動の一貫性を確保
- 新規ファイルでの同等ロジックの重複実装を防止
- 単一の単体テストで全利用箇所の挙動を担保

## BDD 受け入れシナリオ

```gherkin
Scenario: 有効な数値文字列をパースする
  Given "70" という文字列とフォールバック値 30
  When   parseIntOr を呼び出す
  Then   結果は 70 を返す

Scenario: 空文字列をパースする
  Given "" という空文字列とフォールバック値 30
  When   parseIntOr を呼び出す
  Then   結果はフォールバック値 30 を返す

Scenario: null をパースする
  Given null とフォールバック値 5
  When   parseIntOr を呼び出す
  Then   結果はフォールバック値 5 を返す

Scenario: 非数値文字列をパースする
  Given "abc" という非数値文字列とフォールバック値 100
  When   parseIntOr を呼び出す
  Then   結果はフォールバック値 100 を返す
```

## 受け入れ基準
- [x] `src/utils/string.ts` に `parseIntOr(value: string | null | undefined, fallback: number): number` を追加 export（`aiSummaryCleansingSettingsV2.ts` から移植。挙動同一）
- [x] `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` からローカル定義の `parseIntOr` を削除し、`src/utils/string.js` から import する（外部 import 者は存在しないことを grep で確認）
- [x] 既存の 8 箇所の使用箇所がすべて import 版に置換される（呼出側は無変更。定義のみ移動）
- [x] `npm run type-check` が pass する
- [x] `aiSummaryCleansingSettingsV2.test.ts` がすべて pass する（関連4ファイル85件：新規 parseIntOr 5件を含む）

## テスト戦略（t_wada スタイル）

### E2E テスト
- なし（純粋関数の単体レベルで十分）

### 統合テスト
- なし

### 単体テスト
- `parseIntOr` の単体テスト（有効値、空文字列、null、undefined、非数値、負数、小数文字列、極端な値）

比率: E2E:統合:単体 = 0:0:100

## 実装アプローチ
- **Outside-In**: 既存テスト（失敗を確認）→ `parseIntOr` を `src/utils/string.ts` に移動 → import に置換 → テストグリーン → リファクタリング
- **Red-Green-Refactor**: TDD サイクルを適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（`src/utils/string.ts` は DOM/chrome API に依存しない純粋関数専用ファイル）
- テスタビリティ: 純粋関数なのでモック不要、同期テストで容易に検証可能
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# src/utils/ 以下に parseIntOr が既に存在しないか確認
grep -rn "export function parseIntOr\|export const parseIntOr" src/utils/
# aiSummaryCleansingSettingsV2.ts での定義と使用箇所を確認
grep -n "parseIntOr" src/dashboard/settings/aiSummaryCleansingSettingsV2.ts
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。（本 PBI 作成時点で `src/utils/` には存在しないことを確認済み）

### 実装手順
1. `src/utils/string.ts` に `export function parseIntOr(value: string | null | undefined, fallback: number): number` を追加（実装は `aiSummaryCleansingSettingsV2.ts:85` から移植）
2. `aiSummaryCleansingSettingsV2.ts` からローカル定義の `parseIntOr` を削除
3. `aiSummaryCleansingSettingsV2.ts` に `import { parseIntOr } from '../../utils/string.js';` を追加
4. `npm run type-check` で型エラーがないか確認
5. `aiSummaryCleansingSettingsV2.test.ts` を実行し、すべて pass することを確認

### 落とし穴
- `Number(value)` の NaN 扱い：`isNaN` または `Number.isFinite` でフォールバック判定を行う（既存実装の挙動を維持）
- ESM インポート：`.js` 拡張子を使用する（プロジェクトの ESM imports 規則）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（有効値・空文字・null/undefined・非数値・負数/小数 5件）
- [x] テストカバレッジが基準を満たす（純粋関数2分岐を全カバー。呼出側8件は既存スイートで担保）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後。定義移動のみのため追加の磨き込みなし）
- [x] ロールバック手段の検討（定義移動のみのため切り戻しは revert のみで足りる）
- [x] ドキュメント更新済み（公開 API・仕様の変更なし。PBI 自体に方式と証跡を記録）
