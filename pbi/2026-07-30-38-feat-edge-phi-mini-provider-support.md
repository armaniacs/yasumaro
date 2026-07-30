# PBI: Edge Built-in AI（Phi-mini）対応 — ブラウザ検出とコンテキスト上限吸収の実装計画

> **対象バージョン: 未定**
> 実機検証（2026-07-30、Edge 150.0.4078.105 安定版・Mac）により、Edge の Phi-mini Prompt API が Chrome の Gemini Nano（`LanguageModel`）と**同一のグローバル名・同一のAPI形状**を提供することが確認された。当初想定していた「ブラウザ専用Adapterを分離実装する」設計は過剰であり、既存 `BuiltInAIClient` を軽量な差分（ブラウザ検出・コンテキスト上限の動的化・案内文言の出し分け）で対応させる方針に転換する。

## 実機検証結果（本PBIの前提）

2026-07-30、開発者のMac上のEdge安定版（150.0.4078.105、Canary/Dev不要）で以下を確認済み。

| 確認項目 | 結果 |
|---|---|
| `edge://on-device-internals` の Foundational Model criteria | `device capable`/`disk space available`/`enabled by enterprise policy`/`enabled by feature`/`enabled by user setting` すべて `true`。VRAM 8192MiB（要件5500MiB）で条件を満たす |
| `edge://flags/#edge-llm-prompt-api-for-phi-mini` | **安定版チャネルに既に存在し、デフォルトで `Enabled`**（Canary/Dev限定という当初想定は誤り。フラグ説明文に "Mac, Windows, Linux" と明記） |
| `edge://flags/#edge-llm-summarization-api-for-phi-mini` | 安定版に存在するが初期値は `Disabled`。手動でEnabledに変更・再起動が必要 |
| 拡張機能 Service Worker (`background.js`) から `typeof self.ai` | `"undefined"` — Edge独自の `self.ai.languageModel` 名前空間は**存在しない** |
| 同コンテキストで `typeof self.LanguageModel` | `"function"` — **Chromeと同一のグローバル名で存在する** |
| `await LanguageModel.availability()` | `'downloadable'`（Chromeと同一の4値ステータス体系） |
| `LanguageModel.create({ monitor })` | `downloadprogress` イベントが `e.loaded` の割合で正常に発火（Chrome側の`BuiltInAIClient`設計がそのまま流用できる形） |
| セッション生成後のプロパティ | `contextUsage: 0, contextWindow: 9216, oncontextoverflow: null, inputUsage: 0, inputQuota: 9216` — **Chrome向け実装が使っている `contextWindow`/`contextUsage`/`contextoverflow` と同一のプロパティ名** |
| `session.prompt('こんにちは。自己紹介してください。')` | `'もちろん、あなたのためにここにいます。私はPhi、Microsoftが作成した人工知能です。...'` — Phi-miniモデル自身の応答を確認 |

**結論**: EdgeのPhi-mini実装は、Chromiumが実装するW3C Web Machine Learning Community Group策定中の Prompt API 仕様に、ChromeのGemini Nanoと足並みを揃えて追従している。API呼び出しコードそのものはブラウザ間で分岐不要。分岐が必要なのは以下の2点のみ。

1. **コンテキストウィンドウの実測値がブラウザ/モデルで異なる**（Edge Phi-mini: `contextWindow: 9216` トークン。対して既存の静的上限 `aiLimits.ts` の `'localai'` は 16,384**文字**で運用しており、そもそもトークン単位の実測値と文字数ベースの静的上限が一致していない）
2. **フラグ未設定・モデル未対応時の案内文言**（`chrome://flags` と `edge://flags/#edge-llm-prompt-api-for-phi-mini` はURL・文言が異なる）

## ユーザーストーリー

Edge ユーザーとして、Chrome を使わなくても API キー不要のオンデバイス AI で要約機能を使いたい。なぜなら、Edge を主力ブラウザとして使っており、現行実装が動作確認をChromeでしか行っていないため。

開発者として、`BuiltInAIClient` がEdgeでも同一コードパスで動くことを検証し、ブラウザ差分が本当に必要な箇所（案内文言、コンテキスト上限）だけを局所的に吸収したい。なぜなら、実機検証によりAPI形状が同一と判明した以上、別Adapterクラスを新設するのは過剰設計であり、既存のシンプルな実装を保つほうが保守コストが低いため。

## 背景・課題

なぜなぜ分析で掘り下げた結果、以下の課題構造が明らかになった。

1. Edge対応が必要なのは、Yasumaro のコア価値（API キー不要でオンデバイスAI要約が使える）を Chrome ユーザーだけでなく Edge ユーザーにも提供するため
2. 当初「別Adapter実装が必要」と想定していたのは、公開情報からEdgeが独自の `self.ai.languageModel` 名前空間を持つと類推していたため
3. その類推が誤りだったと分かったのは、実機検証で `self.ai` が `undefined`、`self.LanguageModel` がChromeと同じ関数として存在し、`availability()`/`create()`/セッションプロパティのすべてが一致したため
4. 誤った前提のまま実装を進めると危険なのは、不要な抽象化層（`LLMAdapter`インターフェース、ブラウザ判定によるAdapter切り替え）を作ることで、実際には存在しない差分のためのコードパスが増え、テスト・保守対象が無駄に膨らむため
5. 無駄な抽象化を避けつつ本当の差分（コンテキストウィンドウの違い、案内文言）を見落とすと問題なのは、`contextWindow: 9216`という実測値が既存の静的上限（16,384文字）よりかなり小さく、このままだとPhi-mini利用時に`QuotaExceededError`や`contextoverflow`（古い会話の自動ドロップ）が既存実装の想定より頻発する可能性があるため
6. `contextoverflow`が頻発すると問題なのは、Built-in AIはシングルターン要約用途とはいえ、長文ページの要約時に入力自体が上限を超えて意図しない切り詰め・エラーが起きうるため
7. 意図しない切り詰め・エラーが問題なのは、要約結果はObsidianに保存されユーザーが後から閲覧履歴を振り返る一次情報として扱われるため、要約が失敗・劣化するとYasumaroの中核価値（閲覧履歴の自動記録と要約）を損なうため
8. 中核価値を損なうことが致命的なのは、ユーザーは大量の閲覧履歴から重要な情報を効率的に抽出する目的でYasumaroを使い続けており、要約の信頼性が利用継続の動機そのものであるため
9. 過剰設計を避けつつ実際の差分だけを丁寧に吸収する設計にすることが最善なのは、実機検証済みの事実に基づいた最小限の変更のほうが、架空の差分を想定した大きな抽象化より実装コスト・レビューコストの両方で優れているため

## ビジネス価値

- Edge ユーザーにもAPIキー不要のオンデバイスAI要約を、既存実装への最小限の変更で提供する
- 実機検証済みの事実（API形状が実質同一）に基づき、不要な抽象化を避けて保守コストを抑える
- コンテキストウィンドウの実測差分を正しく吸収し、Phi-mini利用時の要約品質・エラー率を既存Chrome実装と同水準に保つ
- 既存の優先度リスト・フォールバック機構・UIをそのまま再利用し、無駄な新規インフラ構築を避ける

## 現状コードの確認（実装者向け）

```bash
# Built-in AI実装（本PBIでの変更対象。実機検証によりブラウザ分岐は最小限でよいと判明）
cat src/background/builtInAIClient.ts

# AIService統合層（この契約は変更しない）
grep -rn "AIService\|LocalAIService\|FallbackAIService" src/background/ai/ --include="*.ts"

# 優先度リストでのbuilt-in-aiディスパッチ経路
grep -n "BUILT_IN_AI_PROVIDER_ID\|registerBuiltInAiService\|builtInAiService" src/background/aiClient.ts

# 静的トークン上限（実測のcontextWindowと不整合がある箇所）
cat src/utils/aiLimits.ts

# ダッシュボードUIの選択肢表示
grep -rn "PROVIDER_LABELS\|built-in-ai" src/dashboard/ --include="*.ts"
```

**確認済みの実装事実**:

- `BuiltInAIClient`（`src/background/builtInAIClient.ts`）は `globalThis.LanguageModel` を直接呼び出す実装。実機検証によりこの呼び出しコード自体はEdgeでもそのまま動作する
- `LanguageModelGlobal` インターフェース（[:31-34行目](../src/background/builtInAIClient.ts)）はブラウザ非依存の型として扱ってよい（Edge/Chromeで一致）
- 可用性ステータス4値 `'available' | 'downloadable' | 'downloading' | 'unavailable'`（[:14行目](../src/background/builtInAIClient.ts)）はEdgeでも同一
- `summarize()`（[:96-149行目](../src/background/builtInAIClient.ts)）は `getProviderMaxTokens('localai')`（16,384文字）で切り詰めているが、Edge実測の `contextWindow: 9216`（トークン）との関係が未検証。既存の `session.contextWindow`/`contextUsage` 動的管理は実装されておらず、静的切り詰めのみで運用している
- `AIService` インターフェース経由で `FallbackAIService` に統合済み。`built-in-ai` スロットは専用ディスパッチ経路（[aiClient.ts:80-102行目](../src/background/aiClient.ts)）で処理される。この経路はブラウザ非依存でそのまま使える
- 2026-07-27 ADR「AIClientとAIServiceの統一方針」の方針を踏襲する（本PBIでの変更は`AIService`契約の外側に閉じる）

## BDD 受け入れシナリオ

```gherkin
Scenario: Edgeユーザーがダッシュボードで Built-in AI (Phi-mini) を選択し要約が成功する
  Given ユーザーが Edge（安定版でよい。Prompt APIフラグはデフォルトEnabled）を使っている
  And   edge://on-device-internals でモデルダウンロードが完了している
  And   ユーザーがダッシュボードの AI Provider 設定で「Built-in AI（APIキー不要）」を選択している
  When  ユーザーがページを閲覧し自動要約が実行される
  Then  既存Chrome向けコードパス（BuiltInAIClient.summarize）がそのまま使われ要約が成功する

Scenario: モデルが未ダウンロードの場合、テスト接続でダウンロードをトリガーする
  Given ユーザーがEdgeでBuilt-in AIを初めて選択した（availability() が 'downloadable'）
  When  ユーザーがダッシュボードの「接続テスト」を実行する
  Then  LanguageModel.create() が呼ばれモデルダウンロードが開始される
  And   ダウンロード進捗（downloadprogress イベント）が接続テスト結果に表示される

Scenario: コンテキストウィンドウの実測値に応じて入力が切り詰められる
  Given Built-in AI のセッションが生成され contextWindow が実測される（例: Edge実測 9216）
  When  静的上限（aiLimits.ts の 16,384文字）より小さいcontextWindowが検出される
  Then  実効の切り詰め上限は contextWindow に基づく値（安全マージンを見込んだ動的値）が使われる
  And   静的上限のみに依存していた場合より contextoverflow の発生頻度が下がる

Scenario: Edgeでフラグが無効化されている、または未対応環境の場合にユーザーへ通知する
  Given ユーザーの環境で LanguageModel が存在しない、または availability() が 'unavailable'
  When  ユーザーが Built-in AI を選択または要約を試行する
  Then  実行中のブラウザ（Chrome/Edge）を判定し、該当ブラウザのフラグURL・フラグ名を含む案内が表示される
  And   Edgeの場合は edge://flags/#edge-llm-prompt-api-for-phi-mini への案内、Chromeの場合は既存の案内文言が出る
```

## 受け入れ基準

本PBIの実装スコープは実質的に次の2本柱に絞られる（詳細は[実装アプローチ](#実装アプローチ)のフェーズ1・フェーズ2）。

> **実装完了（2026-07-30、feature-devフローで実装）。** 実装時のコードベース探索・deep-dig相当の確認により、下記の一部は着手前の想定から変更されている。変更点は各項目に記載。

### 柱1: `contextWindow`/`contextUsage`を使った動的切り詰め上限（Chrome側にも効く改善）

- [x] `BuiltInAIClient.summarize()` がセッション生成後に `session.contextWindow` / `session.inputQuota` を取得し診断ログ（`addLog(LogType.DEBUG, ...)`）に記録している
- [x] 実効切り詰め上限が `min(静的上限 getProviderMaxTokens('localai'), contextWindow由来の動的上限)` として計算されている（`computeEffectiveMaxChars()`、[builtInAIClient.ts:73-79行目](../src/background/builtInAIClient.ts)。換算係数 `CHARS_PER_TOKEN_ESTIMATE=2`・安全マージン `CONTEXT_WINDOW_SAFETY_MARGIN=0.8` を定数化）
- [x] `session.oncontextoverflow` ハンドラを実装し、発火時は診断ログ（`addLog(LogType.WARN, ...)`）に警告を記録する。**なぜなぜ分析の結果、`BuiltInAISummaryResult`への型追加は行わない方針に変更**（シングルターン設計では事前の動的切り詰めが破綻した場合の異常系検知という性格が強く、`AISummaryResult`まで3層（`BuiltInAISummaryResult`→`LocalAiSummarizeResult`→`AISummaryResult`）を貫通させてユーザー向けUIに出す価値が低いと判断。既存の型は非破壊のまま）
- [x] `QuotaExceededError` 発生時に `success: false` を返し、`FallbackAIService` が remote へ正しくフォールバックする（既存の例外ハンドリング経路をそのまま利用、変更なし）
- [x] 既存Chrome向けの単体テストが動的上限導入後も回帰していない（`npm test` 実行、無関係な既存の1件（バージョン不整合）を除き全件成功）
- [x] トークン/文字の換算係数の根拠が実測値（Edge `contextWindow: 9216`）を踏まえた保守的な固定値としてコード上にコメント付きで残っている

### 柱2: ブラウザ検出による案内文言（フラグURL）の出し分け — API呼び出し自体の分岐は行わない

- [x] ブラウザ判定は新規`detectBrowserKind()`ではなく、**コードベース調査で発見した既存の未使用関数 `getBrowserName()`（`src/utils/browserSupport.ts`、`navigator.userAgent`文字列判定）を再利用**する方針に変更（`userAgentData.brands`ベースの新規実装は行わない。理由: 重複するブラウザ判定ロジックをコードベースに増やさないため）。返り値型を`string`からリテラル型`'chrome'|'edge'|'brave'|'unknown'`に変更
- [x] `LanguageModel` が `unavailable` の場合、検出したブラウザに応じたフラグURL・フラグ名を含む案内文言が表示される（Chrome: `chrome://flags/#prompt-api-for-gemini-nano`、Edge: `edge://flags/#edge-llm-prompt-api-for-phi-mini`。新設 `getBuiltInAIFlagGuidance()`、[browserSupport.ts](../src/utils/browserSupport.ts)）
- [x] ブラウザが判定不能（`'brave'`/`'unknown'`）の場合、フラグURLを含まない汎用的な案内文言にフォールバックし、クラッシュしない
- [x] **`LanguageModel.availability()` / `create()` / `summarize()` の呼び出しコード自体には一切ブラウザ分岐を入れていない** — 案内文言の組み立て（`buildUnavailableMessage()`）のみで分岐
- [x] i18nキーを追加（`public/_locales/ja/messages.json` / `public/_locales/en/messages.json` 両方、`builtInAiUnavailableGeneric`/`builtInAiUnavailableWithFlag`。既存の`builtInAiHelp`もEdge対応を反映して更新）
- [x] ダッシュボードUIは「Built-in AI（APIキー不要）」の表示のまま変更していない

**追加のなぜなぜ分析での決定**: 案内文言の実装層について、当初「BuiltInAIClientはブラウザ種別のみ返しUI層でi18n解決」を想定していたが、実際の呼び出し経路（`BuiltInAIClient`→`LocalAIService`→`AIClient.testConnection()`）を確認した結果、構造化データを運ぶには型の3層貫通が必要と判明。型非破壊の原則を優先し、**`BuiltInAIClient`自身が`getMessage()`（`chrome.i18n`のService Worker向けラッパー）でローカライズ済みの案内文言を組み立て、既存の`error`文字列にそのまま含める**方式に変更した。

### 全体

- [x] `BuiltInAIClient` の呼び出しコード（`globalThis.LanguageModel` 経由）はEdge向けの変更を一切加えていない（実機検証済みのAPI形状の一致を前提に据え置き）
- [ ] Edge実機（安定版）での本変更後の動作確認（動的切り詰め・案内文言表示）は未実施 — 次のアクションとして残る
- [x] `aiLimits.ts` の `'localai'` エントリはそのまま静的上限として残し、`contextWindow`由来の動的上限とのminを取る設計で決着
- [x] 実装レビュー（simplicity/DRY, correctness, project conventionsの3観点）を実施し指摘事項を反映済み

## テスト戦略（t_wada スタイル）

### Outside-In TDD の方針

1. **最外層（ダッシュボードUI）**: 「Provider選択肢に変化がない」というE2E制約をPlaywrightで先に固定する（既存の`dashboard-built-in-ai.spec.ts`が対象）
2. **`BuiltInAIClient`の単体テスト拡張**: `contextWindow`/`contextUsage`に応じた動的切り詰めロジックを、`LanguageModel`をモックしたユニットテストで先に失敗させ（RED）、実装する（GREEN）
3. **ブラウザ検出ロジックの単体テスト**: Chrome/Edge判定を関数として切り出し、`navigator.userAgentData`をモックして両分岐をテストする
4. **実機検証は最後**: Edge実機（安定版）でモデルダウンロード・要約成功・案内文言表示を手動確認する

### 設計の検証

- 動的切り詰めロジックが既存の静的切り詰め（`getProviderMaxTokens('localai')`）と併用される場合の優先順位が明確か
- ブラウザ検出が誤検出時にクラッシュせず、汎用的な案内文言にフォールバックする設計になっているか
- `contextoverflow`ハンドリングが既存の`AISummaryResult`型を破壊的変更しないか

## 実装アプローチ

### フェーズ1: コンテキストウィンドウの動的管理（ブラウザ非依存の改善）

実機検証で判明した「静的上限16,384文字 vs 実測`contextWindow: 9216`トークンの不整合」を解消する。これはEdge固有ではなくChrome側にも当てはまる改善であり、最優先で着手する。

```typescript
// src/background/builtInAIClient.ts（既存ファイルの拡張イメージ）

interface LanguageModelSession {
    prompt(text: string): Promise<string>;
    destroy(): void;
    contextWindow?: number;
    contextUsage?: number;
    inputQuota?: number;
    inputUsage?: number;
    oncontextoverflow?: ((event: Event) => void) | null;
}

// summarize() 内、session生成後に追加:
// 1. contextWindow/inputQuota を診断ログに記録
addLog(LogType.DEBUG, 'BuiltInAIClient: session context info', {
    contextWindow: session.contextWindow,
    inputQuota: session.inputQuota,
});

// 2. contextoverflowイベントを監視し、発火時は結果に警告を付与
let overflowed = false;
session.oncontextoverflow = () => { overflowed = true; };

// 3. 実効切り詰め上限 = min(静的上限, contextWindow由来の安全値)
//    contextWindowはトークン単位、静的上限は文字数単位のため、
//    実測値からトークン/文字の換算係数（暫定値、要実測調整）を用いて変換する
const staticMaxChars = getProviderMaxTokens('localai');
const dynamicMaxChars = session.contextWindow
    ? Math.floor(session.contextWindow * CHARS_PER_TOKEN_ESTIMATE * SAFETY_MARGIN)
    : staticMaxChars;
const effectiveMaxChars = Math.min(staticMaxChars, dynamicMaxChars);
```

**タスク**:
1. トークン/文字換算係数（`CHARS_PER_TOKEN_ESTIMATE`）の実測ベース確定 — Edge実測`contextWindow: 9216`と実際に安全に送信できた文字数を突き合わせて暫定値を決める
2. `oncontextoverflow` ハンドラの実装と`BuiltInAISummaryResult`への警告フラグ追加（既存の型を破壊しないよう、オプショナルフィールドとして追加）
3. 既存Chromeでの回帰テスト（動的上限の導入で既存の要約結果が変わらないことを確認）

### フェーズ2: ブラウザ検出とEdge向け案内文言

Adapterクラスの新設は行わず、案内文言の出し分けのみを行う軽量な実装にする。

```typescript
// src/background/builtInAIClient.ts、または新規 src/utils/browserDetect.ts

export type BrowserKind = 'chrome' | 'edge' | 'other';

/**
 * Feature Detectionではなくエラーメッセージの出し分け専用の判定。
 * LanguageModelの可用性判定自体はブラウザ非依存のため、ここでの誤判定が
 * 機能に影響することはなく、案内文言の精度にのみ影響する。
 */
export function detectBrowserKind(): BrowserKind {
    const brands = (navigator as { userAgentData?: { brands?: Array<{ brand: string }> } })
        .userAgentData?.brands ?? [];
    if (brands.some(b => b.brand.includes('Microsoft Edge'))) return 'edge';
    if (brands.some(b => b.brand.includes('Google Chrome') || b.brand.includes('Chromium'))) return 'chrome';
    return 'other';
}

const FLAG_GUIDANCE: Record<BrowserKind, { url: string; label: string } | null> = {
    chrome: { url: 'chrome://flags/#prompt-api-for-gemini-nano', label: 'chrome://flags' },
    edge: { url: 'edge://flags/#edge-llm-prompt-api-for-phi-mini', label: 'edge://flags/#edge-llm-prompt-api-for-phi-mini' },
    other: null,
};
```

**タスク**:
1. `detectBrowserKind()` の実装とユニットテスト（`userAgentData`モック、`brands`配列のパターン網羅）
2. `unavailable` 時の案内文言に、検出ブラウザに応じたフラグURL・フラグ名を含める（[2026-07-28設計の4.1章](../dev-docs/2026-07-28-built-in-ai-provider-integration-design.md)の状態別UXにEdge分岐を追記する形）
3. i18nキーの追加（Edge向け案内文言、日本語・英語両対応）。`_locales/ja/messages.json`・`_locales/en/messages.json`

### フェーズ3: 実機統合検証

**タスク**:
1. Edge安定版（Canary/Dev不要と判明したため、追加インストール不要）でのE2E手動検証: フラグ確認 → モデルダウンロード → 要約成功 → ダッシュボード表示確認
2. Summarizer API（`edge-llm-summarization-api-for-phi-mini`）が要約専用として使えるかの追加調査は本PBIのスコープ外とし、将来PBIの検討事項として申し送る（Prompt APIベースで先行する既存方針を踏襲）
3. 既存Playwright E2E（`dashboard-built-in-ai.spec.ts`）がChromiumベースであるため、Edge実行環境の自動テスト化は別途CI環境整備が必要と判断し、スコープ外・申し送り事項とする

## 開発・検証環境

- **Edgeのインストール**: 安定版で検証可能と判明（Canary/Dev不要）。ただし将来的にPrompt API仕様が変更される可能性を考慮し、最新の安定版を使う
- **フラグ確認手順**:
  1. `edge://flags/#edge-llm-prompt-api-for-phi-mini` を開き、`Enabled` になっていることを確認（デフォルトで有効な場合が多い）
  2. Summarizer APIを検証する場合は `edge://flags/#edge-llm-summarization-api-for-phi-mini` を `Enabled` にして再起動
  3. `edge://on-device-internals` の Model Status タブで `Foundational model state` とVRAM要件充足を確認
- **拡張機能の読み込み**: `edge://extensions` で開発者モードを有効化し、`dist/chromium-mv3` を「展開して読み込み」
- **動作確認コンソール例**（本PBI作成時に実機確認済みの手順）:
  ```js
  // 拡張機能の Service Worker コンソールで実行
  await LanguageModel.availability(); // -> 'downloadable' | 'available' 等
  const session = await LanguageModel.create({
    monitor(m) {
      m.addEventListener('downloadprogress', e => console.log(`${Math.round(e.loaded * 100)}%`));
    }
  });
  await session.prompt('こんにちは。自己紹介してください。');
  // contextWindow/contextUsage/inputQuota はセッションオブジェクトのプロパティとして確認可能
  ```

## 見積もり

3ポイント（当初想定の8ポイントから縮小。実機検証によりAdapter新設が不要と判明したため、変更範囲はコンテキスト上限の動的化とブラウザ検出の軽量な追加に限定される）

## 技術的考慮事項

- **依存関係**: PBI-30〜32（Chrome Built-in AI実装、アーカイブ済み）、2026-07-27 ADR「AIClientとAIServiceの統一方針」、本PBI内の実機検証結果
- **テスタビリティ**: `LanguageModel`のモックで`contextWindow`/`contextUsage`/`oncontextoverflow`を差し替え可能にし、動的上限ロジックを実機なしで単体テストできる設計にする
- **非機能要件**: i18n（日本語・英語）、セキュリティ（プロンプトサニタイズは既存`promptSanitizer.ts`をそのまま利用、ブラウザ分岐の影響を受けない）

## 想定リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| トークン/文字換算係数が不正確で、動的上限が実際のPhi-mini制約と乖離する | 意図しない`QuotaExceededError`または過度に保守的な切り詰め | 安全マージン（例: 実測値の80%を上限とする）を設け、`contextoverflow`発生率をログで監視し実装後に調整する運用にする |
| `navigator.userAgentData`が将来のブラウザ更新で仕様変更される、または一部環境で利用不可 | 案内文言の誤表示（機能自体には影響しない） | `detectBrowserKind()`が判定不能な場合は`'other'`として汎用的な案内文言（ブラウザ名を出さず「ブラウザの実験的機能フラグを確認してください」）にフォールバックする設計にする |
| 今回の実機検証はMac・Edge安定版1環境のみで、Windows環境や将来のEdgeバージョンで挙動が異なる可能性 | 一部環境で未検証のまま本番投入するリスク | 受け入れ基準に「実機検証はMacで実施済み」と明記し、Windows環境での追加検証を実装フェーズのタスクとして明示する |
| Phi-miniのファクト精度の低さ（ユーザー向けドキュメントに記載されている既知の制約）により誤った要約が生成される | ユーザー信頼の毀損 | 本PBIのスコープでは対処しない（プロンプト調整は既存のSYSTEM_PROMPTがGemini Nano/Phi-mini共通で使われており、ブラウザ固有の調整が必要か実装後の要約品質観察で判断する。必要なら別PBI） |

## 実装者向け注記

### 落とし穴

- 当初設計案にあった `LLMAdapter`/`ChromeGeminiNanoAdapter`/`EdgePhiMiniAdapter`という抽象化は、実機検証の結果**不要と判明したため実装しない**。将来的に本当にAPI形状が異なるブラウザ（Firefoxの将来的なon-device AI等）が登場した時点で、その時の実API仕様を見てから抽象化を検討する（YAGNI）
- `session.contextWindow`はトークン単位、`aiLimits.ts`の既存値は文字数単位という単位の違いを混同しないこと。換算は概算にならざるを得ず、フェーズ1で安全マージンを持たせる設計にする
- `AI_PROVIDER_PRIORITY_LIST`の`built-in-ai`スロットは変更しない。本PBIは`BuiltInAIClient`内部実装の改善に閉じる
- `reviewSummaryGenerator.ts`は既存ADR例外規定により`AIClient`を直接生成し続けているため、本PBIのスコープ外とする

## Definition of Done

- [ ] 全BDDシナリオに対応する実装が完了している
- [ ] `session.contextWindow`/`contextUsage`を用いた動的切り詰めロジックが実装され、既存Chromeでの回帰テストが通っている
- [ ] Edge実機（Mac・安定版）でモデルダウンロード〜要約成功までの一連の動作が確認されている
- [ ] ブラウザ検出に基づく案内文言の出し分けが実装され、i18n対応済み
- [ ] `npm run validate`（型チェック+テスト）が通っている
- [ ] CHANGELOG.mdが更新されている
