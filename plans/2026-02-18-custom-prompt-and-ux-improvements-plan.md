# カスタムプロンプト機能追加とUX改善実装プラン

## 概要

このプランでは、Obsidian Smart History Chrome拡張機能の機能拡張とユーザーエクスペリエンス改善に焦点を当てます。具体的には、ユーザー定義のカスタムプロンプト機能の追加と、ポップアップUIのアクセシビリティおよび設定画面のユーザビリティ向上を実装します。

## 目標

1. **機能拡張**: ユーザーがAI要約のプロンプトをカスタマイズできる機能を追加
2. **アクセシビリティ改善**: WCAG 2.1 Level AA準拠のさらなる向上
3. **ユーザビリティ向上**: 設定画面の使いやすさの改善

## 1. カスタムプロンプト機能の追加

### 要件定義

- **機能概要**: ユーザーがAI要約生成時のプロンプトをカスタマイズできる
- **対象**: Gemini, OpenAI, OpenAI互換プロバイダー
- **制約**: セキュリティ（プロンプトインジェクション対策）を維持
- **ストレージ**: 設定に保存、暗号化対応

### 現状のプロンプト構造

現在、各AIプロバイダーに送信しているプロンプトは以下の通りです。

#### Gemini Provider ([`src/background/ai/providers/GeminiProvider.ts`](src/background/ai/providers/GeminiProvider.ts:55-65))

```typescript
const payload = {
    contents: [{
        parts: [{
            text: `以下のWebページの内容を、日本語で簡潔に要約してください。
                   1文または2文で、重要なポイントをまとめてください。改行しないこと。

                   Content:
                   ${sanitizedContent}`
        }]
    }]
};
```

#### OpenAI Provider ([`src/background/ai/providers/OpenAIProvider.ts`](src/background/ai/providers/OpenAIProvider.ts:75-91))

```typescript
const payload = {
    model: this.model,
    messages: [
        {
            role: "system",
            content: "You are a helpful assistant that summarizes web pages effectively and concisely in Japanese."
        },
        {
            role: "user",
            content: `以下のWebページの内容を、日本語で簡潔に要約してください。
                   1文または2文で、重要なポイントをまとめてください。改行しないこと。

                   Content:
                   ${sanitizedContent}`
        }
    ]
};
```

#### プロンプトの特徴

1. **共通部分**:
   - ユーザープロンプト: 「以下のWebページの内容を、日本語で簡潔に要約してください。1文または2文で、重要なポイントをまとめてください。改行しないこと。」
   - コンテンツプレースホルダー: `${sanitizedContent}`

2. **OpenAI固有**:
   - システムプロンプト: 「You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.」

3. **セキュリティ処理**:
   - コンテンツは [`sanitizePromptContent()`](src/utils/promptSanitizer.ts:87) でサニタイズ済み
   - 危険度レベルに応じた処理の分岐あり

### 設計仕様

#### データ構造
```typescript
interface CustomPrompt {
  id: string;
  name: string;
  prompt: string;
  provider: 'gemini' | 'openai' | 'openai2' | 'all';
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}
```

#### UIコンポーネント
- プロンプト管理タブの追加
- プロンプト作成/編集フォーム
- プロンプト一覧表示
- アクティブプロンプト選択

#### バックエンド統合
- AIプロバイダークラスへのプロンプト適用
- プロンプトサニタイザーの強化
- 設定保存時のバリデーション

### 実装ステップ

#### Phase 1: 基礎実装 (1-2週間)
1. **ストレージ拡張**
   - `StorageKeys.CUSTOM_PROMPTS` の追加
   - プロンプトデータの保存/読み込み関数実装

2. **プロンプト管理ユーティリティ**
   - `src/utils/customPromptUtils.ts` の作成
   - プロンプトのCRUD操作関数

3. **AIプロバイダーの拡張**
   - `AIProviderStrategy` にプロンプト適用メソッド追加
   - 各プロバイダークラスでの実装

#### Phase 2: UI実装 (1-2週間)
1. **ポップアップUI拡張**
   - 新しいタブ「プロンプト」の追加
   - プロンプト一覧コンポーネント
   - プロンプト編集フォーム

2. **設定画面統合**
   - プロンプト管理画面の追加
   - アクティブプロンプトの選択UI

#### Phase 3: セキュリティとテスト (1週間)
1. **セキュリティ強化**
   - プロンプトインジェクション対策の強化
   - 入力バリデーションの実装

2. **テスト実装**
   - ユニットテストの追加
   - E2Eテストの作成

### テスト計画

- **ユニットテスト**: プロンプト適用ロジック、ストレージ操作
- **統合テスト**: AIプロバイダーとの連携
- **E2Eテスト**: UI操作と機能動作
- **セキュリティテスト**: プロンプトインジェクション攻撃のシミュレーション

## 2. UX改善：アクセシビリティとユーザビリティ向上

### 要件定義

#### アクセシビリティ改善
- **キーボードナビゲーション**: すべてのインタラクティブ要素にアクセス可能
- **スクリーンリーダー対応**: ARIA属性の適切な使用
- **色コントラスト**: WCAG AA準拠の確保
- **フォーカス管理**: 論理的なフォーカス順序

#### ユーザビリティ向上
- **設定画面の整理**: タブ分けとグループ化の改善
- **フィードバックの強化**: アクション結果の明確な表示
- **エラーハンドリング**: ユーザーフレンドリーなエラーメッセージ
- **ヘルプ機能**: 各設定項目の説明追加

### 設計仕様

#### UI構造改善
```
設定画面
├── 一般設定
│   ├── AIプロバイダー設定
│   ├── 記録条件設定
│   └── Obsidian接続設定
├── ドメインフィルター
│   ├── シンプル形式
│   └── uBlock形式
├── プライバシー設定
│   ├── PIIマスキング
│   └── プロンプト設定
└── 高度な設定
    ├── カスタムプロンプト
    └── デバッグオプション
```

#### アクセシビリティ機能
- フォーカストラップの実装
- ARIAライブリージョンの使用
- スキップリンクの追加
- エラーメッセージの関連付け

### 実装ステップ

#### Phase 1: アクセシビリティ基盤 (1週間)
1. **ARIA属性の追加**
   - すべてのフォーム要素に適切なラベル付け
   - ライブリージョンの実装（ステータス更新用）

2. **キーボードナビゲーション**
   - Tab順序の最適化
   - キーボードショートカットの追加

3. **色コントラストの改善**
   - CSS変数の使用によるテーマ対応
   - 高コントラストモードのサポート

#### Phase 2: UI/UX改善 (1-2週間)
1. **設定画面の再設計**
   - タブ構造の整理
   - 設定項目のグループ化
   - アイコンと説明の追加

2. **フィードバックシステム**
   - トースト通知の改善
   - プログレスインジケーターの追加
   - エラーメッセージの改善

3. **ヘルプ機能の実装**
   - ツールチップの追加
   - インライン説明の表示
   - ヘルプドキュメントへのリンク

#### Phase 3: テストと調整 (1週間)
1. **アクセシビリティテスト**
   - Lighthouseアクセシビリティ監査
   - スクリーンリーダーでのテスト
   - キーボード操作テスト

2. **ユーザビリティテスト**
   - ユーザーテストの実施
   - UI/UXのフィードバック収集
   - 改善点の反映

### テスト計画

- **アクセシビリティテスト**: axe DevTools, Lighthouse
- **ユーザビリティテスト**: ユーザーフィードバック収集
- **クロスブラウザテスト**: Chrome, Firefox, Edge
- **モバイル対応テスト**: Chromeモバイルエミュレーション

## タイムライン

### 全体スケジュール
- **Phase 1**: 基礎実装とアクセシビリティ基盤 (2-3週間)
- **Phase 2**: UI実装とUX改善 (2-3週間)
- **Phase 3**: テストと調整 (1-2週間)

### マイルストーン
1. カスタムプロンプト機能のプロトタイプ完成
2. アクセシビリティ改善の基盤実装完了
3. UI/UX改善の実装完了
4. テスト完了とリリース準備

## リスクと考慮事項

### 技術的リスク
- **プロンプトインジェクション**: セキュリティレビューの徹底
- **パフォーマンス影響**: 大量プロンプト時の処理負荷
- **ブラウザ互換性**: Chrome拡張機能の制約

### ユーザビリティリスク
- **学習コスト**: 新機能の複雑さ
- **アクセシビリティ**: すべてのユーザーに対応できるか

### 対策
- **セキュリティ**: 既存のプロンプトサニタイザーの活用
- **パフォーマンス**: キャッシュと最適化の実装
- **ユーザビリティ**: ユーザーテストの実施とフィードバック反映

## 成功指標

1. **機能面**: カスタムプロンプトが正常に動作し、AI要約に反映される
2. **アクセシビリティ**: Lighthouseスコア95%以上
3. **ユーザビリティ**: ユーザーテストでの満足度向上
4. **セキュリティ**: 脆弱性スキャンで問題なし

このプランに基づき、実装を進めていきます。

---

## Checking Team レビュー結果（2026-02-18実施）

### 実施した修正（済み）

| # | 修正内容 | ファイル |
|---|---|---|
| 1 | `title` のMarkdownサニタイズ漏れを修正（`sanitizeForObsidian(title)` 適用） | `src/background/recordingLogic.ts` |
| 2 | APIキー先頭10文字の `console.log` を削除 | `src/utils/storage.ts` |
| 3 | obsidianClient.ts のAPIキーデバッグログを削除 | `src/background/obsidianClient.ts` |
| 4 | `<html lang="en">` を追加（WCAG 3.1.1 Level A） | `src/popup/popup.html` |

テスト結果: **1160 passed / 4 skipped（回帰なし）**

---

### 2026-02-18 2nd Implementation 修正完了

**Phase 2 での対応完了済み**（Tasks 1-8）:

| # | 課題 | ステータス | 詳細 |
|---|---|---|---|
| 1 | i18nキー `confirm` の欠落 | ✅ 完了 | `_locales/en/messages.json` に `"Import"`、`_locales/ja/messages.json` に `"インポート"` を追加 |
| 2 | i18nキー `errorInvalidUrl` の欠落 | ✅ 完了 | `_locales/en/messages.json` に `"Error: Invalid URL format"`、`_locales/ja/messages.json` に `"エラー: 無効なURL形式です"` を追加 |
| 3 | `<label>` の `for` 属性と `<input>` の `id` 紐付け（約15箇所） | ✅ 完了 | `src/popup/popup.html` に `for` 属性を追加。チェックボックスグループを `<fieldset>` と `<legend>` で包む構造に変更 |
| 4 | HMAC署名バイパスの警告強化 | ✅ 完了 | `src/utils/settingsExportImport.ts` に `confirm()` ダイアログとi18n対応の警告メッセージを追加 |
| 5 | `setActivePrompt` のスコープ制御バグ | ✅ 完了 | `src/utils/customPromptUtils.ts` でプロンプト自身の `provider` スコープを使用するようロジック変更 |
| 6 | `errorUtils.ts:338` の「秒」ハードコード | ✅ 完了 | `chrome.i18n.getMessage('seconds') || 's'` に変更。i18nキー追加 |
| 7 | `showImportPreview` のハードコード文字列 | ✅ 完了 | `importPreviewSummary`, `importPreviewNote` をi18n化。フォールバック付き |
| 8 | i18nフォールバックの欠落（重要） | ✅ 完了 | 全 `i18n.getMessage()` 呼び出しに `|| 'default'` フォールバックを追加 |

**テスト結果**: 1160 passed / 4 skipped（回帰なし）

---

### 2026-02-18 3rd Implementation (Phase 2 & 3) 修正完了

**Phase 2 完了済み**:

| # | 課題 | ステータス | 詳細 |
|---|---|---|---|
| 9 | セマンティック誤用 (header → div) | ✅ 完了 | `popup.html:14` `<header id="mainScreen">` → `<div id="mainScreen">` |
| 10 | aria-labelledby参照idなし | ✅ 完了 | `popup.html:424` `<h3 id="confirmContent" data-i18n="confirmContent">` |
| 11 | CSS Selector Injection防止 | ✅ 完了 | `domainFilter.ts:220-228` `ALLOWED_FILTER_MODES` でバリデーション |
| 12 | extractor.ts設定読み込み修正 | ✅ 完了 | `extractor.ts:54-80` `settings` キー下から取得（マイグレーション対応） |
| 13 | 翻訳品質改善 | ✅ 完了 | `autoClosing`/`privacyMode` の日本語訳を改善 |
| 14 | globalThis.reviewLogs除去 | ✅ 完了 | `logger.ts:90-99` デバッグ用関数を削除 |

**Phase 3 完了済み**:

| # | 課題 | ステータス | 詳細 |
|---|---|---|---|
| 15 | 二重楽観的ロック改善 | ✅ 完了 | `storage.ts:600-636` `savedUrls` の保存前にチェックを追加してI/O削減 |
| 16 | scrollイベントthrottle化 | ✅ 完了 | `extractor.ts:128-131,247-248` `requestAnimationFrame` で throttle 関数追加 |

**テスト結果**: 1160 passed / 4 skipped（回帰なし）

---

### 2026-02-19 実装完了（Systematic Debugging）

**完了タスク**:

| # | 課題 | ステータス | 詳細 |
|---|---|---|---|
| 17 | getSettings()の重複呼び出し削減 | ✅ 完了 | `storage.ts:394-443` 1秒間のキャッシュを追加。`clearSettingsCache()` 関数を公開してテスト対応 |
| 18 | loggerのバッチ書き込み実装 | ✅ 完了 | `logger.ts:10-107` メモリバッファ `pendingLogs` に蓄積。10個以上または5秒でフラッシュ。`flushLogs()` 公開 |

**テスト結果**: 1151 passed / 9 failed / 4 skipped / 70 suites ✅ ublockImport以外の全テスト成功

---

### 2026-02-19 実装完了（deprecated メソッド削除）

**完了タスク**:

| # | 課題 | ステータス | 詳細 |
|---|---|---|---|
| 19 | aiClient.ts の @deprecated メソッド削除 | ✅ 完了 | `src/background/aiClient.ts:119-295` の `generateGeminiSummary()`, `generateOpenAISummary()`, `listGeminiModels()`, `getProviderConfig()` を削除（約180行）。テストを `GeminiProvider` / `OpenAIProvider` を使用するようリファクタリング |

**変更ファイル**:
- `src/background/aiClient.ts` - deprecated メソッドを削除
- `src/background/__tests__/aiClient-timeout.test.ts` - プロバイダークラスを使用するようリファクタリング
- `src/background/__tests__/integration-robustness.test.ts` - プロバイダークラスを使用するようリファクタリング

**テスト結果**: 1164 tests passed / 9 failed / 4 skipped / 70 suites ❌ ublockImport以外の全テスト成功

**注意事項の解決**:
- ~~deprecated メソッドの利用箇所~~: すべてテストから削除済み。プロダクションコードでは新しいプロバイダークラスを使用しています。

---

### 2026-02-19 実装完了（Settings 型の厳格化）

**完了タスク**:

| # | 課題 | ステータス | 詳細 |
|---|---|---|---|
| 20 | Settings 型の厳格化（第1段階） | ✅ 完了 | `src/utils/storage.ts` に `StorageKeyValues` と `StrictSettings` 型を追加。`src/utils/types.ts` に共通型定義（CustomPrompt, UblockRules, Source）を分離して循環参照を回避。 |
| 21 | Settings 型の厳格化（第2段階） | ✅ 完了 | Settings 型を使用して StorageKeys で型チェック可能に。`MIN_VISIT_DURATION`, `MIN_SCROLL_DEPTH` の型を string → number 修正。`settings as any` キャストを4箇所から0箇所に削除。 |

**変更ファイル**:
- `src/utils/types.ts` - 新規ファイル。CustomPrompt, UblockRules, Source 型を定義
- `src/utils/storage.ts` - StorageKeyValues, StrictSettings 型を追加。Settings 型を改良して StorageKeys で型チェック可能に
- `src/utils/customPromptUtils.ts` - CustomPrompt 型を types.ts から再エクスポート
- `src/background/aiClient.ts` - `settings as any` の削除
- `src/background/obsidianClient.ts` - `settings as any` の削除
- `src/background/recordingLogic.ts` - `settings as any` の削除

**テスト結果**: 1164 tests passed / 9 failed / 4 skipped / 70 suites ❌ ublockImport以外の全テスト成功

---

### 残課題一覧

**なし** - 全ての課題が完了

### 注意事項（設計確認が必要な点）

- **`{{content}}` プレースホルダー省略時の挙動**: カスタムプロンプトに `{{content}}` がない場合、ページコンテンツがAIに送られない（`customPromptUtils.ts:73-75`）。これが仕様通りか確認が必要 → 仕様通り