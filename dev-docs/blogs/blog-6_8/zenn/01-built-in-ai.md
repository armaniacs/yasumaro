---
title: "ブラウザ内蔵AIで要約する — Chrome Gemini Nano / Edge Phi-mini 対応の実装ノート"
emoji: "🤖"
type: "tech"
topics: ["obsidian", "chrome拡張機能", "ai", "gemini", "promptapi"]
published: false
---

Yasumaro は v6.7 系で、ブラウザ組み込みのオンデバイス AI を要約プロバイダーとして追加しました。Chrome の Gemini Nano、Microsoft Edge の Phi-mini です。プロバイダー ID は `built-in-ai`。

この記事は、その実装で引っかかった点を残すものです。

## なぜ内蔵 AI か

Yasumaro の要約は、これまで外部の AI API に依存していました。OpenAI 互換、Gemini、ローカルの Ollama など、どれもキーやエンドポイントの用意が要ります。

「キーもネットワークも用意したくない」層に、要約の入口をもう1つ用意したい。ブラウザが `LanguageModel`（Prompt API）としてオンデバイスモデルを公開しはじめたので、これに乗りました。

内蔵 AI の性質:

- API キー不要
- 推論がデバイス内で完結し、ページ内容が外部へ出ない
- 初回にモデルのダウンロード（数 GB）が必要
- ダウンロード後はオフラインで動く
- 速度と品質はクラウド API に劣る

## Prompt API の形

使う API はシンプルです。

```ts
// 利用可否の確認
const status = await LanguageModel.availability({
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
});

// セッション生成（初回はダウンロード）
const session = await LanguageModel.create({
  initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      // e.loaded で進捗
    });
  },
});

// 推論
const summary = await session.prompt(pageText);
session.destroy();
```

### 出力言語は availability と create で揃える

`availability()` に `expectedOutputs` を渡さないと「No output language was specified」で弾かれます。さらに、`availability()` と `create()` で異なる言語を指定すると結果が食い違うことがあります。実装では出力言語指定を定数に切り出し、両方で同じものを渡しています。

### DOM が要らない

`LanguageModel` はサービスワーカーのグローバルから直接呼べます。DOM を必要としないので、Yasumaro が他の DOM 処理で使っているオフスクリーンドキュメントを経由しません。要約経路がそのぶん短くなります。

## availability の4状態

`availability()` が返す値は4つです。

| 状態 | 意味 |
|---|---|
| `available` | すぐ使える |
| `downloadable` | モデル未取得。`create()` でダウンロードが始まる |
| `downloading` | ダウンロード中 |
| `unavailable` | このブラウザ・環境では使えない（フラグ未設定、非対応など） |

実装では availability をキャッシュしますが、`downloading` のときだけは毎回再チェックします。ダウンロードが完了して `available` に変わるのを取りこぼさないためです。

## Chrome と Edge の違い

API の形は Chrome と Edge で同じでした。差が出るのはフラグの案内文言と、コンテキストウィンドウのサイズです。

### フラグの案内

`unavailable` のときにユーザーへ出す案内を、ブラウザごとに変えています。

| ブラウザ | フラグ URL | フラグ名 |
|---|---|---|
| Chrome | `chrome://flags/#prompt-api-for-gemini-nano` | Prompt API for Gemini Nano |
| Edge | `edge://flags/#edge-llm-prompt-api-for-phi-mini` | Prompt API for on-device language model |

ユーザーエージェントからブラウザを判定し、該当する案内を返します。判定できないブラウザには案内を出しません（フラグの存在が確認できていないため）。

### コンテキストウィンドウ

Edge の Phi-mini は実測でコンテキストウィンドウが 9216 トークンと狭めでした。Yasumaro は静的なプロバイダー別の入力上限（16,384 文字）を持っていますが、内蔵 AI ではセッションの `contextWindow` を見て、静的上限と動的上限（`contextWindow` × 文字数見積り × 安全マージン）の小さいほうで切り詰めます。これで狭いコンテキストウィンドウを超えて `QuotaExceededError` になるのを防ぎます。

## 診断パネル

ダッシュボードの診断パネルに内蔵 AI 専用のセクションを置きました。ここから `LanguageModel.availability()` を直接呼び、状態を表示します。`downloadable` のときは、進捗表示つきでダウンロードを開始できます。

「なぜ要約が内蔵 AI で動かないのか」を切り分ける場所です。フラグ未設定なのか、ダウンロード待ちなのか、非対応環境なのかがここで分かります。

## 使い分け

内蔵 AI は「キーもネットワークも用意しなくていい」代わりに、速度と品質でクラウド API に及びません。

Yasumaro のプロバイダー優先度リスト（フェイルオーバー順）に内蔵 AI を入れておくと、キー切れやネットワーク断のときのフォールバック先として機能します。速度重視ならクラウドを1位に、コストとプライバシー重視なら内蔵 AI を1位に、といった使い分けができます。

## ガイド

セットアップ手順は [Built-in AI 設定ガイド](../../../../docs/BUILT_IN_AI_SETUP_GUIDE.md) にあります。
