# PBI: background 側 SettingsRepository 採用 — RemoteAIService を起点に読み取りを型付き seam へ移行

## ユーザーストーリー
開発者として、background 側の設定読み取りを `SettingsRepository`（既存 deep module）経由に移行したい、なぜなら `(settings[StorageKeys.X] as string) || 'gemini'` のキャストとインラインデフォルトが background の各モジュールに複製され、デフォルト値の一元ソース（DEFAULT_SETTINGS）と乖離したフォールバックが残り続けているから

## 優先度
- 順位: 5 / 5（pass 2 後続）
- RICEスコア: 60（Reach=200 / Impact=0.5 / Confidence=80% / Effort=1人週）
- 根拠: dashboard 側（PBI 03）と同型の摩擦が background に残存。Impact 0.5（振る舞い変化なし・型安全化・既定値の局在化）。Confidence 80%（getMany/getAll は実装済み）。Effort 1週。RemoteAIService の `|| 'gemini'` は実運用では getSettings の defaults マージで死にコード化しているが、テストの raw mock に依存する形で残っており、読み取り経路の一貫性を崩している

## BDD受け入れシナリオ

```gherkin
Scenario: RemoteAIService が repo 経由で設定を読む
  Given RemoteAIService が SettingsReader を注入されている
  When generateSummary / testConnection が設定を読む
  Then repo.getAll 経由で取得し、chrome.storage / getSettings を直接呼ばない

Scenario: 既定プロバイダの単一ソース化
  Given AI_PROVIDER_PRIORITY_LIST が空である
  When resolveProviderSlots がプロバイダを決める
  Then DEFAULT_SETTINGS.AI_PROVIDER（openai）を使い、`|| 'gemini'` のインラインフォールバックが存在しない

Scenario: キャストとインラインデフォルトの撤去
  Given 対象ファイルが repository 経由で読むように移行済みである
  When 対象ファイルで "(settings[StorageKeys..." の as キャストと `|| 'literal'` を grep する
  Then 移行済み箇所でヒット0件
```

## 受け入れ基準（本ラウンド: RemoteAIService のみ）
- [x] `RemoteAIService` が `SettingsReader`（`repo: SettingsReader = settingsRepository`）を注入シームとして持つ
- [x] `resolveProviderSlots` の `(settings[StorageKeys.AI_PROVIDER] as string) || 'gemini'` が撤去され、`DEFAULT_SETTINGS` 経由の値になる
- [x] `generateSummary` の `SUMMARY_MIN_LENGTH || 0` キャストが撤去される
- [x] 既存テスト（RemoteAIService.test.ts）が repo 注入形式に更新され、全パスする
- [x] `npm run type-check` / `npm test` がパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `resolveProviderSlots`: 空の優先度リスト時に DEFAULT_SETTINGS.AI_PROVIDER が使われること（InMemory repo で `AI_PROVIDER` 欠損 → `openai`）
- 注入 repo の `getAll` が呼ばれること（`getSettings` 直呼びが無いこと）

### 統合テスト
- `RemoteAIService × InMemorySettingsRepository`（chrome.storage モック不要）

## 見積もり
1pt（RemoteAIService のみ。残り背景モジュールは後続ラウンド）

## 技術的考慮事項
- `SettingsReader = Pick<SettingsRepository, 'getMany' | 'getAll'>`。RemoteAIService は全量を provider へ渡すため `getAll()` が自然
- 現行 `RemoteAIServiceConfig.getSettings` はテスト注入専用の seam。`repo` 注入へ置き換える
- 既存 `getSettings()` の 30 秒 TTL キャッシュは `SettingsRepository.getAll()`（Chrome パスは getSettings 委譲）により維持される
- スコープ外（後続）: GeminiProvider / obsidianClient / localMarkdownExportCore / reviewSummaryGenerator / privacyPipeline / reviewSummaryAlarm / recordingCache / gistSyncTarget の読み取り移行

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（RemoteAIService ラウンド）
- [ ] コードレビュー完了
- [x] リファクタリング完了（RemoteAIService のキャスト・インラインフォールバック 0 件）
