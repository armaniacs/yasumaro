# PBI: 2026-11-21-03-refactor-webhook-export-element-consolidation

## ユーザーストーリー
開発者として、webhook 設定の save/load で同一の 5 要素を重複して取得するコードを 1 か所に集約したい。なぜなら、`save()` と `load()` でまったく同じ `document.getElementById` 呼び出しが重複しており、要素 ID の変更時に修正漏れのリスクがあるから

## ビジネス価値
- 同一 DOM 要素取得の重複を排除し、仕様乖離リスクを低減
- 要素 ID の変更時に 1 か所の修正で save/load 両方に反映
- コードの可読性が向上し、新規開発者の理解コストを削減

## BDD 受け入れシナリオ

```gherkin
Scenario: save でフォーム値が正しく取得される
  Given webhook 設定フォームに値が入力されている
  When   保存ボタンをクリックする
  Then   5 つのフォーム要素（enabled, url, tag, minScroll, minDuration）の値が正しく読み取られ、設定として保存される

Scenario: load で保存済み値がフォームに復元される
  Given 保存済みの webhook 設定がある
  When   ページを読み込む（load が呼ばれる）
  Then   5 つのフォーム要素に保存済み値が正しく設定される

Scenario: 要素が存在しない場合も例外が発生しない
  Given DOM に webhook 設定要素が存在しない
  When   save/load を呼び出す
  Then   例外が発生せず、安全にスキップされる
```

## 受け入れ基準
- [ ] `src/dashboard/webhookExportSettings.ts` で save/load 間の 5 要素取得（`webhookExportEnabled` / `webhookExportUrl` / `webhookExportTag` / `webhookExportMinScroll` / `webhookExportMinDuration`）を共通ヘルパー関数に集約
- [ ] save と load で同じ要素参照を再利用
- [ ] 各要素の null ガードが共通化され、重複なし
- [ ] `npm run type-check` が pass する
- [ ] `webhookExportSettings` に関連する既存テストがすべて pass する

## テスト戦略（t_wada スタイル）

### E2E テスト
- なし（ポップアップ UI の DOM 操作レベル）

### 統合テスト
- save → load の一連フローで値が正しく保存・復元されることの統合検証

### 単体テスト
- 共通要素取得ヘルパーの単体テスト（null 対象、正常取得）
- save/load の各関数がモック DOM 上で正しく動作することの検証

比率: E2E:統合:単体 = 0:1:10

## 実装アプローチ
- **Outside-In**: 既存テスト（失敗を確認）→ 共通ヘルパー実装 → save/load を置換 → テストグリーン → リファクタリング
- **Red-Green-Refactor**: TDD サイクルを適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
3 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（`webhookExportSettings.ts` 内のリファクタリングのみ）
- テスタビリティ: jsdom 環境で DOM 要素取得のテストが可能
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# save/load での重複要素取得を確認
grep -n "document.getElementById" src/dashboard/webhookExportSettings.ts
```

### 実装手順
1. `getWebhookExportElements()` などの共通ヘルパー関数を `webhookExportSettings.ts` 内に定義し、5 要素をまとめて取得してオブジェクトとして返す
2. `save()` と `load()` で共通ヘルパーを呼び出し、各要素にアクセス
3. `npm run type-check` で型エラーがないか確認
4. 関連テストを実行し、すべて pass することを確認

### 落とし穴
- `readNumberOrUndefined` は要素取得とは別に定義されているため、ヘルパー関数には含めず、別途利用する
- 要素が null の場合の扱い：save では `?? false` / `?? ''` でフォールバック、load では `if (el !== null)` でガード、この挙動を維持する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（挙動変更・性能変更・フィルタロジック変更・閾値変更等の場合、本番投入後に問題が発覚した場合の切り戻し手段を技術的考慮事項または本項に記載）
- [ ] ドキュメント更新済み
