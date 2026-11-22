# PBI: 2026-11-21-05-refactor-settings-form-binding-adoption

## ユーザーストーリー
開発者として、チェックボックス・テキスト入力の null ガード値抽出を `settingsFormBinding.ts` の `extractSettingsFromInputs` / `loadSettingsToInputs` に集約したい。なぜなら、`?.checked ?? false` / `?.value ?? ''` パターンが 6 以上のファイルで分散・手書きされており、既存の `settingsFormBinding.ts` 抽象化が未活用だから

## ビジネス価値
- 同一の null ガード＋値抽出パターンを 1 か所に集約し、挙動の一貫性を確保
- `settingsFormBinding.ts` の `[data-storage-key]` スキーマ駆動アプローチを活用し、宣言的な設定バインドが可能に
- 新規ファイルでの手書き null ガードパターンを防止

## BDD 受け入れシナリオ

```gherkin
Scenario: チェックボックスの値が正しく抽出される
  Given チェックボックスがチェックされている
  When   設定抽出関数を呼び出す
  Then   結果に checked=true が含まれる

Scenario: チェックボックスが存在しない場合はフォールバック値を返す
  Given 対象チェックボックスが DOM に存在しない
  When   設定抽出関数を呼び出す
  Then   フォールバック値（false）が返される

Scenario: テキスト入力の値が正しく抽出される
  Given テキスト入力に値が入力されている
  When   設定抽出関数を呼び出す
  Then   結果に入力値が含まれる

Scenario: テキスト入力が存在しない場合は空文字列を返す
  Given 対象テキスト入力が DOM に存在しない
  When   設定抽出関数を呼び出す
  Then   空文字列が返される
```

## 受け入れ基準
- [x] `src/utils/settingsFormBinding.ts` に `getChecked(element, fallback?)` と `getValue(element, fallback?)` の最小ヘルパーを追加（要素参照型。ID ベースではなく既存の要素参照に適合。スキーマ駆動への全面移行ではなく最小ヘルパー方式を採用）
- [x] 分散していた `?.checked ?? false` / `?.value ?? ''` パターンのうち PBI 指定の 16 件（`gistSettings.ts` 2、`webhookExportSettings.ts` 1、`trustSettings.ts` 3、`contentSettings.ts` 3、`privacyConsentController.ts` 1、`aiSummaryCleansingSettingsV2.ts` 6）をヘルパーに置換（`.trim()` 連鎖や `parseIntOr` 引数の `?.value` は対象外。`parseIntOr` 呼出側は PBI 02 の範囲）
- [x] `npm run type-check` が pass する
- [x] 対象ファイルに関連する既存テストがすべて pass する（10ファイル195件）＋新規ヘルパー単体 4 件

## テスト戦略（t_wada スタイル）

### E2E テスト
- なし（設定抽出ロジックの単体レベルで十分）

### 統合テスト
- 設定ロード・保存フローで `settingsFormBinding` 経由の値抽出が正しく動作することの統合検証

### 単体テスト
- `getChecked` / `getValue` の単体テスト（null 対象、正常取得、フォールバック値）
- `extractSettingsFromInputs` / `loadSettingsToInputs` のスキーマ駆動テスト

比率: E2E:統合:単体 = 0:1:10

## 実装アプローチ
- **Outside-In**: 既存テスト（失敗を確認）→ ヘルパーまたはスキーマ移行実装 → 各ファイルを置換 → テストグリーン → リファクタリング
- **Red-Green-Refactor**: TDD サイクルを適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
5 ストーリーポイント（要チームでの見積もり。6 以上のファイルに影響するため範囲広）

## 技術的考慮事項
- 依存関係: `src/utils/settingsFormBinding.ts` が既存のため、新規ファイル作成不要
- テスタビリティ: jsdom 環境で DOM 要素からの値抽出テストが可能
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 分散した null ガード値抽出パターンを確認
grep -rn "\?.checked ??\| \?.value ??" src/dashboard/ src/popup/
# settingsFormBinding.ts の既存実装を確認
cat src/utils/settingsFormBinding.ts
```

### 実装手順
1. `settingsFormBinding.ts` に `getChecked(id: string, fallback?: boolean): boolean` と `getValue(id: string, fallback?: string): string` ヘルパーを追加（または既存の `extractSettingsFromInputs` / `loadSettingsToInputs` にスキーマを追加）
2. 各ファイルで手書きの `?.checked ?? false` / `?.value ?? ''` パターンをヘルパー呼び出しに置換
   - `src/dashboard/gistSettings.ts:81-82`
   - `src/dashboard/webhookExportSettings.ts:204-205`
   - `src/dashboard/settings/trustSettings.ts:470-472`
   - `src/dashboard/settings/contentSettings.ts:101,103`
   - `src/popup/privacyConsentController.ts:149`
   - `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:341,346,352-360`
3. `npm run type-check` で型エラーがないか確認
4. 各対象ファイルに関連する既存テストを実行し、すべて pass することを確認

### 落とし穴
- 各ファイルでフォールバック値が異なる（`false` / `true` / `''` など）ため、ヘルパーにフォールバック引数を持たせる
- `trim()` などの前処理が必要なケース（`url?.value.trim() ?? ''`）は、ヘルパーにオプションで対応するか、呼び出し側で処理
- `settingsFormBinding.ts` の `[data-storage-key]`  convention とは異なる ID ベースの参照となるため、スキーマ駆動ではなく最小ヘルパーで対応する方が現実的

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（`getChecked`/`getValue` の present/missing/fallback 4 件）
- [ ] テストカバレッジが基準を満たす（新規ヘルパーは全分岐カバー済みだが、`settingsFormBinding.ts` 全体は 53% で既存不足あり。本 PBI の追加分は 100% のため回帰なし。全体引上げは別途）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後。振る舞い不変のため追加の磨き込みなし）
- [x] ロールバック手段の検討（振る舞い不変の置換のため切り戻しは revert のみで足りる）
- [x] ドキュメント更新済み（公開 API・仕様の変更なし。PBI 自体に方式と証跡を記録）
