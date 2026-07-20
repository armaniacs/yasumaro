# 設計: AIプロバイダ優先順位（1〜3位）とフォールバック

- 関連PBI: [2026-07-04-05-feat-summary-retry-fallback.md](2026-07-04-05-feat-summary-retry-fallback.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

## 背景・現状

現状 `AI_PROVIDER`（`src/utils/storage/types.ts`）は単一の文字列設定であり、`AIClient.generateSummary()`（`src/background/aiClient.ts`）は常に1つのプロバイダーのみを使用する。フォールバックの仕組みは存在しない。

`src/utils/retryHelper.ts` はService Worker通信（`chrome.runtime.sendMessage`）のリトライ専用であり、AIプロバイダーのフォールバックとは無関係。PBI本体の「技術的考慮事項」にある `retryHelper.ts` 再利用は誤りで、フォールバックロジックはaiClient側に新規実装する。

ダッシュボード（`src/dashboard/dashboard.ts`, `src/popup/settings/aiProvider.ts`）は単一のプロバイダーセレクトボックスを持ち、選択中のプロバイダーの設定欄のみ表示、他はhiddenにする仕組み（`updateAIProviderVisibility`）。

## 要件

- 優先順位は最大3位まで（1位必須、2位・3位は任意）
- 対象プロバイダーは登録済み全6種類（gemini / openai / openai2 / lm-studio / ollama / openai-compatible）から自由に選択
- 同一プロバイダーの重複選択を許容する（モデルを変えて使うケースがあるため）
- 優先度スロットごとにモデルを個別指定可能（省略時はそのプロバイダーの既存デフォルトモデル設定を使用）
- ダッシュボードでは選択された全プロバイダーの設定欄（APIキー等）を同時表示する
- 既存の単一 `AI_PROVIDER` 設定ユーザーは自動マイグレーションで1位スロットとして引き継ぐ

## データ構造

`StorageKeys` に新規追加:

```ts
AI_PROVIDER_PRIORITY_LIST: 'ai_provider_priority_list' // ProviderSlot[]
```

```ts
interface ProviderSlot {
  provider: string;   // 既存6種のいずれか
  model?: string;     // 省略時はそのプロバイダーの既存モデル設定値を使用
}
```

`Settings` 型に `[StorageKeys.AI_PROVIDER_PRIORITY_LIST]: ProviderSlot[]` を追加。配列長は1〜3。

### マイグレーション

`src/utils/migration.ts` に追加。`AI_PROVIDER_PRIORITY_LIST` が未設定の場合、`[{ provider: settings[AI_PROVIDER] }]` を生成して1位として扱う。既存の `AI_PROVIDER` キー自体は後方互換のため残す。

## aiClient.ts の変更

`generateSummary()` に優先度スロットを順に試すフォールバックロジックを追加する。

```ts
async generateSummary(content: string, tagSummaryMode = false): Promise<AISummaryResult> {
  const settings = await getSettings();
  const slots = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST];
  const minLength = settings[StorageKeys.SUMMARY_MIN_LENGTH]; // 新規設定値

  let lastResult: AISummaryResult | null = null;
  for (const slot of slots) {
    const factory = this.providers.get(slot.provider);
    if (!factory) continue;
    const effectiveSettings = slot.model
      ? { ...settings, [`${slot.provider}_model`]: slot.model }
      : settings;
    try {
      const result = await factory(effectiveSettings).generateSummary(content, tagSummaryMode);
      if (result.success && result.summary.length >= minLength) {
        return result;
      }
      lastResult = result;
    } catch (error) {
      lastResult = { success: false, summary: errorMessage(error) };
    }
  }
  return lastResult ?? { success: false, summary: 'すべてのプロバイダーで要約に失敗しました' };
}
```

- モデル上書き時のキー名生成は `OpenAIProvider` の `str(`${normalizedName}_model`)` 方式に倣う。実装時に各プロバイダーの実際のモデルキー参照方法（`gemini_model` / `openai_model` / `provider_model` 等）を個別確認する。
- クラウド30秒 / ローカル120秒のタイムアウト予算をスロットごとに設定し、全体のリトライ時間が無制限にならないようにする。
- 全プロバイダー失敗時は既存のpending機構（feature-06）に委ねる。

## ダッシュボードUI

`aiProviderSection` 内の単一selectを、「優先度1位（必須）」「優先度2位（任意）」「優先度3位（任意）」の3つのラベル付きselectに置き換える。

- 2位・3位のselectには「未設定」の選択肢を含める
- 各スロット直下にオプションのモデル入力欄（プレースホルダ「デフォルトモデルを使用」）を追加
- `updateAIProviderVisibility` を拡張し、選択された全プロバイダーの設定欄（APIキー等）を同時表示する

## テスト戦略

### 統合テスト
- `aiClient.test.ts`: 優先度リストのフォールバック契約
  - 1位失敗 → 2位成功
  - 1位が最小長未満 → 2位へフォールバック
  - 全滅 → エラー結果を返す
- `migration.test.ts`: 旧 `AI_PROVIDER` からの自動移行

### 単体テスト
- 短すぎ判定の境界値（`SUMMARY_MIN_LENGTH`ちょうど、1文字未満など）
- 重複プロバイダー（同一provider・異なるmodel）の並列スロット処理

### UIテスト
- 3スロットセレクトの表示切替（複数プロバイダー選択時の設定欄同時表示）
- 未設定（2位・3位を空にする）操作

## 未決事項 / 次PBIへの持ち越し

- モデル別の詳細な優先度制御（レート制限考慮など）は将来の別PBIとする
- `aiUsageTracker` との連携詳細（スロットごとの使用量記録）は実装時に既存実装を確認して設計する
