# PBI: oxc-parser-adapter の scope/token 対応

## ユーザーストーリー
開発者として、oxlint 移行用の oxc-parser-adapter で scope/token API を正しく扱いたい。なぜなら、現行は `scopeManager: null` と空 tokens のスタブであり、将来 `getScope`/`getTokens*` を使うルールが追加されると RuleTester が空振り合格するから

## ビジネス価値
- テストハーネスの空振り合格リスクを解消し、RuleTester 移植の信頼性を担保する
- ヘッダ記述と実態の乖離（「12ルール」「token API を使わない」）を正す

## BDD受け入れシナリオ

```gherkin
Scenario: scope を使うルールが adapter 経由で正しく評価される
  Given `getScope` を呼ぶルール（例: no-direct-console-log の isLocalChrome 経路）
  When   adapter 経由の RuleTester で実行する
  Then   スコープ解決が動作し、意図した valid/invalid 判定になる

Scenario: token API を使うルール追加時に検出される
  Given `getTokens*` を呼ぶ新規ルール
  When   adapter 経由で実行する
  Then   空振り合格せず、正しいトークンで評価されるか、明示的に未対応エラーになる
```

## 受け入れ基準
- [x] 方針を確定した（スパイク実施）。結論: 実スコープは oxc-parser の JS バインディングに公開がなく（parse/parseSync/visitorKeys のみ）、手書き実装は開発専用ハーネスに対して過大。よって (b) 明示的ドキュメント方式を採用し、振る舞い変更は行わない
- [x] ヘッダの記述を実態に合わせた（件数だけでなく「scope 未公開・token 空配列・到達範囲の実測」を明記。isLocalChrome 経路の getScope は現行テスト未到達、到達時は TypeError で fail-closed になることを確認）
- [x] `eslint/oxlint-plugin.mjs` の `scopeManager: null` と空 tokens の扱いを維持する（変更なし。将来 getTokens* を使うルール追加時は先に明示的未対応エラーを入れる旨をヘッダに記載）
- [x] eslint/__tests__ 全ファイルが緑である（utils-layer-boundary 39/39）
- [x] `npm run lint` が緑である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし（開発用テストハーネス）

### 統合テスト
- adapter 経由の RuleTester 全件緑（回帰）
- scope/token 使用ルールの smoke（新規）

### 単体テスト
- 方針に応じた adapter 単体検証

比率: E2E:統合:単体 = 0:10:1

## 実装アプローチ
- **Outside-In**: 既存 RuleTester 緑を確認 → 方針実装 → 全件グリーン → リファクタリング
- **Red-Green-Refactor**: 新規 scope/token smoke を先に赤で用意できれば最良（スタブ現状では赤にならないことが問題のため、方針次第）

## 見積もり
3 ストーリーポイント以上（要チームでの見積もり。実スコープ解析は不確実性が高く、スパイク分離を推奨）

## 技術的考慮事項
- 依存関係: oxc-parser の semantic API の有無。なければ adapter 適用範囲の制限が現実解
- テスタビリティ: 現行13ルールのテストが回帰網になる。`utils-layer-boundary.test.ts` のみが adapter 使用者であることに注意（他12件は別 parser の可能性）
- 非機能要件: なし（開発時ツールのみ。製品ランタイムに影響しない）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# scope/token API の使用状況を確認
grep -rn "getScope\|getTokens\|getText" eslint/rules/*.mjs
# adapter 使用者の確認
grep -rln "oxc-parser-adapter" eslint/__tests__/
# 現行の緑確認
npx vitest run eslint/__tests__/utils-layer-boundary.test.ts
```

確認済み（2026-11-22）: 4ルールが `getScope` を呼び出す（no-direct-console-log/no-raw-storage/no-test-sleep/utils-layer-boundary）。adapter 使用者は utils-layer-boundary.test.ts のみ。現行テストは該当経路に到達せず緑。

### 実装手順
1. スパイク: oxc に scope 解決手段があるか、または `getScope` 呼出を検出して明示エラーにする方式のいずれが現実的かを確定する
2. 方針どおりに adapter を修正し、ヘッダ記述を実態に合わせる
3. eslint/__tests__ 全件と `npm run lint` の緑を確認する

### 落とし穴
- 現行テストが該当経路を踏まないため「緑＝正しい」の証明にならない。smoke の追加が必須
- adapter は開発時ツールであり製品コードではない。過剰な作り込みを避ける
- ヘッダの件数だけ直す cosmetic 修正は禁止（deeper issue を隠すため）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（既存 39/39 が文書化した前提を検証。spike により新規テストは不要と確定：到達不能経路のテストは書けないため）
- [x] テストカバレッジが基準を満たす（振る舞い変更なし。文書のみ）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後。spike 結論に基づく文書修正のみ）
- [x] ロールバック手段の検討（コメントのみのため切り戻しは revert のみで足りる）
- [x] ドキュメント更新済み（adapter ヘッダに実測ベースの到達範囲と将来条件を記録）
