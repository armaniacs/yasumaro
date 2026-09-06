# PBI: Priority リストにプロバイダの実モデル名を表示

## ユーザーストーリー
AIプロバイダー設定ユーザーとして、Priority (Failover Order) の各行で使用されるモデル名を一目で確認したい。なぜなら、現在プレースホルダー「モデル名（省略可、デフォルト使用）」のみが表示され、どのモデルが使われるか把握できず設定ミスのリスクがあるから。

## ビジネス価値
- Priority設定時の認知負荷を低減
- 「デフォルトモデルを使う」設定と「明示的にモデルを指定する」設定の区別を視覚的に明確化
- モデル名の重複検出（`validateBSlots`）の可視性向上

## BDD受け入れシナリオ

```gherkin
Scenario: 明示的に設定したモデル名がPriorityリストに表示される
  Given ユーザーがAIプロバイダー設定（B分離型）を開いている
  And   Priority 1に「Google Gemini」が選択済み
  And   Priority 1のモデル名欄に「gemini-3.8-flash」が入力済み
  When  Priority (Failover Order) セクションを表示する
  Then  Priority 1のモデル名欄に「gemini-3.8-flash」が表示される

Scenario: モデル名未設定時にプロバイダのストレージ設定値が表示される
  Given ユーザーがAIプロバイダー設定（B分離型）を開いている
  And   Priority 1に「Google Gemini」が選択済み
  And   Priority 1のモデル名欄は空（未入力）
  And   Geminiのモデル設定（gemini_model）が「gemini-2.0-flash」に設定済み
  When  Priority (Failover Order) セクションを表示する
  Then  Priority 1のモデル名欄に「gemini-2.0-flash」が表示される

Scenario: ストレージ設定も空の場合にカタログのデフォルトモデルが表示される
  Given ユーザーがAIプロバイダー設定（B分離型）を開いている
  And   Priority 1に「OpenAI互換」が選択済み
  And   Priority 1のモデル名欄は空
  And   OpenAIのモデル設定（openai_model）も空
  When  Priority (Failover Order) セクションを表示する
  Then  Priority 1のモデル名欄に「gpt-3.5-turbo」（カタログのdefaultModel）が表示される

Scenario: デフォルトモデルもない場合にプレースホルダーが表示される
  Given ユーザーがAIプロバイダー設定（B分離型）を開いている
  And   Priority 1に「Built-in AI」が選択済み
  And   Built-in AIにはモデル名設定（modelKey）がない
  When  Priority (Failover Order) セクションを表示する
  Then  Priority 1のモデル名欄はプレースホルダー「モデル名（省略可、デフォルト使用）」のまま表示される

Scenario: プロバイダー変更時にモデル名表示が切り替わる
  Given ユーザーがAIプロバイダー設定（B分離型）を開いている
  And   Priority 1に「Google Gemini」が選択済み
  And   Priority 1のモデル名欄に「gemini-2.0-flash」が表示されている
  When  Priority 1のプロバイダーを「OpenAI互換」に変更する
  And   Priority 1のモデル名欄は空（未入力）
  Then  Priority 1のモデル名欄に「gpt-3.5-turbo」（OpenAIのdefaultModel）が表示される
```

## 受け入れ基準
- [x] `createRow()` がプロバイダ選択時にストレージ設定値・カタログデフォルトを参照してモデル名を解決する
- [x] モデル名入力フィールドに解決されたモデル名が初期表示される
- [x] ユーザーがモデル名を入力・上書きできる（入力フィールドとしての機能は維持）
- [x] プロバイダーを変更したとき、モデル名表示が新しいプロバイダの解決値に切り替わる
- [x] i18n対応（en/ja）のプレースホルダー テキストは変更なし（空の場合のフォールバックとして維持）
- [x] 既存テスト（`priorityListView.test.ts`）がパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト（主体）

**`resolveModelDisplayName()` のユニットテスト（新規ヘルパー関数）:**
- 明示モデルあり → その値を返す
- 明示なし + ストレージ設定あり → ストレージ値を返す
- 明示なし + ストレージ空 + デフォルトあり → デフォルトを返す
- 明示なし + ストレージ空 + デフォルトなし → 空文字を返す
- プロバイダIDが空 → 空文字を返す

**`createRow()` のモデル名表示テスト:**
- slot.modelあり → input.value にセット
- slot.modelなし + ストレージ設定あり → input.value に解決値
- slot.modelなし + ストレージ空 + デフォルトあり → input.value にデフォルト
- slot.modelなし + 全空 → placeholder のみ（value は空）

### 統合テスト（最小限）
- `createBPriorityListView` の初期表示テスト（設定済みスロットのモデル名確認）
- プロバイダー変更時のモデル名切り替えテスト

## 実装アプローチ
- **Outside-In**: 受け入れシナリオから開始し、`resolveModelDisplayName()` ヘルパーを抽出して単体テスト
- **Red-Green-Refactor**: TDDサイクルで各レイヤーを適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2pt（小〜中規模のUI修正。カタログ参照ロジックの追加が主な作業）

## 技術的考慮事項
- **依存関係**: `providerCatalog.ts`（`PROVIDER_CATALOG` / `getRegistryEntry`）、`settingsRepository`（ストレージ設定値の取得）
- **テスタビリティ**: `resolveModelDisplayName` を純粋関数として抽出し、ストレージ参照を引数注入可能にする
- **非機能要件**: UIの遅延なし（設定読み取りは既にDOM構築時に実行済み）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 機能に関連するキーワードでコードを探す
grep -rn "b-priority-model-input" src/
grep -rn "resolveModel\|defaultModel" src/
grep -rn "collectBProviderPrioritySlots" src/
```

### 実装手順
1. `src/dashboard/aiProviderB/priorityListView.ts` に `resolveModelDisplayName(provider, explicitModel, settings)` ヘルパー関数を追加
   - 引数: `provider` (ProviderId), `explicitModel` (string | undefined), `settings` (Settings)
   - ロジック: explicitModel → settings[provider.modelKey] → catalog.defaultModel → ''
2. `createRow()` 関数に `settings` 引数を追加し、`resolveModelDisplayName` を呼び出して `modelInput.value` にセット
3. `createBPriorityListView()` 内で `settingsRepository.getAll()` を呼び出し、各 `createRow()` に渡す
4. プロバイダー選択変更時（`change` イベント）にモデル名入力の値を再解決
5. 既存テストの更新 + 新規ユニットテスト追加

### 落とし穴
- `settingsRepository.getAll()` は非同期（`await` 必須）。`createRow` 自体は同期のため、設定読み取りを `createBPriorityListView` の冒頭で行い結果を渡す設計にする
- `collectBProviderPrioritySlots` はユーザー入力済みの `input.value` を読むため、解決されたデフォルト値が誤って保存されないように注意（保存時は空ならslot.modelを省略する既存ロジックを維持）
- プロバイダー変更時の再解決で、既にユーザーが手動入力した値を上書きしない（`input.dataset.userEdited` フラグなどでの保護を検討）

## Definition of Done
- [x] `resolveModelDisplayName` のユニットテスト全パス
- [x] `createRow` のモデル名表示テスト全パス
- [x] `createBPriorityListView` 統合テスト全パス
- [x] 既存テスト（`priorityListView.test.ts`）全パス
- [x] `type-check` / `lint` パス
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）

## 実装メモ（2026-09-06 自律実装）
- `resolveModelDisplayName(provider, explicitModel, settings)` を `priorityListView.ts` に新設（explicit → settings[modelKey] → catalog.defaultModel → ''）
- `createRow()` が解決値を `modelInput.value` に初期表示。自動解決値には `dataset.resolved = 'true'` を付与し、`collectBProviderPrioritySlots()` は resolved フラグ付きの値を保存時に省略（解決したデフォルトが誤って明示モデルとして保存されるのを防ぐ。PBI落とし穴対応）
- ユーザーが input イベントで編集すると resolved フラグが外れ、明示モデルとして保存される
- プロバイダ変更（select change）時、未編集の input は新しいプロバイダの解決値に再解決。ユーザー入力済み（resolved フラグなし・非空）は保持
- `createBPriorityListView` に第3引数 `settings` を追加。`generalSettingsPanel.ts` が取得済みの settings を渡す（非同期取得はパネル側で解決済み。PBI落とし穴対応）
- テスト: `src/dashboard/aiProviderB/__tests__/priorityListView.test.ts` 新規 13 tests（dashboard 全 2457 tests green）
- コードレビューは diff 自レビュー＋全体検証で実施
