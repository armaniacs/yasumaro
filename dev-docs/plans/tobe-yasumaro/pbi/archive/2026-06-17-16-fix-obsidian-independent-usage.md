# PBI-16: Obsidian非依存のAIテスト・録画動作

## ユーザーストーリー

ObsidianユーザーでないAIプロバイダー利用者として、AIプロバイダー（Gemini/OpenAI等）を設定しただけでAIテストが通り、AI要約付きで記録され、ダッシュボードのSQLite履歴に記録が表示されるようにしたい。なぜなら、Obsidianはオプション機能であり、AI要約とブラウジング履歴記録は独立して利用可能であるべきだから。

## ビジネス価値

- **利用者層の拡大**: Obsidian未導入ユーザーでも拡張機能が利用可能になる
- **オンボーディング改善**: 最初の設定ステップ（AIプロバイダー設定→テスト）がスムーズに完了する
- **機能の独立性**: 各機能（AI要約、SQLite履歴、Obsidian同期）が独立して動作する

## 調査結果（フェーズ0）

### 発見された問題

| # | 問題 | 影響 | 場所 |
|---|------|------|------|
| 1 | AIテストボタンが保存前の設定で実行される | 401エラー | `dashboard.ts:handleTestAi` |
| 2 | `saveObsidian` ステップがRETRY戦略で失敗時にパイプライン停止 | SQLite保存に到達しない | `RecordingPipeline.ts:steps` |
| 3 | `saveToObsidianStep` に未設定スキップロジックがない | Obsidian未設定で全記録失敗 | `pipeline/steps/saveToObsidianStep.ts` |

### 既存コードの確認

- `TEST_AI` メッセージハンドラにObsidian依存なし（正常）
- SQLiteステップには `!this.sqliteClient` チェックでスキップロジックあり（正常）
- Obsidianステップには同等のスキップロジックなし（問題）

## BDD受け入れシナリオ

```gherkin
Scenario: AIプロバイダーのみ設定してAIテストが成功する
  Given ユーザーがダッシュボードの初期設定ページを開いている
  And   Obsidian API Key が空である
  And   AIプロバイダーが "Google Gemini" に設定されている
  And   Gemini API Key が有が有効な値で入力されている
  When  ユーザーが「AI テスト」ボタンをクリックする
  Then  設定が自動的に保存される
  And   「AI: 接続成功」と表示される
  And   エラーメッセージ「AI: Connection error: HTTP 401:」が表示されない

Scenario: AIプロバイダーのみ設定で記録がSQLiteに保存される
  Given Obsidian API Key が空である
  And   AIプロバイダーが有効に設定されている
  And   プライバシー同意が完了している
  When  ユーザーがWebページを閲覧して記録条件を満たす
  Then  AI要約が生成される
  And   SQLiteに記録が保存される
  And   ダッシュボードのSQLite履歴に記録が表示される
  And   エラーが発生しない（Obsidian未設定でも記録が失敗しない）

Scenario: Obsidian未設定で録画パイプラインが正常に完了する
  Given Obsidian API Key が空である
  And   AIプロバイダーが有効に設定されている
  When  録画パイプラインが実行される
  Then  saveObsidian ステップがスキップされる
  And   saveSqlite ステップが実行される
  And   saveMetadata ステップが実行される
  And   パイプラインが成功で完了する

Scenario: AIテストで無効なAPIキーが入力されている場合
  Given AIプロバイダーが "Google Gemini" に設定されている
  And   Gemini API Key が "invalid-key" に設定されている
  When  ユーザーが「AI テスト」ボタンをクリックする
  Then  「AI: Authentication failed (401). Check your Gemini API key.」と表示される
```

## 受け入れ基準

- [ ] AIテストボタン押下時に設定が自動保存され、ストレージから正しいAPIキーが読み取れる
- [ ] Obsidian API Key が空でもAIテストが実行でき、結果が正しく表示される
- [ ] `saveToObsidianStep` がObsidian未設定時にスキップされ、エラーをスローしない
- [ ] `saveObsidian` ステップ失敗時にパイプラインが停止せず、`saveSqlite` に到達する
- [ ] 既存のObsidian設定済みユーザーの動作が変更されない（後方互換性）
- [ ] 全BDDシナリオが自動テストとして実装されパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト（1件）
- ダッシュボードでAIプロバイダー設定→テスト→成功確認

### 統合テスト（3件）
- `handleTestAi` が保存後にTEST_AIメッセージを送信すること
- `RecordingPipeline` がObsidian未設定時にsaveSqliteまで到達すること
- `saveToObsidianStep` がObsidian未設定時にコンテキストを返すこと

### 単体テスト（5件）
- `handleTestAi` の自動保存ロジック
- `saveToObsidianStep` のObsidian設定チェック
- `RecordingPipeline` のステップ実行順序
- エラー戦略の分岐ロジック
- 後方互換性（設定済み時の動作）

## 実装アプローチ（完了）

### 実装済みの変更

#### Step 1: AIテストボタンの自動保存（`src/dashboard/dashboard.ts`）

`handleTestAi` 関数内で、`testAiConnection()` を呼び出す前に `extractSettingsFromInputs(getSettingsMapping())` で設定を抽出し `saveSettingsWithAllowedUrls()` で保存するよう修正。

```typescript
// handleTestAi 内に追加
const newSettings = extractSettingsFromInputs(getSettingsMapping());
const currentSettings = await getSettings();
const mergedSettings = { ...currentSettings, ...newSettings };
await saveSettingsWithAllowedUrls(mergedSettings);
```

#### Step 2: saveToObsidianStep に設定チェック追加（`src/background/pipeline/steps/saveToObsidianStep.ts`）

DI注入された `obsidian` パラメータがない場合のみ、`context.settings` から `obsidian_api_key` を確認。APIキーが16文字未満または未設定の場合はスキップ。

```typescript
if (!obsidian) {
    const settings = context.settings as Record<string, unknown>;
    const obsidianApiKey = settings[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
    if (!obsidianApiKey || obsidianApiKey.length < 16) {
        addLog(LogType.INFO, 'Obsidian not configured, skipping save', { url });
        return context;
    }
}
```

#### Step 3: saveObsidian ステップのエラー戦略変更（`src/background/pipeline/RecordingPipeline.ts`）

`RETRY` → `BEST_EFFORT` に変更。Obsidian接続エラー時もパイプラインが継続し、SQLite保存が実行される。

```typescript
// 変更後
{ name: 'saveObsidian', errorStrategy: ErrorStrategy.BEST_EFFORT, execute: this.createSaveToObsidianStep() }
```

## 見積もり

**5 SP**（小〜中規模の修正、テスト実装含む）

## 技術的考慮事項

- **依存関係**: なし（既存モジュールの再利用）
- **テスタビリティ**: `chrome.storage.local.get` はモック可能
- **非機能要件**: パイプラインのパフォーマンスに影響なし（スキップは軽量）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（該当する場合）
