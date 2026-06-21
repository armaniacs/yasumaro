# PBI-27: vitest 設定ファイルの自動発見問題を修正

## ユーザーストーリー

開発者として、`npx vitest run` で設定ファイルなしにテストを実行しても全テストがパスしたい。なぜなら、現在 `testDir/vitest.config.ts` にある設定が自動発見されず、215件のテストが不要に失敗するから。

## ビジネス価値

- 開発体験の向上（IDE統合、CI/CDパイプラインの簡素化）
- 新規コントリビューターのオンボーディングコスト低減
- `npm run test:watch` 等の開発時コマンドの信頼性向上
- テスト失敗のFalse Positiveが排除され、実際の問題に集中できる

## 根本原因分析

`vitest.config.ts` がプロジェクトルートではなく `testDir/` 内にある。Vitest の自動発見はルートの `vitest.config.*` のみ対象のため、`--config` パラメータなしでは設定が読み込まれない。

**影響範囲:**
- `globals: true` が無効 → `describe`, `it`, `expect`, `vi` 等が未定義
- `setupFiles` が無効 → `chrome` API モックが未設定
- `exclude` パターンが無効 → Playwright `.spec.ts` ファイルが誤実行
- `testTimeout` が無効 → タイムアウト発生

## BDD 受け入れシナリオ

```gherkin
Scenario: vitest 自動発見で設定が読み込まれる
  Given プロジェクトルートに vitest.config.ts が存在する
  When 開発者が `npx vitest run` を実行する
  Then testDir/vitest.config.ts の設定が自動的に適用される
  And 全テストがパスする

Scenario: npm test と npx vitest run の結果が一致する
  Given プロジェクトルートに vitest.config.ts が存在する
  When `npm test` と `npx vitest run` をそれぞれ実行する
  Then 両方のテスト結果が同一になる

Scenario: IDE でテストを個別実行できる
  Given VS Code + Vitest 拡張がインストールされている
  When テストファイルを右クリックして「Run Test」を選択する
  Then 正しい設定が適用されてテストが実行される
```

## 受け入れ基準

- [ ] プロジェクトルートに `vitest.config.ts` が存在する
- [ ] `npx vitest run`（`--config` なし）で全テストがパスする
- [ ] `npm test` の結果と一致する
- [ ] `testDir/vitest.config.ts` は廃止され、ルートの設定に統合される
- [ ] `testDir/vitest.setup.ts` への参照が正しく動作する
- [ ] 既存の `npm test` スクリプトが引き続き動作する
- [ ] IDE（VS Code Vitest 拡張）でテストが正しく実行される

## テスト戦略（t_wada スタイル）

### 単体テスト
- vitest 設定の自動発見が動作することの検証
- `globals: true` が有効になっていることの検証
- `setupFiles` が正しく読み込まれていることの検証

### 統合テスト
- `npx vitest run` と `npm test` の結果一致確認
- IDE での個別テスト実行確認（手動）

## 実装アプローチ

### オプション A（推奨）: ルートに vitest.config.ts を作成し、testDir への参照を維持

```typescript
// vitest.config.ts（プロジェクトルート）
export { default } from './testDir/vitest.config';
```

**利点:**
- 最小限の変更
- `testDir/vitest.config.ts` の内容は維持
- ルートに設定が存在するため自動発見される

**欠点:**
- 1行の再エクスポートファイルが追加される

### オプション B: testDir/vitest.config.ts の内容をルートに移動

**利点:**
- 設定が1箇所に集約される

**欠点:**
- `testDir/vitest.setup.ts` の相対パスが変更される
- 既存の `--config testDir/vitest.config.ts` を使用しているスクリプトの更新が必要

### 推奨: オプション A

## 見積もり

**2 ストーリーポイント**

## Definition of Done

- [ ] プロジェクトルートに `vitest.config.ts` が存在する
- [ ] `npx vitest run` で全テストがパスする
- [ ] `npm test` が引き続き動作する
- [ ] `testDir/vitest.config.ts` が廃止される（or ルートから再エクスポート）
- [ ] テスト失敗のFalse Positiveがゼロになる
