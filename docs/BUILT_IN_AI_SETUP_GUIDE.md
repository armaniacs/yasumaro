# Built-in AI 設定ガイド / Built-in AI Setup Guide

## 日本語

### Built-in AI とは

Built-in AI（Chrome/Edge の内蔵 AI）は、ブラウザに内蔵された AI モデルを使用して、インターネット接続なしで AI 処理を実行する機能です。Chrome では Gemini Nano、Edge では Phi-mini を使用します。API キー不要で、データはデバイス外に送信されません。

### 「Built-in AI is currently downloadable」と表示される場合

AI テストでこのメッセージが表示される場合、モデルがまだダウンロードされていない状態です。以下の手順で利用可能になります。

### 1. ハードウェア要件を確認

| 項目 | 要件 |
|------|------|
| OS | Windows 10/11、macOS 13+ (Ventura 以降)、Linux、ChromeOS (Chromebook Plus) |
| ストレージ | 空き容量 22GB 以上 |
| メモリ | RAM 16GB 以上、または VRAM 4GB 以上の GPU |
| ネットワーク | 初回ダウンロード時のみ必要（以降はオフラインで動作） |

**注意:** 空き容量が 10GB 未満になると、モデルは自動的に削除されます。

### 2. Chrome の場合

#### 2.1 フラグを有効化（必要な場合）

通常、Chrome 131 以降では Built-in AI はデフォルトで有効ですが、以下の手順で確認・有効化できます:

1. アドレスバーに `chrome://flags/#optimization-guide-on-device-model` を入力
2. **Enabled** を選択
3. **Relaunch** をクリックして Chrome を再起動

Gemini Nano モデルを使用する場合:

1. アドレスバーに `chrome://flags/#prompt-api-for-gemini-nano` を入力
2. **Enabled** または **Enabled multilingual** を選択
3. **Relaunch** をクリック

#### 2.2 モデルのダウンロード

1. Yasumaro の初期設定画面で「AI テスト」ボタンをクリック
2. 「Built-in AI is currently downloadable」と表示された場合、モデルのダウンロードが開始されます
3. ダウンロードには数分〜数十分かかります（回線速度による）
4. ダウンロード完了後、再度「AI テスト」を実行すると「✓ Built-in AI: ok」と表示されます

#### 2.3 トラブルシューティング

モデルが正常に動作しない場合:

1. Chrome を再起動
2. アドレスバーに `chrome://on-device-internals` を入力
3. **Model Status** タブでエラーがないか確認
4. DevTools コンソールで `await LanguageModel.availability()` を実行し、`available` が返るか確認

### 3. Edge の場合

Edge も Chromium ベースで同一の Prompt API 形状をサポートしていますが、Edge では Phi-mini モデルが使用されます。

#### 3.1 フラグを有効化

1. アドレスバーに `edge://flags/#optimization-guide-on-device-model` を入力
2. **Enabled** を選択
3. **Relaunch** をクリックして Edge を再起動

Phi-mini モデルを使用する場合:

1. アドレスバーに `edge://flags/#edge-llm-prompt-api-for-phi-mini` を入力
2. **Enabled** を選択
3. **Relaunch** をクリック

#### 3.2 モデルのダウンロード

1. Yasumaro の初期設定画面で「AI テスト」ボタンをクリック
2. 「Built-in AI is currently downloadable」と表示された場合、モデルのダウンロードが開始されます
3. ダウンロードには数分〜数十分かかります
4. ダウンロード完了後、再度「AI テスト」を実行

#### 3.3 トラブルシューティング

1. Edge を再起動
2. アドレスバーに `edge://on-device-internals` を入力
3. **Model Status** タブでエラーがないか確認
4. DevTools コンソールで `await LanguageModel.availability()` を実行

### 4. よくある質問

#### Q: ダウンロードに時間がかかります

A: モデルサイズは数 GB あります。高速なインターネット接続環境で実行してください。ダウンロード中は Yasumaro の他の機能は使用可能です。

#### Q: 「unavailable」と表示されます

A: ハードウェア要件を満たしていない可能性があります。要件を確認し、空き容量を確保してください。

#### Q: ダウンロード後に再度「downloadable」と表示されます

A: 空き容量が 10GB 未満になり、モデルが削除された可能性があります。空き容量を確保して再度ダウンロードしてください。

#### Q: Chrome と Edge の両方で使用できますか

A: はい、それぞれのブラウザで個別にモデルをダウンロードする必要があります。

---

## English

### What is Built-in AI?

Built-in AI (Chrome/Edge's integrated AI) uses the AI model built into the browser to perform AI processing without an internet connection. Chrome uses Gemini Nano, while Edge uses Phi-mini. No API key is required, and data is never sent outside your device.

### When you see "Built-in AI is currently downloadable"

If this message appears in the AI test, the model hasn't been downloaded yet. Follow the steps below to enable it.

### 1. Check Hardware Requirements

| Item | Requirement |
|------|-------------|
| OS | Windows 10/11, macOS 13+ (Ventura or later), Linux, ChromeOS (Chromebook Plus) |
| Storage | At least 22GB free space |
| Memory | 16GB+ RAM, or GPU with 4GB+ VRAM |
| Network | Required only for initial download (works offline afterward) |

**Note:** The model is automatically deleted if free space drops below 10GB.

### 2. For Chrome

#### 2.1 Enable Flags (if needed)

Built-in AI is enabled by default in Chrome 131+, but you can verify/enable it:

1. Enter `chrome://flags/#optimization-guide-on-device-model` in the address bar
2. Select **Enabled**
3. Click **Relaunch** to restart Chrome

For Gemini Nano model:

1. Enter `chrome://flags/#prompt-api-for-gemini-nano` in the address bar
2. Select **Enabled** or **Enabled multilingual**
3. Click **Relaunch**

#### 2.2 Download the Model

1. Click the "AI Test" button on Yasumaro's initial settings page
2. If "Built-in AI is currently downloadable" appears, the model download will start
3. Download takes several minutes to tens of minutes (depending on connection speed)
4. After download completes, run "AI Test" again — you should see "✓ Built-in AI: ok"

#### 2.3 Troubleshooting

If the model doesn't work properly:

1. Restart Chrome
2. Enter `chrome://on-device-internals` in the address bar
3. Check the **Model Status** tab for errors
4. Run `await LanguageModel.availability()` in DevTools console — it should return `available`

### 3. For Edge

Edge also supports the same Prompt API shape since it's Chromium-based, but Edge uses the Phi-mini model.

#### 3.1 Enable Flags

1. Enter `edge://flags/#optimization-guide-on-device-model` in the address bar
2. Select **Enabled**
3. Click **Relaunch** to restart Edge

For Phi-mini model:

1. Enter `edge://flags/#edge-llm-prompt-api-for-phi-mini` in the address bar
2. Select **Enabled**
3. Click **Relaunch**

#### 3.2 Download the Model

1. Click the "AI Test" button on Yasumaro's initial settings page
2. If "Built-in AI is currently downloadable" appears, the model download will start
3. Download takes several minutes to tens of minutes
4. After download completes, run "AI Test" again

#### 3.3 Troubleshooting

1. Restart Edge
2. Enter `edge://on-device-internals` in the address bar
3. Check the **Model Status** tab for errors
4. Run `await LanguageModel.availability()` in DevTools console

### 4. FAQ

#### Q: Download takes a long time

A: The model is several GB in size. Please use a fast internet connection. You can continue using other Yasumaro features during download.

#### Q: I see "unavailable"

A: Your device may not meet the hardware requirements. Check the requirements and ensure you have enough free space.

#### Q: After download, it shows "downloadable" again

A: The model may have been deleted because free space dropped below 10GB. Free up space and download again.

#### Q: Can I use it in both Chrome and Edge?

A: Yes, but you need to download the model separately for each browser.
