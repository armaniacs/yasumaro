# LM Studio テストガイド / LM Studio Testing Guide

## LM Studio のセットアップ / LM Studio Setup

### 1. LM Studio サーバーを起動 / Start LM Studio Server

**GUI 場合:**
1. LM Studio アプリを開く
2. 左上の "Developer" タブをクリック
3. "Local Server" を有効にする（またはトグルをON）
4. デフォルトポート: `1234`

**CLI 場合:**
```bash
lms server start
```

### 2. モデルをダウンロード / Download Model

1. LM Studio でモデルを検索・ダウンロード
2. 例: `llama-3.1-8b-instruct`, `mistral-7b-instruct`
3. ダウンロード後、モデルを選択状态にする

---

## 設定方法 / Configuration

### Dashboard 設定 / Dashboard Settings

1. 拡張機能を開く → Settings (Dashboard)
2. **AI Provider** で `OpenAI Compatible (Models.dev)` を選択
3. **LM Studio** プリセットボタンをクリック
4. Base URL が自動設定: `http://localhost:1234/v1`
5. **Model Name** を入力（LM Studio でダウンロードしたモデル名）
6. **API Key** は空でOK（ローカルLM用）

### 手動設定 / Manual Configuration

```json
{
  "ai_provider": "openai-compatible",
  "provider_base_url": "http://localhost:1234/v1",
  "provider_api_key": "",
  "provider_model": "llama-3.1-8b-instruct"
}
```

---

## テスト方法 / Testing Methods

### 方法1: Dashboard 接続テスト / Dashboard Connection Test

1. Settings 保存後、"Test Connection" ボタンをクリック
2. 正常時: `Connected to AI API.`
3. エラー時: エラーメッセージを表示

### 方法2: ブラウザコンソールで確認 / Browser Console

1. Chrome で `chrome://extensions` を開く
2. 拡張機能の "Service Worker" をクリック → DevTools
3. Console でログを確認

### 方法3: ローカルでリクエスト確認 / Local Request Verification

```bash
# モデル一覧を取得
curl http://localhost:1234/v1/models

# Chat completions をテスト
curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.1-8b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## よくある問題 / Common Issues

### 問題1: "Cannot connect" エラー

**原因:** LM Studio サーバーが起動していない

**解決:**
```bash
lms server start
```
または LM Studio GUI で Local Server を有効化

### 問題2: "Endpoint not found (404)"

**原因:** Base URL が正しくない

**確認:**
- URL: `http://localhost:1234/v1` ( `/v1` 含む)
- 末尾のスラッシュなし: `http://localhost:1234/v1`

### 問題3: "Authentication failed"

**原因:** 不要な API キーを設定している

**解決:** API Key フィールドを空にする

### 問題4: モデルが応答しない

**原因:** モデルがメモリにロードされていない

**解決:**
1. LM Studio でモデルを選択
2. "Load" ボタンをクリック
3. ステータスバーに "Ready" と表示されることを確認

---

## デバッグTips / Debug Tips

### LM Studio ログを有効化

LM Studio > Settings > Developer > Enable verbose logging

### Service Worker ログ確認

```javascript
// popup console または service worker console
chrome.storage.local.get(null, console.log);
```

### ネットワークリクエスト確認

Chrome DevTools > Network > Filter: `localhost:1234`

### 手動で LM Studio 接続テスト

```typescript
// service worker console
const response = await fetch('http://localhost:1234/v1/models', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
});
console.log(await response.json());
```

---

## 対応モデル / Supported Models

> **テスト待ち:** テスト后将更新予定。

### テスト予定 / Planned Testing

- [あなたのテストするモデルを記載してください]

### 要件 / Requirements

- **形式:** GGUF 形式
- **Quantization:** Q4_K_M, Q5_K_S, Q8_0 など
- **コンテキストウィンドウ:** 4K 以上推奨
- **Instructモデル:** 指示フォロー可能なモデル

---

## 関連ドキュメント / Related Docs

- [ADR: LM Studio 統合](./docs/ADR/2026-04-04-lm-studio-integration.md)
- [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- [OpenAIProvider.ts](./src/background/ai/providers/OpenAIProvider.ts)