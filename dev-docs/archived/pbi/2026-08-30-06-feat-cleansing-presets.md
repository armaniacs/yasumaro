# PBI: クレンジング32トグルをプリセットに束ねる

## ユーザーストーリー

初心者ユーザーとして、32個のチェックボックスを理解しなくても適切なクレンジング設定を選びたい。なぜなら現行 `entrypoints/options/index.html` の `panel-ai-summary-cleansing` は32トグルをフラットに列挙しており、何をONにすべきか判断できないから。

## 優先度

- 順位: 06 / 15
- RICE: Reach 10 / Impact 3 / Confidence 0.8 / Effort 3日 = 8.0
- 根拠: 全ユーザーがダッシュボードで最初に見る画面。初心者の離脱防止と上級者の時短の両方に効く。UI変更のみでバックエンド影響は小さい。

## 背景

- 現行: `entrypoints/options/index.html:979-1144` に32チェックボックスを `cleansing-group-title` で3グループ分け。デフォルトは7ON/25OFF。説明テキストはあるが、組み合わせの意味は不明。
- 課題: 初心者はデフォルトのまま、上級者は手動で32個を試行錯誤。どちらも最適な設定に到達しづらい。`cleansingStatsView.ts` のファネルチャートはあるが、設定との関連が可視化されていない。
- 機会: `Balanced(デフォルト7ON) / Aggressive(25ON) / Minimal(3ON) / Custom` の4プリセットに束ね、プリセット選択で一括切替。`Custom` 時のみ個別トグルを露出。`THRESHOLD_RULES` のスライダーも `Custom` 時のみ表示。

## BDD 受け入れシナリオ

```gherkin
Scenario: プリセットを選択すると一括でトグルが切り替わる
  Given ダッシュボードの AI要約クレンジング設定画面にいる
  When プリセット「Aggressive」を選択する
  Then 25個のトグルがONになり、保存される

Scenario: Customで個別調整できる
  Given プリセット「Custom」を選択している
  When 個別トグル「JPレイアウト」をONにする
  Then 該当トグルのみがONになり、プリセットはCustomのままである

Scenario: プリセット変更がクレンジング統計に反映される
  Given プリセット「Minimal」でページを記録した
  When プリセット「Aggressive」に変更して同サイトを再記録する
  Then cleansingStatsView のバイト削減率が増加する

Scenario: 既存ユーザーの設定は維持される
  Given 既存ユーザーが手動で32トグルをカスタム設定している
  When 本機能がリリースされる
  Then 既存設定は Custom として引き継がれ、勝手にプリセットで上書きされない
```

## 受け入れ基準

- [ ] `entrypoints/options/index.html` にプリセット選択UI(ラジオボタンまたはセレクト)が追加される
- [ ] `CLEANSING_RULES` から各プリセットのON/OFFマップが導出される(ハードコードではなくルール表から生成)
- [ ] プリセット選択時に `chrome.storage.local` の32キーが一括更新される
- [ ] `Custom` 選択時のみ個別トグルが表示/編集可能になる
- [ ] 既存ユーザーの設定は `Custom` としてマイグレーションされ、既存の32値は保持される
- [ ] `cleansingStatsView.ts` のファネルチャートとプリセットの関連が分かる説明が追加される(任意)
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- Playwrightでダッシュボードを開き、プリセット切替→保存→リロードでトグル状態が維持されることを検証

### 統合
- `aiSummaryCleansingSettingsV2.test.ts` にプリセット→32トグル変換の統合テスト
- マイグレーション: 既存設定あり/なしでのプリセット初期値テスト

### 単体
- プリセット定義の単体テスト: 各プリセットのON/OFFマップが `CLEANSING_RULES` と一致する
- プリセット切替ロジックの単体テスト: Balanced→Aggressiveで差分のみが変わる

## 実装アプローチ

- **Outside-In**: プリセット定義の単体テストを先に書く → `rules.ts` にプリセット定義を追加(または `presets.ts` 新設) → ダッシュボードUI実装 → 統合テスト
- **段階移行**: まず `src/dashboard/cleansingPresets.ts` にプリセット定義を作成し、既存の `aiSummaryCleansingSettingsV2.ts` から参照する形で疎結合に

## 見積もり

3pt (定義1 + UI1 + マイグレーション1)

## 技術的考慮事項

- 依存: `CLEANSING_RULES` の SSOT。プリセット定義は `rules.ts` または新ファイル `presets.ts` に置く
- テスタビリティ: プリセット→トグル変換は純粋関数。jsdomで検証可能
- 非機能: 既存ユーザーのマイグレーション。`storage/types.ts` に `CLEANSING_PRESET` キーを追加
- i18n: プリセット名と説明の `messages.json` 追加が必要

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "ai-summary-cleansing" entrypoints/options/index.html | head -n 30
cat src/dashboard/cleansingStatsView.ts | head -n 50
grep -rn "aiSummaryCleansingSettingsV2" src/dashboard/
```

### 実装手順
1. `src/utils/aiSummaryCleaner/presets.ts` を新設。`CLEANSING_RULES` から各プリセットの `Set<RuleKey>` を定義
2. `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` に `applyPreset(preset)` / `detectPreset(config)` を追加
3. `entrypoints/options/index.html` にプリセットUIを追加
4. `src/dashboard/main.ts` または該当パネル初期化でプリセットUIのイベントハンドラを追加
5. マイグレーション: 既存設定があるユーザーは `preset: 'custom'` として保存

### 落とし穴
- `CLEANSING_RULES` の `newUserDefault` とプリセットの `Balanced` が一致しない場合、どちらを正とするか決める必要あり。`Balanced = newUserDefault` に合わせるのが自然
- `THRESHOLD_RULES` の閾値もプリセットで変えるかは別PBIに分離すること。本PBIは32トグルのみに絞る
- `aiSummaryCleansingSettingsV2.ts` は既に `CLEANSING_RULES` から導出されているため、プリセット定義を同ファイルに置くと循環参照に注意

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
