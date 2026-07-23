# Ollama 統合によるローカルAI対応

## Context

LM Studio対応（[2026-04-04-lm-studio-integration.md](2026-04-04-lm-studio-integration.md)）と並行して、Ollamaをもう一つのローカルLLMプロバイダーとして正式サポートする。

Ollamaはコマンドライン中心のローカルLLMランタイムであり、LM Studioとは異なるユーザー層（開発者・CLI利用者）に広く使われている。コードベースには既に以下の形でOllamaの存在が認識されている：

- `aiLimits.ts`: `ollama` プロバイダーのトークン上限を 32,000 として定義済み
- `storage.ts`: `OPENAI_2_BASE_URL` のデフォルト値として `http://127.0.0.1:11434/v1` を使用
- `fetch.ts`: `localhost:11434` をローカルLLMとして許可リストに収録済み

しかしUIには「Ollama」プリセットボタンがなく、LM Studio同様の明示的なサポートが欠けている。

**現状:**
- OpenAI互換プロバイダー経由でOllamaは技術的に動作可能
- ただしUI上でOllamaを設定する導線がない（Base URLを手入力する必要がある）
- LM Studioとは異なる点（APIキー不要・モデル名の指定方法・デフォルトポート）がドキュメント化されていない

**要件:**
- LM Studioと同等のUIプリセットボタンをOllama向けに追加する
- Ollama固有のデフォルト設定（Base URL・APIキー不要）を設定プリセットに反映する
- ローカルURL検出によるコンテンツサイズ制限（4,000文字）をOllamaにも適用する
- ダッシュボードの設定UIをLM Studio・Ollamaで対称に保つ

## Decision

### アーキテクチャ上の判断

1. **LM Studioと同じく既存の `OpenAIProvider` を流用する**:
   - OllamaはOpenAI互換API（`http://localhost:11434/v1`）を提供している
   - 新プロバイダークラスの追加は不要
   - LM Studio・Ollama・その他OpenAI互換サービスを同一コードパスで処理する

2. **Ollama用のデフォルト設定**:
   - Base URL: `http://localhost:11434/v1`
   - APIキー: 不要（Ollamaはデフォルトで認証なし）
   - モデル: `ollama list` で確認したモデル名をユーザーが手動入力（例: `llama3.2`, `mistral`）

3. **ローカルURL検出・コンテンツサイズ制限**:
   - LM Studio同様、ローカルIPの場合は送信コンテンツを **4,000文字に自動制限**
   - 既存の `OpenAIProvider.isLocalUrl()` がそのまま適用されるため追加実装不要

### 実装方針

1. **ダッシュボードにOllamaプリセットボタンを追加**:
   - LM Studioプリセットボタンと同列に配置
   - クリックでBase URLを `http://localhost:11434/v1` に自動設定
   - LM Studioプリセットボタンと同じスタイルを適用

2. **i18n文字列を追加**:
   - `ollamaPreset` などのキーを `_locales/ja/messages.json` / `_locales/en/messages.json` に追加

3. **ドキュメント整備**:
   - Ollamaのインストール・モデル取得・サーバー起動手順をSETUP_GUIDE.mdに追記

## Consequences

### メリット

- APIコストゼロ・データローカル保持はLM Studioと同等
- Ollamaはパッケージマネージャーで導入でき（`brew install ollama` 等）、CLI操作に慣れた開発者に向いている
- Homebrew・systemd・Dockerでバックグラウンド常駐が容易なため、常時起動ユースケースに強い
- `ollama list` でモデル一覧を確認できるため、モデル名の入力ミスを防ぎやすい
- 既存の `isLocalUrl()` / コンテンツ制限ロジックがそのまま適用されるため実装追加がほぼUI側のみ

### デメリット

- **CORS制限（要ユーザー設定）**: OllamaはデフォルトでChrome拡張機能（`chrome-extension://` origin）からのリクエストを403で拒否する。`OLLAMA_ORIGINS=chrome-extension://*` 環境変数の設定が必須。LM Studioにはこの制限がない
- Ollamaが起動済みでないと動作しない（LM Studioと同じ制約）
- 応答速度はハードウェアに依存する
- モデル名はユーザーが `ollama list` で確認して手動入力する必要がある（LM Studioのように自動取得UIはない）

### 互換性

- 既存のLM Studio設定・OpenAI/Gemini等のクラウドプロバイダーへの影響なし
- `isLocalUrl()` ロジックの変更なし

## Implementation Steps

### Phase 1: ドキュメント・設計
- [x] ADR作成
- [x] SETUP_GUIDE.md にOllama設定手順を追記

### Phase 2: UI設定
- [x] ダッシュボードにOllamaプリセットボタンを追加（`src/dashboard/panels/staticForm/generalSettingsPanel.ts`の`ollamaPresetBtn`として実装、`src/popup/settingsForm.ts`にも対応）
- [x] i18n文字列追加（日本語・英語、`ollamaPresetApplied`キー確認済み）
- [x] LM Studioプリセットと同じCSSスタイルを適用

### Phase 3: テスト
- [x] Ollamaへの接続確認（`/v1/models` 200 OK 確認済み）
- [x] ローカルモデルでの要約動作確認（AI接続成功確認済み）
- [ ] サーバー未起動時のエラーハンドリング確認

## Technical Details

### Ollama APIエンドポイント

```
Base URL: http://localhost:11434/v1

エンドポイント（OpenAI互換）:
- GET  /models              - 利用可能なモデル一覧の取得
- POST /chat/completions    - チャット補完の生成

Ollama固有エンドポイント（参考）:
- GET  /api/tags            - インストール済みモデル一覧
- POST /api/generate        - テキスト生成（OpenAI互換ではない）
```

### 設定例

```json
{
  "provider_type": "openai-compatible",
  "provider_base_url": "http://localhost:11434/v1",
  "provider_api_key": "",
  "provider_model": "llama3.2"
}
```

### Ollamaのセットアップ手順

```bash
# インストール（macOS）
brew install ollama

# サーバー起動
ollama serve

# モデルの取得と起動確認
ollama pull llama3.2
ollama list
```

### LM StudioとOllamaの比較

| 項目 | LM Studio | Ollama |
|------|-----------|--------|
| デフォルトURL | `http://localhost:1234/v1` | `http://localhost:11434/v1` |
| APIキー | 不要 | 不要 |
| モデル管理UI | GUI（ダウンロード画面あり） | CLI（`ollama pull`） |
| バックグラウンド常駐 | 手動起動が基本 | `brew services` / systemd で自動起動可 |
| コンテキスト上限（本ツール設定値） | 4,000文字（ローカル制限） | 4,000文字（ローカル制限） |
| 向いているユーザー | GUI重視・モデル比較したい | CLI慣れ・常時起動したい開発者 |

## Status

- **提案日**: 2026-04-05
- **承認日**: 2026-04-05
- **実装状況**: Phase 1〜3 ほぼ完了（サーバー未起動時のエラーハンドリング確認のみ残）
- **関連ADR**: [2026-04-04-lm-studio-integration.md](2026-04-04-lm-studio-integration.md)
- **後継ADR**: なし
