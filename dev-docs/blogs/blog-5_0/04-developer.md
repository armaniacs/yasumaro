# Obsidian Weave v5.0 — 実装者が振り返る v4.2 → v5.0 の設計判断

> 対象読者: Chrome 拡張開発者、TypeScript/Service Worker 開発者、同プロジェクトへのコントリビュータ

---

## はじめに

v4.2.0 から v5.0（internal: v4.10.x）まで、3 週間足らずで相当量のリファクタリングと機能追加を行いました。本稿では「なぜその設計を選んだか」「何にハマったか」を中心に技術的な判断を記録しておきます。

---

## 1. 権限モデル変更 — `<all_urls>` を剥がすということ

今回の変更で最も波及範囲が広かったのが、`host_permissions: ["<all_urls>"]` の削除です。

### 動機

Chrome Web Store の審査基準として、`<all_urls>` の使用には正当な理由が必要です。閲覧履歴記録ツールとして全 URL 記録の必要性は説明できますが、**ユーザーに選択肢を与える**設計のほうが Privacy by Design として望ましいと判断しました。

### ドミノ倒し的修正

`<all_urls>` を `optional_host_permissions` に移動するだけなら単純ですが、実際には以下の連鎖が発生しました：

```
manifest.json 変更
  → 未許可ドメインで content script が動かない
  → PermissionManager クラスを新設（chrome.permissions API ラッパー）
  → 拒否ドメイン管理（recordDeniedVisit / cleanupOldDeniedEntries）
  → DomainTrustLevel.LOCKED を新設
  → Popup に LOCKEDバッジと「このサイトを許可する」ボタンを追加
  → Dashboard に「権限提案リスト」を追加
  → recordingLogic.ts で isHostPermitted チェックを追加
  → Tranco Top 1000 プリセットを host_permissions に収録
    （2000 行超の manifest.json エントリ）
```

最後の「Tranco Top 1000 を `host_permissions` に収録」は、よく使われるサイトではパーミッションダイアログなしで動かすための妥協策です。**`<all_urls>` を消すと何も記録できなくなる**という現実に対して、「よく使われるトップ 1000 ドメインは最初から許可済みにする」という判断をしました。

---

## 2. Trust Database — Bloom Filter を選んだ理由

Tranco Top 10,000 ドメインのリストを毎回線形検索するのは現実的ではありません（O(n)）。

### 選択肢の検討

| 方式 | 検索速度 | メモリ | 実装コスト |
|------|---------|--------|------------|
| Set<string> | O(1) | 大（全ドメイン文字列） | 低 |
| Bloom Filter | O(k) ≒ O(1) | 小（ビット配列） | 中 |
| Trie | O(m) | 中 | 高 |

Chrome 拡張の Service Worker はメモリに制約があり、かつ **再起動のたびにストレージから復元**する必要があります。Bloom Filter はシリアライズ・デシリアライズが容易（ビット配列 → Base64）なため採用しました。

偽陽性率は約 1%。「信頼できないドメインを信頼済みと誤判定する」方向の偽陽性は許容できるため、この設定を採用しています。

### 実装上のハマりポイント

Service Worker 再起動後に `trancoSet`（O(1) 検索用の `Set<string>` キャッシュ）を再構築していなかったため、Tranco による信頼判定が常に失敗するというバグが v4.10.3 まで残存しました。

```typescript
// trustDb.ts — initialize() 内に追記が必要だった
this.trancoSet = new Set(this.trancoList.map(d => d.toLowerCase()));
```

**教訓**: Service Worker はステートレスです。ストレージから復元するたびに、インメモリキャッシュをすべて再構築する必要があります。

---

## 3. RecordingPipeline のステップ分割

v4.9.0 以前は `recordingLogic.ts` にすべての処理が混在していました。v4.9 → v4.10 にかけて `RecordingPipeline` をステップに分割しました。

### 構成

```
src/background/pipeline/
  ├── RecordingPipeline.ts        # オーケストレーター
  ├── RecordingContext.ts         # 各ステップ間の共有状態
  └── steps/
      ├── checkPermissionStep.ts
      ├── checkPrivacyHeadersStep.ts
      ├── fetchContentStep.ts
      ├── processPrivacyPipelineStep.ts
      └── saveToObsidianStep.ts
```

### aiClient の伝達バグ（v4.10.8 で修正）

分割の過程で、`RecordingPipeline` に渡された `aiClient` が `processPrivacyPipelineStep` 内で `null` のまま `PrivacyPipeline` に渡されるバグが発生しました。AI 要約が常に `"Summary not available."` になる症状で、原因は `RecordingContext` に `aiClient` フィールドを含めていなかったことでした。

```typescript
// Before: aiClient が Context を通らず null になっていた
// After: RecordingContext に aiClient を追加
interface RecordingContext {
  url: string;
  content: string;
  aiClient: AIClient | null;  // 追加
  // ...
}
```

**教訓**: パイプラインを分割するときは、ステップ間の共有状態（Context）の設計を最初に固めることが重要です。後から追加するとバグの温床になります。

---

## 4. CSP 二層セキュリティモデル

### 設計思想

```
第一層: manifest.json connect-src
  → ブラウザが強制的にブロック（回避不可）
  → デフォルト 10 プロバイダーのみ許可

第二層: CSPValidator（実行時 URL 検証）
  → ユーザーが選択したプロバイダーのみ通信許可
  → fetch.ts の fetchWithTimeout に統合
```

第一層だけだと「ユーザーが選択していないプロバイダーへの通信もブラウザ側では許可されてしまう」問題が残ります。第二層で実行時に再検証することで、ユーザーの意図しない通信を防ぎます。

### `optional_host_permissions` との連携

AI プロバイダー 28 ドメインは `optional_host_permissions` に移動しました。ユーザーが CSP 設定でプロバイダーを有効化すると、`PermissionManager.requestPermission()` が呼ばれ、Chrome の権限ダイアログが表示されます。

---

## 5. Service Worker の制約との戦い

### 動的 import の禁止（v4.10.8 修正）

`recordingLogic.ts` 内で `await import()` を使用していたため、Service Worker で `TypeError` が発生していました。

```typescript
// NG: Service Worker では動的 import は仕様上禁止
const { someUtil } = await import('./utils/someUtil.js');

// OK: 静的 import に変更
import { someUtil } from './utils/someUtil.js';
```

Chrome の Manifest V3 Service Worker では、動的 import が**仕様上禁止**されています（ドキュメントに明記されているものの、実際にハマるまで気づかないことが多い）。

### 設定の「フラット vs ネスト」問題（v4.10.8 修正）

ストレージマイグレーション後、設定値が `settings` オブジェクトの配下に移動していましたが、`extractor.ts` はフラットキーで読み込んでいたためコンテンツ取得が機能していませんでした。

```typescript
// Before: フラットキーで読む（マイグレーション後は存在しない）
const threshold = storage['engagement_threshold'];

// After: 新旧両方式に対応
const threshold = storage['settings']?.engagement_threshold
  ?? storage['engagement_threshold'];
```

---

## 6. TypeScript 型安全性の強化

### `any[]` の駆逐

`RecordingResult.maskedItems: any[]` を `(string | MaskedItem)[]` に変更しました（v4.10.7 / v4.10.8 / v4.10.10 にかけて）。

```typescript
// messaging/types.ts
export interface MaskedItem {
  type: string;
  position?: string;
  original?: string;
  index?: number;
}

export interface RecordingResult {
  maskedItems?: (string | MaskedItem)[];
}
```

`retryHelper.ts` の `ServiceWorkerResponse.maskedItems` は意図的に `any[]` を維持しています。汎用 Service Worker ヘッセージングヘルパーであり、`messaging/types.ts` へ依存させると循環依存が発生するためです（ADR: `recordingResult-maskedItems-type-fix.md` 参照）。

---

## 7. ローカルLLM（LM Studio）対応の設計判断

### 「新プロバイダー追加」か「既存プロバイダー流用」か

LM Studio は OpenAI 互換 API を提供しているため、専用の `LMStudioProvider` クラスを作るのではなく、**既存の `OpenAIProvider` をそのまま使い、プリセット設定ボタンだけ追加する**方針を採りました。

コード変更はほぼ UI 側のみで、プロバイダーロジックは変更ゼロです。新プロバイダークラスを作ると、接続テスト・タイムアウト・エラーハンドリングを重複実装することになります。

### ローカルURL検出によるコンテンツサイズ制限

ローカルLLM（4B〜8B モデル）はコンテキストウィンドウが小さく、大量のテキストを送ると応答が壊れるか無限待機になります。`OpenAIProvider` にローカルURL検出を追加し、`localhost` / `127.0.0.1` / プライベートIPの場合は **4,000 文字に自動制限**しています。

```typescript
// OpenAIProvider.ts
const contentLimit = OpenAIProvider.isLocalUrl(this.baseUrl) ? 4000 : 30000;
const truncatedContent = content.substring(0, contentLimit);
```

クラウドAPIとローカルAPIで動的に切り替えるため、ユーザーは意識する必要がありません。

### LLM出力の後処理問題

ローカルモデルはプロンプトの指示テキスト（`要約文：`、`#カテゴリ1` 等）を出力に混入する傾向があります。この問題への対処として `tagUtils.ts` に以下の後処理を実装しました：

1. **`removeNoiseLines`**: `#カテゴリ1`/`要約文（改行なし）` 等のプレースホルダー行を除去
2. **`selectBestBlock`**: `\n\n要約[文]?[：:]` 以降の詳細本文を優先採用（1行目より情報量が多い場合が多い）

LLMの出力パターンにバリエーションがあるため（`要約文：\n本文` と `要約：本文インライン` の両方が観測）、正規表現を `/\n\n要約文?[：:]\n?([\s\S]+)/` として両方に対応しています。

## 8. Content Cleansing の設計判断

### パイプライン内の位置

Content Cleansing は `extractor.ts` がページ本文を取得した直後、Obsidian への保存前に実行されます。AI Summary Cleansing はその後、AI へ送信する直前です。両者は独立してオン/オフを切り替えられますが、データは直列パイプラインで流れます。

```
DOM取得
  ↓
Content Cleansing（Hard Strip → Keyword Strip）
  → originalBytes / cleansedBytes を記録
  ↓
AI Summary Cleansing（広告・ナビ・Deep Cleansing）
  → aiSummaryOriginalBytes / aiSummaryCleansedBytes を記録
  ↓
AI要約 → Obsidian保存
```

「Content Cleansing で削除された要素は AI Summary Cleansing の対象にはもう存在しない」という点が重要です。元の DOM には一切影響しません（クローン操作）。

### バイト数計測の非対称性

Content Cleansing の `originalBytes`/`cleansedBytes` は**テキストベース**（Obsidian に保存される文字列量）で計測し、AI Summary Cleansing の `aiSummaryOriginalBytes`/`aiSummaryCleansedBytes` は**outerHTML ベース**で計測しています。計測対象が異なるため、2つの数値を直接比較することはできません。

---

## 9. AIタグ結果表示の設計判断

タグ付き要約モードでは、AIが要約と同時にカテゴリタグを付与します。出力形式はこうなっています。

```
#IT・プログラミング #ビジネス・経済 | このページはTypeScriptの型システムについて解説している。
```

タグは Obsidian のデイリーノートと `chrome.storage.local` の両方に保存されます。v5.0 以前はポップアップに「保存しました」しか返っておらず、どのタグが付いたかは Obsidian を開くまでわかりませんでした。

### ストレージ経由の読み取りを選んだ理由

タグをポップアップに届ける方法は2つありました。

**A. バックエンドのレスポンスにタグを追加する**  
`recordingLogic.ts` の戻り値にタグを含め、Service Worker 経由でポップアップに返す。確実ですが、バックエンドの型定義・インターフェース変更が必要です。

**B. 保存後に `chrome.storage.local` から取得する（採用）**  
保存完了後、同じストレージからタグを読み直す。バックエンドは一切触らず、フロントエンドだけで完結します。タグの保存は `await` で完了してから `return { success: true }` が返るため、タイミング問題もありません。

影響範囲を最小にするため B を採用しました。変更ファイルは5つのみです。

```typescript
// src/popup/main.ts
async function showTagResult(url: string): Promise<void> {
  const panel = document.getElementById('tagResultPanel');
  if (!panel) return;
  try {
    const entries = await getSavedUrlEntries();
    const entry = entries.find(e => e.url === url);
    const tags = entry?.tags;
    if (!tags || tags.length === 0) return;
    panel.textContent = `🏷 ${getMessage('aiTagsLabel')}: ${tags.map(t => `#${t}`).join('  ')}`;
    panel.classList.remove('hidden');
    startAutoCloseTimerWithDelay(4000);
  } catch {
    // タグ取得失敗はサイレントフェール
  }
}
```

### 自動クローズタイマーとの協調

通常のポップアップは保存完了後に自動クローズします。タグが表示される場合はタイマーを 4 秒に延長します（`startAutoCloseTimerWithDelay(4000)`）。タイマー管理は `autoClose.ts` の `autoCloseTimerId` を通して行うため、設定画面への遷移でのキャンセルも正しく動作します。

---

## 10. 「記録できなかったページ」の手動記録 — バグ起因の機能追加

### 発端

ダッシュボードの「今すぐ記録」ボタンを押すと、`Summary not available.` しか書き込まれないことがありました。原因はダッシュボードからのメッセージが `content: ''`（空文字）を送っていたためです。ポップアップからの記録は Content Script がページ本文を取得して渡しますが、ダッシュボードには「今見ているページ」という概念がなく、過去にスキップされた URL のリストから操作するためページ本文を持っていませんでした。

```
ダッシュボード → MANUAL_RECORD { content: '' } → PrivacyPipeline
                                                   ↓
                                              !content → Summary not available.
```

### 2つの修正を同時に行った

**1. 「今すぐ記録」でコンテンツを取得してから AI に渡す**

Service Worker が次の順序でコンテンツを取得するよう修正しました：

```
1. 該当URLのタブが既に開いている？
   → scripting.executeScript でページ本文を取得

2. タブが開いていない？
   → バックグラウンドでタブを新規作成 → 読み込み完了を待機（最大15秒）
   → scripting.executeScript でページ本文を取得 → タブを自動で閉じる

3. それでも取得できない？（CSPブロック等）
   → fetch(url) でHTMLを取得してタグを除去
```

**2. `skipAi: true` フラグによる AI スキップ記録**

ログインが必要なページはステップ3でも取得できません。そういうケース向けに「AI要約なしで記録」ボタンを追加し、`skipAi: true` フラグを導入しました。

```typescript
// recordingLogic.ts
if (skipAi) {
  const markdown = `- ${timestamp} [${sanitizedTitle}](${url})`;
  await this.obsidian.appendToDailyNote(markdown);
  return { success: true };
}
```

`skipAi` 時はページ取得・AI 処理をすべてスキップして即座に書き込みます。AI要約のないエントリはタイトルと URL だけのシンプルな形式になります。

---

## 参照 ADR 一覧

| ADR | 内容 |
|-----|------|
| `0002-csp-layered-security.md` | CSP 二層モデルの設計根拠 |
| `2026-03-20-permissionManager-trustDb-separation.md` | PermissionManager と TrustDb の責務分離 |
| `2026-03-24-tranco-list-update-notification.md` | Tranco リスト更新通知・同意機構 |
| `2026-03-25-recordingResult-maskedItems-type-fix.md` | maskedItems 型硬化と retryHelper.ts の例外 |
| `2026-03-24-master-password-data-cleanup.md` | マスターパスワード無効化時のクリーンアップ |
| `2026-04-04-lm-studio-integration.md` | LM Studio 統合・ローカルLLM対応の設計判断 |

---

## まとめ

v4.2 → v5.0 で最も設計負荷が高かったのは **権限モデルの変更**でした。`<all_urls>` 一行を消すと、UI・ロジック・マニフェストの大規模修正が連鎖します。「小さな変更が大きな影響を持つ」という典型例として、今後の設計判断の参考にしてください。
