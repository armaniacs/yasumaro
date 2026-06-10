# タグ機能実装計画

## 1. 機能要件

### 1.1 データ保存要件
- `SavedUrlEntry` に `tags?: string[]` プロパティを追加
- 1つのURLに1〜2個のタグを付与可能
- 既存データのタグは `undefined` （空配列との区別が必要）
- 楽観的ロック機構で安全に更新

### 1.2 AI要約時のタグ付与要件
- 新しいプロンプトタイプ「タグ付き要約」を追加
- 10個のデフォルトカテゴリを認識
- 出力形式: `#カテゴリ1 #カテゴリ2 | 要約文`
- AI出力からタグを正規表現でパース
- パースに失敗した場合は従来通りの要約として扱う

### 1.3 ダッシュボード表示要件
- 履歴リストの各行にタグをバッジとして表示
- URLとタイムスタンプの間に配置
- クリックしてタグによるフィルタリング
- 詳細パネル（将来的に追加可能）にもタグ表示

### 1.4 タグ編集要件
- 各履歴エントリに「タグ編集」ボタン（または編集モード）
- 既存タグの削除
- カテゴリリストから新規タグの追加
- 変更は即座に保存

### 1.5 カテゴリ管理要件
- デフォルトカテゴリ（10個）を定数として管理
- ユーザーがカテゴリを追加可能
- 設定画面でカテゴリの一覧・追加・削除
- デフォルトカテゴリの削除は禁止

### 1.6 フィルタリング要件
- タグをクリックすると、そのタグを持つエントリのみ表示
- フィルター解除ボタン
- 既存のフィルター（すべて、自動、手動など）と組み合わせ可能

## 2. データ構造

### 2.1 SavedUrlEntryの拡張
```typescript
// src/utils/storageUrls.ts
export interface SavedUrlEntry {
    url: string;
    timestamp: number;
    recordType?: RecordType;
    maskedCount?: number;
    tags?: string[];  // 新規追加
}
```

### 2.2 タグ設定のストレージキー
```typescript
// src/utils/storage.ts
export const StorageKeys = {
    // ... 既存のキー
    TAG_CATEGORIES: 'tag_categories',  // ユーザー追加カテゴリ + デフォルト管理
    TAG_SUMMARY_MODE: 'tag_summary_mode',  // タグ付き要約を使用するか
} as const;
```

### 2.3 TagCategoryインターフェース
```typescript
// 新規ファイル: src/utils/tagUtils.ts
export interface TagCategory {
    name: string;
    isDefault: boolean;  // デフォルトカテゴリかどうか
    createdAt: number;
}
```

### 2.4 デフォルトカテゴリ定数
```typescript
// 新規ファイル: src/utils/tagUtils.ts
export const DEFAULT_CATEGORIES = [
    'IT・プログラミング',
    'インフラ・ネットワーク',
    'サイエンス・アカデミック',
    'ビジネス・経済',
    'ライフスタイル・雑記',
    'フード・レシピ',
    'トラベル・アウトドア',
    'エンタメ・ゲーム',
    'クリエイティブ・アート',
    'ヘルス・ウェルネス',
] as const;
```

## 3. 実装ステップ

### ステップ1: データ構造と型定義
- `src/utils/types.ts` に `TagCategory` インターフェースを追加
- `src/utils/storage.ts` に `TAG_CATEGORIES`、`TAG_SUMMARY_MODE` キーを追加
- `src/utils/storageUrls.ts` の `SavedUrlEntry` に `tags?: string[]` を追加
- 楽観的ロック関数 `setUrlTags(url: string, tags: string[]): Promise<void>` を追加
- 楽観的ロック関数 `addTag(url: string, tag: string): Promise<void>` を追加
- 楽観的ロック関数 `removeTag(url: string, tag: string): Promise<void>` を追加

### ステップ2: タグ管理ユーティリティの作成
- `src/utils/tagUtils.ts` を新規作成
- `DEFAULT_CATEGORIES` 定数の定義
- `getDefaultCategories(): TagCategory[]` 関数
- `getAllCategories(settings: Settings): string[]` 関数
- `isValidCategory(category: string, settings: Settings): boolean` 関数
- `parseTagsFromSummary(summary: string): { tags: string[]; summary: string }` 関数
  - 正規表現 `/^([^|]+)\|(.+)$/` でタグ部分と要約部分を分離
  - `/#(\S+)/g` でタグを抽出
  - タグが存在しない場合は空配列と全文を返す

### ステップ3: AIプロンプト機能の拡張
- `src/utils/customPromptUtils.ts` にタグ付き要約用デフォルトプロンプトを追加
  ```typescript
  export const DEFAULT_TAGGED_SUMMARY_PROMPT = `以下のWebページの内容を分析し、指定したカテゴリから最も関連度の高いものを1つまたは2つ選んでタグ形式で出力し、その後に日本語で簡潔に要約してください。

カテゴリ候補:
[IT・プログラミング, インフラ・ネットワーク, サイエンス・アカデミック, ビジネス・経済, ライフスタイル・雑記, フード・レシピ, トラベル・アウトドア, エンタメ・ゲーム, クリエイティブ・アート, ヘルス・ウェルネス]

出力形式:
#カテゴリ1 #カテゴリ2 | 要約文（改行なし）

Content:
{{content}}`;
  ```
- `applyCustomPrompt` 内でタグ付き要約モードを判定して適切なプロンプトを選択するロジックを追加

### ステップ1: データ構造と型定義 ✅ **完了**
- `src/utils/types.ts` に `TagCategory` インターフェースを追加 ✅
- `src/utils/storage.ts` に `TAG_CATEGORIES`、`TAG_SUMMARY_MODE` キーを追加 ✅
- `src/utils/storage.ts` に `STORAGE_DEFAULT_VALUES` にタグ関連のデフォルト値を追加 ✅
- `src/utils/storageSettings.ts` に `SettingsValue` にタグ関連フィールドを追加 ✅
- `src/utils/storageSettings.ts` に `DEFAULT_SETTINGS` にタグ関連のデフォルト値を追加 ✅
- `src/utils/storageUrls.ts` の `SavedUrlEntry` に `tags?: string[]` を追加 ✅
- `setSavedUrlsWithTimestamps` と `updateUrlTimestamp` でタグを保持するように修正 ✅
- 楽観的ロック関数 `setUrlTags(url: string, tags: string[]): Promise<void>` を追加 ✅
- 楽観的ロック関数 `addUrlTag(url: string, tag: string): Promise<void>` を追加 ✅
- 楽観的ロック関数 `removeUrlTag(url: string, tag: string): Promise<void>` を追加 ✅

### ステップ2: タグ管理ユーティリティの作成 ✅ **完了**
- `src/utils/tagUtils.ts` を新規作成 ✅
- `DEFAULT_CATEGORIES` 定数の定義（10種類のカテゴリ）✅
- `getDefaultCategories(): TagCategory[]` 関数 ✅
- `getAllCategories(settings: Settings): string[]` 関数 ✅
- `isValidCategory(category: string, settings: Settings): boolean` 関数 ✅
- `parseTagsFromSummary(summary: string): { tags: string[]; summary: string }` 関数 ✅
  - 正規表現 `/^([^|]+)\|(.+)$/` でタグ部分と要約部分を分離 ✅
  - `/#(\S+)/g` でタグを抽出 ✅
  - タグが存在しない場合は空配列と全文を返す ✅

### ステップ3: AIプロンプト機能の拡張 ✅ **完了**
- `src/utils/customPromptUtils.ts` にタグ付き要約用デフォルトプロンプトを追加 ✅
  ```typescript
  export const DEFAULT_TAGGED_SUMMARY_PROMPT = `以下のWebページの内容を分析し、指定したカテゴリから最も関連度の高いものを1つまたは2つ選んでタグ形式で出力し、その後に日本語で簡潔に要約してください。

カテゴリ候補:
[IT・プログラミング, インフラ・ネットワーク, サイエンス・アカデミック, ビジネス・経済, ライフスタイル・雑記, フード・レシピ, トラベル・アウトドア, エンタメ・ゲーム, クリエイティブ・アート, ヘルス・ウェルネス]

出力形式:
#カテゴリ1 #カテゴリ2 | 要約文（改行なし）

Content:
{{content}}`;
  ```
- `applyCustomPrompt` に `tagSummaryMode` パラメータを追加 ✅
- タグ付き要約モードの場合は `DEFAULT_TAGGED_SUMMARY_PROMPT` を使用 ✅

### ステップ4: 要約結果のパースとタグ保存 ✅ **完了**
- `src/background/ai/providers/ProviderStrategy.ts` の `generateSummary` に `tagSummaryMode` パラメータを追加 ✅
- `src/background/ai/providers/GeminiProvider.ts` の `generateSummary` に `tagSummaryMode` パラメータを追加 ✅
- `src/background/ai/providers/OpenAIProvider.ts` の `generateSummary` に `tagSummaryMode` パラメータを追加 ✅
- `src/background/aiClient.ts` の `generateSummary` に `tagSummaryMode` パラメータを追加 ✅
- `src/background/privacyPipeline.ts` に `tagSummaryMode` オプションと `tags` 戻り値を追加 ✅
- `src/background/recordingLogic.ts` にタグ保存ロジックを追加 ✅
- 要約生成時にタグ付き要約モードが有効なら `PrivacyPipelineResult.tags` を使用 ✅
- `pipelineResult.tags` が存在する場合は `setUrlTags` でタグを保存 ✅

### ステップ5: ダッシュボードHTML/CSSの追加 ✅ **完了**
- `src/dashboard/dashboard.html`:
  - タグ編集モーダル `#tagEditModal` を追加 ✅
  - タグ編集モーダル内の要素（URL表示、現在のタグリスト、カテゴリセレクト、追加・保存ボタン）を追加 ✅
- `src/dashboard/dashboard.css`:
  - 履歴エントリのタグバッジスタイル（`.tag-badge`, `.tag-badges`）を追加 ✅
  - タグ編集モーダルスタイル（`.tag-edit-modal`, `.current-tags-list`, `.tag-category-select`）を追加 ✅
  - タグフィルターインジケータースタイル（`.tag-filter-indicator`）を追加 ✅

### ステップ6: ダッシュボードTypeScriptの拡張 ✅ **完了**
- `src/dashboard/dashboard.ts` の `initHistoryPanel` 関数を拡展:
  - `makeTagBadges()` 関数を追加 ✅
  - `updateTagFilterIndicator()` 関数を追加 ✅
  - `applyFilters()` 関数内でタグフィルタリングを追加 ✅
  - タグ編集モーダルの実装（`openTagEditModal`, `closeTagEditModal`, `renderCurrentTags`, `updateTagCategorySelect`, `addTag`, `saveTagEdits`）✅
  - 履歴エントリの編集ボタンを追加 ✅
  - タグフィルターのリセット機能（フィルターボタン・検索ボックス操作時）✅

### ステップ7: 設定画面にタグ設定を追加 ✅ **完了**
- `src/dashboard/dashboard.html`:
  - サイドバーに [Tags] ナビゲーションボタンを追加 ✅
  - `panel-tags` パネルを追加 ✅
  - タグ付き要約モードトグルを追加 ✅
  - デフォルトカテゴリ表示エリアを追加 ✅
  - ユーザーカテゴリ管理エリアを追加（リスト、追加フォーム）✅
- `src/dashboard/dashboard.css`:
  - タグカテゴリリストスタイル（`.tag-categories-list`, `.tag-categories-user-list`）を追加 ✅
- `src/dashboard/dashboard.ts`:
  - `initTagsPanel()` 関数を追加 ✅
  - デフォルトカテゴリ表示機能を追加 ✅
  - ユーザーカテゴリの追加・削除機能を追加 ✅
  - 重複カテゴリチェックを追加 ✅
  - 設定の保存・読み込み機能を追加 ✅
- `src/background/service-worker.ts` の MANUAL_RECORD ハンドラーを修正
- `src/background/obsidianClient.ts` または要約生成部分で `parseTagsFromSummary` を使用
- 要約生成時にタグ付き要約モードが有効なら `parseTagsFromSummary` でパース
- `addSavedUrl` 呼び出し後に `setUrlTags` を呼び出してタグを保存
- 既存の `addSavedUrl` 関数の戻り値を確認し、成功後にタグ保存を行う

### ステップ5: ダッシュボードHTML/CSSの追加
- `src/dashboard/dashboard.html`:
  - Historyパネルにタグの読み込み用コンテナは動的生成のため不要
  - タグ編集モーダルを追加
- `src/dashboard/dashboard.css`:
  - 履歴エントリのタグバッジスタイル
  - タグ編集モーダルスタイル（既存のモーダルスタイルを流用）

### ステップ6: ダッシュボードTypeScriptの拡張
- `src/dashboard/dashboard.ts` の `initHistoryPanel` 関数を拡張:
  - `makeTagsBadge(entry: SavedUrlEntry): HTMLElement | null` 関数を追加
  - `applyFilters` 関数内でタグフィルタリングを追加
  - タグ編集モーダルの開閉を実装
  - `initTagEditModal()` 関数
  - `saveTagEdits(url: string, newTags: string[]): Promise<void>` 関数

### ステップ7: 設定画面にタグ設定を追加
- `src/dashboard/dashboard.html`:
  - 新しいパネル `panel-tags` を追加
  - タグ付き要約の有効/無効トグル
  - カスタムカテゴリの追加・削除UI
- `src/dashboard/dashboard.ts`:
  - `initTagSettingsPanel()` 関数
  - タグ付き要約モードの読み込み・保存
  - カテゴリリストの表示・編集
  - カテゴリ追加のバリデーション（重複チェック）

### ステップ8: i18nの追加
- `_locales/en/messages.json` にタグ関連翻訳を追加
- `_locales/ja/messages.json` に日本語訳を追加

### ステップ9: テストと検証
- ユニットテスト:
  - `parseTagsFromSummary` の各種パターン（正常、異常、複数タグ）
  - `isValidCategory` のバリデーション
  - タグ管理関数の楽観的ロック
- 統合テスト:
  - タグ付き要約の生成とパース
  - ダッシュボードでのタグ表示とフィルタリング
  - タグの編集と保存

### ステップ10: 既存データのマイグレーション
- `src/utils/migration.ts` にタグ機能の初期化ロジックを追加
- アプリ起動時に `DEFAULT_CATEGORIES` が設定に存在しない場合は初期化

## 4. ファイル変更一覧

### 新規作成ファイル
1. `/Users/yaar/Playground/obsidian-smart-history/src/utils/tagUtils.ts` - タグ管理ユーティリティ（デフォルトカテゴリ、パース関数）

### 既存ファイル変更
2. `/Users/yaar/Playground/obsidian-smart-history/src/utils/types.ts` - TagCategoryインターフェース追加
3. `/Users/yaar/Playground/obsidian-smart-history/src/utils/storage.ts` - ストレージキー追加
4. `/Users/yaar/Playground/obsidian-smart-history/src/utils/storageUrls.ts` - SavedUrlEntry拡張、タグ管理関数追加
5. `/Users/yaar/Playground/obsidian-smart-history/src/utils/customPromptUtils.ts` - タグ付き要約プロンプト追加
6. `/Users/yaar/Playground/obsidian-smart-history/src/background/service-worker.ts` - 要約パースとタグ保存ロジック追加
7. `/Users/yaar/Playground/obsidian-smart-history/src/dashboard/dashboard.html` - タグ編集モーダル、タグ設定パネル追加
8. `/Users/yaar/Playground/obsidian-smart-history/src/dashboard/dashboard.css` - タグバッジ、モーダルスタイル追加
9. `/Users/yaar/Playground/obsidian-smart-history/src/dashboard/dashboard.ts` - タグ表示、編集、フィルタリングロジック追加
10. `/Users/yaar/Playground/obsidian-smart-history/_locales/en/messages.json` - タグ関連翻訳追加
11. `/Users/yaar/Playground/obsidian-smart-history/_locales/ja/messages.json` - タグ関連翻訳追加
12. `/Users/yaar/Playground/obsidian-smart-history/src/utils/migration.ts` - タグ機能初期化ロジック追加

## 5. UI設計

### 5.1 履歴リスト行

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [自動] [🔒 3] [#サイエンス・アカデミック] https://example.com/article         │
│ 2026/02/26 10:30:00                                                          │
│                                                             [×]              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 タグフィルタリング時

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Search: [_________________] [すべて] [自動] [手動] [スキップ] [🔒 マスクあり] │
│                                            ↓ [× フィルター解除: IT・プログラミング] │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5 / 42                                                                      │
│ ┌─────────────────────────────────────────────────────────────────────────┐│
│ │ [自動] [#IT・プログラミング] ...                                        ││
│ │ [手動] [#IT・プログラミング] ...                                        ││
│ └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 タグ編集モーダル

```
┌─────────────────────────────────────────────┐
│ タグを編集                        [×]      │
├─────────────────────────────────────────────┤
│                                             │
│ 現在のタグ                                   │
│ ┌───────────────────────────────────────┐  │
│ │ #サイエンス・アカデミック     [×]     │  │
│ └───────────────────────────────────────┘  │
│                                             │
│ タグを追加                                  │
│ ┌───────────────────────────────────────┐  │
│ │ IT・プログラミング               ▼   │  │
│ ├───────────────────────────────────────┤  │
│ │ インフラ・ネットワーク                 │  │
│ │ サイエンス・アカデミック               │  │
│ │ ビジネス・経済                         │  │
│ │ ユーザー追加カテゴリ                   │  │
│ └───────────────────────────────────────┘  │
│            [追加]                          │
│                                             │
├─────────────────────────────────────────────┤
│                                     [閉じる] │
└─────────────────────────────────────────────┘
```

### 5.4 タグ設定パネル

```
┌───────────────────────────────────────────────────────────────┐
│ 最 タグ                                                        │
│                                                               │
│ タグ付き要約機能                                                │
│                                                               │
│ [    ] タグ付き要約を使用                                        │
│    要約生成時にカテゴリを自動付与                                │
│                                                               │
│ ───────────────────────────────────────────────────────────── │
│ タグカテゴリ                                                   │
│                                                               │
│ デフォルトカテゴリ                                              │
│ (デフォルトカテゴリは削除できません)                            │
│                                                               │
│ IT・プログラミング, インフラ・ネットワーク, ... (全10件)         │
│                                                               │
│ ───────────────────────────────────────────────────────────── │
│                                                             │
│ ユーザーカテゴリ                                                 │
│                                                               │
│ [MyTag1] [削除]                                                │
│ [MyTag2] [削除]                                                │
│                                                               │
│ [________] [追加]                                              │
│ (重複エラー等のメッセージ表示)                                  │
│                                                               │
│                                     [保存する]                  │
└───────────────────────────────────────────────────────────────┘
```

---

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:

- `/Users/yaar/Playground/obsidian-smart-history/src/utils/storageUrls.ts` - Core data structure extension with SavedUrlEntry.tags field and tag management functions with optimistic locking
- `/Users/yaar/Playground/obsidian-smart-history/src/dashboard/dashboard.ts` - Main UI logic for rendering tags in history list, filter handling, and tag editing modal
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/tagUtils.ts` - New file for tag-related utilities including DEFAULT_CATEGORIES constant and parseTagsFromSummary function
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/customPromptUtils.ts` - To add DEFAULT_TAGGED_SUMMARY_PROMPT and integrate with existing custom prompt system
- `/Users/yaar/Playground/obsidian-smart-history/src/background/service-worker.ts` - To parse tags from AI summary response and save them after URL recording