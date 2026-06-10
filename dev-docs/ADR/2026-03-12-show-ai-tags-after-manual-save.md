# ADR: 手動保存後のAIタグ分類結果表示

## ステータス
採用済み

## 日付
2026-03-12

## 作成者
技術決定

## コンテキスト

### 問題の背景

Obsidian Weaveはタグ付き要約モード（`tagSummaryMode`）が有効な場合、AIがページをカテゴリタグ（例: `#IT・プログラミング`）に自動分類してObsidianのデイリーノートに保存する。

しかし現状、手動で「今すぐ記録」ボタンを押して保存した際、ユーザーは「✓ Obsidianに保存しました (2.2秒)」というメッセージを見るだけで、AIがどのタグに分類したかを確認する手段がない。タグ分類結果はObsidianを開かないと確認できず、ユーザーの期待と実際の分類がずれていても気づけない。

### 現在の状況

- タグは `recordingLogic.ts` の `pipelineResult.tags` として取得され、`setUrlTags(url, tags)` で `chrome.storage.local` に保存される
- ポップアップUIの成功後フローは `main.ts` の `recordCurrentPage()` で管理され、`result.success` が `true` の場合に成功メッセージを表示後、自動クローズタイマーを起動する
- `SAVE_RECORD` レスポンス（`recordingLogic.record()` の戻り値）には現状タグ情報が含まれていない
- `getUrlTags(url)` を使えば保存後に `chrome.storage.local` からタグを取得できる

### 影響を受けるステークホルダー

- **エンドユーザー**: 手動保存後にAIの分類結果を即座に確認したい
- **開発者**: 実装変更を最小限に抑えたい

## 関連するADR

- [2026-02-25-rename-to-obsidian-weave.md](./2026-02-25-rename-to-obsidian-weave.md) — プロジェクト名規定
- [2026-02-21-privacy-detection-logic-refinement.md](./2026-02-21-privacy-detection-logic-refinement.md) — プライバシーパイプライン設計

## 決定事項

**保存成功後にchrome.storage.localからタグを取得し、ポップアップUI内の`#mainStatus`直下にタグバッジパネルを読み取り専用で表示する**

### 検討した選択肢

#### 選択肢A: `SAVE_RECORD` レスポンスにタグを追加してバックエンドから受け取る

- `recordingLogic.record()` の戻り値 `RecordingResult` に `tags?: string[]` を追加
- Service Workerが `sendResponse({ success: true, aiDuration, tags })` を返す

**メリット**: データがリアルタイムで確実に取得できる、往復通信が不要

**デメリット**: バックエンド（`recordingLogic.ts`、`service-worker.ts`）の型変更が必要。影響範囲が広い

#### 選択肢B: 保存後に `getUrlTags(url)` で `chrome.storage.local` から取得（採用）

- フロントエンド（`main.ts`）のみを変更
- `setUrlTags` で保存済みのタグを `getUrlTags(url)` で取得して表示

**メリット**: バックエンド変更ゼロ。フロントエンド単独で完結。既存の保存フローに影響なし

**デメリット**: `setUrlTags` 呼び出しと `getUrlTags` 呼び出しの間に極わずかな非同期ギャップがある（実用上問題なし）

### 採用理由

選択肢Bを採用する。タグはすでに `chrome.storage.local` に確実に保存されており、`getUrlTags(url)` で即座に取得可能。バックエンドの型・インターフェース変更を避けることで影響範囲を最小化し、フロントエンドのみの変更で機能を実現できる。

### UI設計

成功メッセージの直下に `#tagResultPanel` を追加する。既存の `.status-panel` / `.status-toggle` パターンは展開/折り畳み不要のため流用しない。タグは `#付きテキストのみ` でインライン表示する（Obsidian記法との一貫性）。

```
[✓ Obsidianに保存しました (2.2秒)]
[🏷 AIタグ: #IT・プログラミング  #ビジネス・経済]   ← 新規（1行）
```

#### 詳細ルール

- **タグが0件の場合**: パネルを一切表示しない（`hidden` クラスを維持）。AIタグモード無効・AI未分類・取得エラーいずれも同様。
- **バッジスタイル**: `#カテゴリ名` テキストのみ。背景色・ボーダーなし。タグ間はスペースで区切る。
- **自動クローズタイマー**: タグが1件以上ある場合は通常の2倍の時間（例: 3秒→6秒）に延長して表示時間を確保する。タグなしの場合は通常どおり。
- **読み取り専用**: タグの編集・削除・クリックアクションは行わない。

### 実装

```
変更対象ファイル:
  src/popup/popup.html     — #tagResultPanel を #mainStatus 直後に追加
  src/popup/styles.css     — .tag-result-panel / .tag-badge スタイルを追加
  src/popup/main.ts        — 保存成功後に showTagResult(url) を呼び出す
  _locales/ja/messages.json — aiTagsLabel キーを追加
  _locales/en/messages.json — aiTagsLabel キーを追加

変更しないファイル:
  src/background/recordingLogic.ts — 変更なし
  src/background/service-worker.ts — 変更なし
  src/utils/storageUrls.ts         — 変更なし（getUrlTags をそのまま利用）
```

## 結果

### メリット

- **最小変更**: バックエンド変更ゼロ、フロントエンド5ファイルのみ
- **ユーザー体験向上**: 保存直後にAI分類結果を確認できる
- **既存パターンとの一貫性**: 既存のCSS変数・スタイルを流用
- **非破壊的**: タグが存在しない場合はUIに変化なし（後退互換性あり）

### デメリット

- 非同期ギャップ: `setUrlTags` → `getUrlTags` の間に極わずかな遅延が理論上存在する（実用上問題なし）
- 自動クローズまでの時間内にのみ確認可能（恒久的な確認手段ではない）

### トレードオフ

本実装は「完全なリアルタイム性（バックエンド型変更）」と「最小変更・安全性（ストレージ経由）」の間のトレードオフ。
手動保存の確認という用途では保存直後にストレージから取得する方法で十分な即時性が確保できる。

### 影響範囲

- 影響を受けるファイル:
  - `src/popup/popup.html` — DOM追加
  - `src/popup/styles.css` — スタイル追加
  - `src/popup/main.ts` — 表示ロジック追加
  - `_locales/ja/messages.json` — i18nキー追加
  - `_locales/en/messages.json` — i18nキー追加

### 実装状態

- ✅ ADR作成済み
- ⬜ 実装待ち
