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

### 残課題一覧

#### 🔴 優先度: 高

- **HMAC署名バイパスの警告強化**
  - ファイル: `src/utils/settingsExportImport.ts:177-179`
  - 内容: 署名フィールドを省略するだけでHMAC検証をバイパスできる。署名なしの場合はインポートを拒否するか、ユーザーに強い警告ダイアログを表示する

- **i18nキー `confirm` の欠落**
  - ファイル: `src/popup/popup.html:461`, `_locales/en/messages.json`, `_locales/ja/messages.json`
  - 内容: インポートボタンが翻訳されない。`"confirm"` キーをen/ja両方のmessages.jsonに追加

- **i18nキー `errorInvalidUrl` の欠落**
  - ファイル: `src/popup/settings/fieldValidation.ts:148`
  - 内容: URL検証エラーが英語のみ表示。`"errorInvalidUrl"` キーをen/ja両方に追加

- **`<label>` の `for` 属性と `<input>` の `id` 紐付け（約15箇所）**
  - ファイル: `src/popup/popup.html:95-148, 201, 234, 244, 256`
  - 内容: スクリーンリーダーユーザーがラベルをクリックしてフォーカス移動できない。WCAG 1.3.1 Level A 未達成
  - 対象フィールド: aiProvider, geminiApiKey, geminiModel, openaiBaseUrl, openaiApiKey, openaiModel, openai2系, domainFilter系

- **`setActivePrompt` のスコープ制御バグ**
  - ファイル: `src/utils/customPromptUtils.ts:224-236`
  - 内容: Gemini固有プロンプトをアクティブにすると、OpenAI用の `all` プロンプトも無効化される。意図しない排他制御になっている可能性が高い

#### 🟡 優先度: 中

- **`getSettings()` 呼び出しの重複（パフォーマンス）**
  - ファイル: `src/background/recordingLogic.ts`, `src/utils/domainUtils.ts`, `src/background/ai/aiClient.ts`, `src/background/ai/providers/GeminiProvider.ts`, `src/background/ai/providers/OpenAIProvider.ts`
  - 内容: 1回の `record()` で最大4回の `getSettings()` が呼ばれ、AES-GCM復号が重複実行される。`record()` で取得した settings を引数として各モジュールに渡す設計に変更することで最大75%削減可能

- **loggerのstorage毎回読み書き**
  - ファイル: `src/utils/logger.ts:36-58`
  - 内容: `addLog` 呼び出しごとに `chrome.storage.local.get` + `set` が実行される。メモリバッファに蓄積して一定間隔でフラッシュするバッチ書き込みに変更すべき

- **`extractor.ts` の設定読み込みがマイグレーション後に機能しない可能性**
  - ファイル: `src/content/extractor.ts:55`
  - 内容: `chrome.storage.local.get(['min_visit_duration', 'min_scroll_depth'])` と個別キーで直接アクセスしているが、マイグレーション後は `settings` キー下に統合されるため、ユーザーのカスタム値が反映されない恐れがある

- **`globalThis.reviewLogs` の本番コードへの露出**
  - ファイル: `src/utils/logger.ts:91-99`
  - 内容: デバッグ用のログ閲覧関数がグローバルに公開されている。本番ビルドから除去するか、開発時のみ有効にする

- **`errorUtils.ts:338` の「秒」ハードコード**
  - ファイル: `src/utils/errorUtils.ts:338`
  - 内容: `return \`${(ms / 1000).toFixed(1)}秒\`` が英語環境で日本語表示される。messages.jsonにキーを追加して切り替える

- **`showImportPreview` のハードコード文字列**
  - ファイル: `src/popup/popup.ts:308-309`
  - 内容: "Summary:" と "Note: Full settings will be applied..." が英語ハードコード。messages.jsonに追加する

- **`<header id="mainScreen">` のセマンティック誤用**
  - ファイル: `src/popup/popup.html:14`
  - 内容: 画面全体のコンテナに `<header>` を使用しているのはセマンティック上不適切。`<div id="mainScreen">` に変更すべき

- **確認モーダルの `aria-labelledby` 参照先に `id` がない**
  - ファイル: `src/popup/popup.html:419`
  - 内容: `aria-labelledby="confirmContent"` だが `data-i18n="confirmContent"` は id ではないため機能していない。`<h3 id="confirmContent" data-i18n="confirmContent">` のように明示的に `id` を追加する

- **`domainFilter.ts:222` のCSS Selector Injection**
  - ファイル: `src/popup/domainFilter.ts:222`
  - 内容: `mode` をそのままCSSセレクターに埋め込んでいる。`whitelist`/`blacklist`/`disabled` の許可リストでバリデーションを追加する

#### 🟢 優先度: 低

- **`aiClient.ts` の `@deprecated` メソッド削除**
  - ファイル: `src/background/ai/aiClient.ts:117-295`
  - 内容: `generateGeminiSummary()`, `generateOpenAISummary()` 等4つが `@deprecated` だが残存。約180行。新プロバイダー移行完了後に削除

- **scrollイベントのthrottle化**
  - ファイル: `src/content/extractor.ts:198`
  - 内容: scrollイベントにdebounce/throttleがなく、高速スクロール時に大量の `updateMaxScroll` 呼び出しが発生する。`requestAnimationFrame` または100-200msのthrottleを適用する

- **`setSavedUrlsWithTimestamps` の二重楽観的ロック**
  - ファイル: `src/utils/storage.ts:608-619`
  - 内容: `withOptimisticLock` が2回呼ばれ、1回のURL保存で最大6〜30回のstorage I/Oが発生する可能性がある。1回のロックで統合する

- **`Settings` 型の厳格化**
  - ファイル: `src/utils/storage.ts:130-132`
  - 内容: `Settings` が `{ [key: string]: any }` で型安全性が低く、`as any` キャストが37箇所に散在。`StorageKeys` の値に対応するMapped Typeへの段階的移行を検討

- **翻訳品質の軽微な改善**
  - `autoClosing` (ja): "自動閉じる..." → "自動的に閉じています..."
  - `privacyMode` (ja): "動作モード" → "プライバシーモード"

### 注意事項（設計確認が必要な点）

- **`{{content}}` プレースホルダー省略時の挙動**: カスタムプロンプトに `{{content}}` がない場合、ページコンテンツがAIに送られない（`customPromptUtils.ts:73-75`）。これが仕様通りか確認が必要
- **deprecated メソッドの利用箇所**: `aiClient.ts` の `generateGeminiSummary()` / `generateOpenAISummary()` が現在呼ばれている場合、カスタムプロンプトが適用されない