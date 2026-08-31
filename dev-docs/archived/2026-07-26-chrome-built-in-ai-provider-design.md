# Chrome Built-in AI Provider 統合設計

> **対象バージョン: v6.7**
> **関連 PBI**: [2026-07-26-30-feat-chrome-built-in-ai-oss-research.md](../pbi/2026-07-26-30-feat-chrome-built-in-ai-oss-research.md), [2026-07-26-31-feat-built-in-ai-provider-integration-design.md](../pbi/2026-07-26-31-feat-built-in-ai-provider-integration-design.md), [2026-07-26-32-feat-built-in-ai-provider-implementation.md](../pbi/2026-07-26-32-feat-built-in-ai-provider-implementation.md)
> **採用アプローチ**: C（Service 分離型）

## 1. 背景・課題

Yasumaro には既に Chrome Prompt API（`window.ai`）を利用する実装として `src/background/localAiClient.ts` と `src/offscreen/offscreen.ts` が存在する。しかし、これらは `src/background/aiClient.ts` の Provider 抽象化（Strategy パターン）には統合されておらず、ダッシュボード UI からも選択できない。

なぜなぜ分析の結果、以下の課題構造が明らかになった：

1. Provider 抽象化への統合が必要なのは、Built-in AI を他の AI Provider と同じように管理し、優先度リストによるフォールバックを実現するため
2. 優先度リストによるフォールバックが必要なのは、Built-in AI は Chrome / Flags / モデルダウンロードの制約により常に利用可能ではないため
3. この不確実性を放置すると、ユーザーが「要約ができない」と感じ、信頼を損なう
4. 信頼を維持するには、未対応 / 未ダウンロード状態を適切に伝え、代替手段を提示する UX が必要
5. さらに、Built-in AI は端末内で動作し外部通信を行わないため、プライバシー重視ユーザーにとって大きな価値がある
6. しかし `window.ai` は実験的 API であり、Chrome のアップデートや Flags 変更で挙動が変わる可能性がある
7. そのため、テスト駆動開発（TDD）による回帰防止と、既存インフラの再利用が重要である

## 2. 目標

- `BuiltInAIProvider` を `AIProviderStrategy` インターフェースに統合する
- ダッシュボード UI で「Built-in AI（APIキー不要）」を選択可能にする
- 優先度リストにおける Built-in AI の成否に応じた外部 Provider へのフォールバックを実現する
- ビジネスロジックとインフラ通信（Offscreen Document）の責務を分離し、テスト容易性を高める
- 外部通信を行わないローカル AI 要約を提供し、プライバシー重視ユーザーの信頼を獲得する

## 3. 非目標

- `offscreen.ts` の Prompt API と SQLite の責務分離（SRP 違反の解消）は v6.7 では対象外
- Gemini Nano 以外のローカルモデル対応
- モバイル Chrome 特有の最適化（別 PBI で対応予定）
- `window.ai` の Writer / Rewriter / Summarizer など、languageModel 以外の API

## 4. アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard / Popup UI                                       │
│  - Provider 選択プルダウン                                  │
│  - API キー入力欄の表示制御                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ settings storage
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  AIClient (src/background/aiClient.ts)                      │
│  - Provider 優先度リストを解決                              │
│  - フォールバック制御                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ AIProviderStrategy
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  BuiltInAIProvider (src/background/ai/providers/)           │
│  - ビジネスロジック                                         │
│  - 入力制限・サニタイズ・エラーハンドリング                 │
│  - 結果整形（AISummaryResult 変換）                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ BuiltInAIService interface
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  BuiltInAIService (src/background/builtInAiService.ts)      │
│  - Offscreen Document 起動管理                              │
│  - chrome.runtime.sendMessage ラッパー                      │
│  - タイムアウト制御                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ CHECK_AVAILABILITY / SUMMARIZE
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Offscreen Document (src/offscreen/offscreen.ts)            │
│  - window.ai へのアクセス                                   │
│  - session 管理                                             │
│  - prompt 実行                                              │
└─────────────────────────────────────────────────────────────┘
```

## 5. コンポーネント詳細

### 5.1 BuiltInAIProvider

- 既存 `AIProviderStrategy` インターフェースを実装
- `generateSummary(content, tagSummaryMode)` を実装
- `testConnection()` を実装
- 入力文字数を `aiLimits.ts` の設定に基づいて制限
- `sanitizePromptContent()` を呼び出してプロンプトインジェクション対策
- `BuiltInAIService` を介して要約を実行

### 5.2 BuiltInAIService

- `ensureOffscreenDocument()` で Offscreen Document を起動
- `checkAvailability()` で `window.ai` の availability を確認
- `summarize(content)` で要約を実行
- タイムアウト（30 秒）を管理
- `chrome.runtime.sendMessage` のラッパーを提供

### 5.3 Offscreen Document（既存の修正範囲）

- `CHECK_AVAILABILITY` / `SUMMARIZE` メッセージハンドラは維持
- `ensureSession()` の system prompt は維持
- 入力切り詰めロジックを `aiLimits.ts` ベースに移行可能か検討（PBI 1 で判断）

### 5.4 UI（Dashboard / Popup）

- `PROVIDER_LABELS` に `'built-in-ai': 'Built-in AI（APIキー不要）'` を追加
- `src/popup/settings/aiProvider.ts` に `built-in-ai` ケースを追加
- API キー入力欄を非表示にする制御を追加
- 優先度リストの選択肢に `built-in-ai` を追加

## 6. データフロー

### 6.1 要約実行時

1. `AIClient.generateSummary()` が優先度リストを解決
2. `BuiltInAIProvider.generateSummary()` が呼び出される
3. `BuiltInAIProvider` が入力制限・サニタイズを実行
4. `BuiltInAIService.summarize()` が Offscreen Document に `SUMMARIZE` メッセージを送信
5. Offscreen Document が `window.ai` で要約を実行
6. 結果が `AISummaryResult` 形式で返却
7. 成功すれば `AIClient` が結果を返却、失敗すれば次の Provider にフォールバック

### 6.2 利用可能性確認時

1. `BuiltInAIProvider.testConnection()` が呼び出される
2. `BuiltInAIService.checkAvailability()` が Offscreen Document に `CHECK_AVAILABILITY` を送信
3. `readily` / `after-download` / `no` / `unsupported` のいずれかを返却
4. UI は結果に応じて状態を表示

## 7. インターフェース設計

```typescript
// src/background/ai/providers/builtInAIProvider.ts
export class BuiltInAIProvider implements AIProviderStrategy {
  constructor(
    private service: BuiltInAIService,
    private settings: Settings
  ) {}

  async generateSummary(content: string, tagSummaryMode: boolean): Promise<AISummaryResult>;
  async testConnection(): Promise<{ success: boolean; message: string }>;
}

// src/background/builtInAiService.ts
export interface BuiltInAIService {
  checkAvailability(): Promise<LocalAIAvailability>;
  summarize(content: string): Promise<{ success: boolean; summary?: string; error?: string }>;
}

export class OffscreenBuiltInAIService implements BuiltInAIService {
  // Offscreen Document 経由の実装
}

// テスト用モック
export class MockBuiltInAIService implements BuiltInAIService {
  // テスト用実装
}
```

## 8. UI/UX 設計

### 8.1 Provider 選択

- プルダウンに「Built-in AI（APIキー不要）」を追加
- 選択時は API キー入力欄を非表示
- 優先度リストにも追加可能

### 8.2 状態表示

- `readily`: 利用可能（緑色アイコン等）
- `after-download`: ダウンロード待ち（ユーザーに進捗を通知）
- `no`: 利用不可（設定方法へのリンクを提示）
- `unsupported`: 未対応ブラウザ（別の Provider を推奨）

### 8.3 国際化

- すべてのラベル・メッセージは `data-i18n` 属性または i18n 関数を使用
- 日本語・英語両方に対応

## 9. エラーハンドリング

| 状態 | 動作 | ユーザー通知 |
|------|------|-------------|
| `readily` | 要約実行 | 不要 |
| `after-download` | 要約を試行（ダウンロードが必要なら待機 or エラー） | ダウンロード中であることを通知 |
| `no` | 即座に次の Provider へフォールバック | Built-in AI が利用できない理由と設定方法を通知 |
| `unsupported` | 即座に次の Provider へフォールバック | 未対応ブラウザであることを通知 |
| タイムアウト | 次の Provider へフォールバック | 時間切れであることを通知 |
| prompt 失敗 | `session` を破棄し、次の Provider へフォールバック | エラー内容を簡潔に通知 |

## 10. セキュリティ・プライバシー

- `sanitizePromptContent()` を必ず通す
- API キーは不要だが、設定値の保存は既存の `chrome.storage` 経由
- 外部通信を行わないことを UI 上で明示
- Offscreen Document 内の `window.ai` 呼び出しは、入力された Web ページコンテンツを端末内で処理するのみ

## 11. テスト戦略

### 11.1 E2E テスト

- Chrome Dev/Canary（Flags 有効化）で要約が完了するシナリオ
- 優先度リストでの Built-in AI → 外部 Provider フォールバックシナリオ
- ネットワーク切断状態での動作確認

### 11.2 統合テスト

- `AIClient` → `BuiltInAIProvider` → `BuiltInAIService` → Offscreen Document の連携
- ダッシュボード設定の保存・読み込み

### 11.3 単体テスト

- `BuiltInAIProvider.generateSummary()` / `testConnection()`
- 入力制限・サニタイズ
- `readily` / `after-download` / `no` / `unsupported` 各状態のハンドリング
- `BuiltInAIService` のタイムアウト・エラーハンドリング
- UI 表示切り替え

## 12. 実装ロードマップ

1. `BuiltInAIService` インターフェースと `OffscreenBuiltInAIService` の実装
2. `BuiltInAIProvider` の実装（TDD）
3. `AIClient.registerDefaultProviders()` への登録
4. `PROVIDER_LABELS` と UI 選択肢への追加
5. ダッシュボード UI の表示制御
6. E2E 動作確認（Chrome Dev/Canary）

## 13. リスク・落とし穴

- `window.ai` は Service Worker では利用できないため、必ず Offscreen Document 経由とする
- `offscreen.ts` の SRP 違反は v6.7 では解消せず、将来的な技術負債として残す
- 入力上限の不整合（`aiLimits.ts` の 16,384 トークン vs `offscreen.ts` の 10,000 文字）を設計段階で解決
- Chrome のアップデートや Flags 変更で挙動が変わる可能性があるため、回帰テストを充実させる
- `after-download` 状態の再現が難しいため、テスト戦略を事前に検討
- 新規 `BuiltInAIService` の追加により PBI 3 のスコープが広がる可能性がある

## 14. 将来の拡張

- `offscreen.ts` から Prompt API 部分を分離し、専用の Offscreen Document を作成
- Gemini Nano 以外のローカルモデル対応
- `window.ai` の Writer / Rewriter / Summarizer API の活用
- モバイル Chrome への対応強化
