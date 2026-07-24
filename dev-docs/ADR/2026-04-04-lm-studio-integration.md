# LM Studio 統合によるローカルAI対応

## Context

ユーザーがローカルLLMをAIプロバイダーとして使用したいというニーズがある。クラウドAIサービスへの接続なし・API料金なし・データがローカルに留まる環境でページ要約を行いたい。

**現状:**
- OpenAI互換プロバイダー（OpenAI、OpenAI Compatible）はサポート済み
- ローカルAIクライアント（`localAiClient.ts`）はChrome Prompt API専用
- LM Studio APIの専用サポートなし

**要件:**
- LM StudioをAIプロバイダーとして追加する
- LM StudioのOpenAI互換APIエンドポイントを活用する
- 既存のAIプロバイダーアーキテクチャに統合する
- UIに対応する設定を追加する

## Decision

### アーキテクチャ上の判断

1. **既存の `OpenAIProvider` を流用する**:
   - LM StudioはOpenAI互換API（`http://localhost:1234/v1`）を提供している
   - 既存の「openai-compatible」設定をそのまま利用可能
   - 新プロバイダークラスの追加は不要（接続テスト・タイムアウト・エラーハンドリングの重複実装を避ける）

2. **LM Studio用のデフォルト設定**:
   - Base URL: `http://localhost:1234/v1`
   - APIキー: 不要（ローカル動作のため）
   - モデル: LM Studioで読み込んだモデルをユーザーが手動入力

3. **ローカルURL検出によるコンテンツサイズ制限**（決定当時の設計案。実際の実装値は下記「ローカルURL検出ロジック」の注記を参照）:
   - `localhost` / `127.0.0.1` / プライベートIPの場合、送信コンテンツを **4,000文字に自動制限**
   - 小型モデル（4B〜8B）のコンテキストウィンドウ制約への対応
   - クラウドAPIは30,000文字のまま変更なし

### 実装方針

1. **ダッシュボードにLM Studioプリセットボタンを追加**:
   - ボタンクリックでBase URLを `http://localhost:1234/v1` に自動設定
   - APIキー入力を任意扱いに変更

2. **タイムアウト設定UIを追加**:
   - ダッシュボードからタイムアウト秒数を設定可能にする
   - ローカルLLMは応答が遅いため長めの値を推奨（90〜120秒）

3. **ドキュメント整備**:
   - LM Studioサーバーの起動手順
   - Obsidian Weaveでのプロバイダー設定手順

## Consequences

### メリット

- ローカルLLMを使用することでAPIコストがゼロになる
- ページコンテンツがクラウドに送信されないためプライバシーが向上する
- GGUF・Llama・Mistralなど多様なモデルを選択可能
- 既存のOpenAI互換インターフェースを流用するため実装コストが低い

### デメリット

- LM Studioが起動済みでサーバーがアクティブな状態でないと動作しない
- 応答速度はハードウェア（GPU/CPU）に依存する
- 一部機能（function calling、vision等）はモデル依存で動作しない場合がある

### 互換性

- 既存のOpenAI互換プロバイダー設定に影響なし
- 他のAIプロバイダーへの影響なし

## Implementation Steps

### Phase 1: ドキュメント・設計
- [x] ADR作成
- [ ] SETUP_GUIDE.md にLM Studio設定手順を追記

### Phase 2: UI設定
- [x] 既存「openai-compatible」プロバイダーを流用
- [x] Base URL入力フィールドをUIに追加
- [x] LM Studioプリセットボタンを追加
- [x] i18n文字列追加（日本語・英語）
- [x] タイムアウト設定UIを追加
- [x] ローカルURL検出・コンテンツサイズ自動制限を実装

### Phase 3: テスト
- [ ] LM Studioへの接続確認
- [ ] ローカルモデルでの要約動作確認
- [ ] サーバー未起動時のエラーハンドリング確認

## Technical Details

### LM Studio APIエンドポイント

```
Base URL: http://localhost:1234/v1

エンドポイント:
- GET  /models              - 利用可能なモデル一覧の取得
- POST /chat/completions    - チャット補完の生成
- POST /completions         - テキスト補完（レガシー）
```

### 設定例

```json
{
  "provider_type": "openai-compatible",
  "provider_base_url": "http://localhost:1234/v1",
  "provider_api_key": "",
  "provider_model": "llama-3.1-8b-instruct"
}
```

### LM Studioサーバーの起動手順

1. LM Studio を開く
2. 「Developer」タブに移動（またはCLIを使用）
3. 「Local Server」を有効にする（または `lms server start` を実行）
4. デフォルトで `http://localhost:1234` で起動

### ローカルURL検出ロジック

> **注記**: 以下は決定当時の設計スニペットです。実際の実装（`src/background/ai/providers/OpenAIProvider.ts`）は`localhost`/`.localhost`サフィックス/`127.x.x.x`/`::1`のみを判定し、`192.168.`/`10.`/`172.`等のプライベートIPレンジは対象外です。ローカル判定はタイムアウト設定（ローカル: 120000ms、非ローカル: 30000ms）に使用され、コンテンツサイズ制限（デフォルト`10_000`文字、`getMaxContentLength()`）とは別の設定です。

```typescript
// OpenAIProvider.ts（決定当時の設計案。実装と異なる点は上記注記を参照）
static isLocalUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;
        return hostname === 'localhost'
            || hostname === '127.0.0.1'
            || hostname.startsWith('192.168.')
            || hostname.startsWith('10.')
            || hostname.startsWith('172.');
    } catch {
        return false;
    }
}

// コンテンツサイズ制限の適用
const contentLimit = OpenAIProvider.isLocalUrl(this.baseUrl) ? 4000 : 30000;
const truncatedContent = content.substring(0, contentLimit);
```

## Status

- **提案日**: 2026-04-04
- **承認日**: 2026-04-04
- **実装状況**: Phase 1〜2 完了、Phase 3（テスト）残
- **後継ADR**: なし
